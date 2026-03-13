import hashlib
import logging
import re
import uuid
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

logger = logging.getLogger(__name__)


def _chunks(text: str, chunk_size: int = 900, overlap: int = 150) -> list[str]:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if not normalized:
        return []
    step = max(1, chunk_size - overlap)
    out: list[str] = []
    for i in range(0, len(normalized), step):
        piece = normalized[i : i + chunk_size].strip()
        if piece:
            out.append(piece)
        if i + chunk_size >= len(normalized):
            break
    return out


class Neo4jStore:
    def __init__(self, uri: str, user: str, password: str, embedding_dim: int = 4096) -> None:
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        self._embedding_dim = embedding_dim

    async def close(self) -> None:
        await self._driver.close()

    async def verify_connectivity(self) -> None:
        await self._driver.verify_connectivity()

    async def ensure_indexes(self) -> None:
        async with self._driver.session() as s:
            # Unique constraint: Document
            await s.run(
                "CREATE CONSTRAINT document_url_hash IF NOT EXISTS "
                "FOR (d:Document) REQUIRE (d.source_url, d.content_hash) IS UNIQUE"
            )
            # Unique constraint: Tag
            await s.run(
                "CREATE CONSTRAINT tag_name_unique IF NOT EXISTS "
                "FOR (t:Tag) REQUIRE t.name IS UNIQUE"
            )
            # Vector index (Neo4j 5.11+)
            await s.run(
                f"""
                CREATE VECTOR INDEX chunk_embedding_index IF NOT EXISTS
                FOR (c:Chunk) ON (c.embedding)
                OPTIONS {{indexConfig: {{
                    `vector.dimensions`: {self._embedding_dim},
                    `vector.similarity_function`: 'cosine'
                }}}}
                """
            )
            # Fulltext index
            await s.run(
                """
                CREATE FULLTEXT INDEX document_fulltext IF NOT EXISTS
                FOR (n:Chunk|Document) ON EACH [n.text, n.title]
                """
            )
            # Date / category index for filtering
            await s.run("CREATE INDEX doc_summary_date IF NOT EXISTS FOR (d:Document) ON (d.summary_date)")
            await s.run("CREATE INDEX doc_category IF NOT EXISTS FOR (d:Document) ON (d.category)")
        logger.info("Neo4j indexes ensured")

    # ─── Ingest ────────────────────────────────────────────────────────────────

    async def ingest_document(
        self,
        *,
        source_url: str,
        source_type: str,
        title: str,
        category: str,
        summary_text: str,
        raw_text: str,
        summary_date: str | None,
        chunk_embeddings: list[tuple[str, str, list[float]]],  # (text, chunk_type, embedding)
    ) -> tuple[str, bool]:
        """Returns (document_id, created). created=False means duplicate."""
        content_hash = hashlib.sha256(raw_text.encode("utf-8", errors="ignore")).hexdigest()

        async with self._driver.session() as s:
            # Check duplicate
            result = await s.run(
                "MATCH (d:Document {source_url: $url, content_hash: $hash}) RETURN d.id AS id",
                url=source_url,
                hash=content_hash,
            )
            record = await result.single()
            if record:
                return record["id"], False

            doc_id = str(uuid.uuid4())
            await s.run(
                """
                CREATE (d:Document {
                    id: $id,
                    source_url: $source_url,
                    source_type: $source_type,
                    title: $title,
                    category: $category,
                    summary_text: $summary_text,
                    raw_text: $raw_text,
                    content_hash: $content_hash,
                    summary_date: $summary_date,
                    created_at: datetime()
                })
                """,
                id=doc_id,
                source_url=source_url,
                source_type=source_type,
                title=title,
                category=category,
                summary_text=summary_text,
                raw_text=raw_text,
                content_hash=content_hash,
                summary_date=summary_date,
            )

            for idx, (text, chunk_type, embedding) in enumerate(chunk_embeddings):
                chunk_id = str(uuid.uuid4())
                await s.run(
                    """
                    MATCH (d:Document {id: $doc_id})
                    CREATE (c:Chunk {
                        id: $chunk_id,
                        text: $text,
                        embedding: $embedding,
                        chunk_type: $chunk_type,
                        chunk_index: $idx,
                        title: $title,
                        category: $category,
                        source_url: $source_url
                    })
                    CREATE (d)-[:HAS_CHUNK]->(c)
                    """,
                    doc_id=doc_id,
                    chunk_id=chunk_id,
                    text=text,
                    embedding=embedding,
                    chunk_type=chunk_type,
                    idx=idx,
                    title=title,
                    category=category,
                    source_url=source_url,
                )

            return doc_id, True

    # ─── Search ────────────────────────────────────────────────────────────────

    async def vector_search(
        self,
        embedding: list[float],
        limit: int,
        category: str | None = None,
        score_threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        cat_filter = "WHERE d.category = $category" if category else ""
        async with self._driver.session() as s:
            result = await s.run(
                f"""
                CALL db.index.vector.queryNodes('chunk_embedding_index', $k, $embedding)
                YIELD node AS c, score
                WHERE score >= $score_threshold
                MATCH (d:Document)-[:HAS_CHUNK]->(c)
                {cat_filter}
                RETURN d.id AS document_id,
                       d.source_url AS source_url,
                       d.title AS title,
                       d.category AS category,
                       d.source_type AS source_type,
                       d.summary_date AS summary_date,
                       c.text AS chunk_text,
                       score
                ORDER BY score DESC
                LIMIT $limit
                """,
                k=limit * 2,
                embedding=embedding,
                category=category,
                limit=limit,
                score_threshold=score_threshold,
            )
            return await result.data()

    async def fulltext_search(
        self,
        query: str,
        limit: int,
        category: str | None = None,
    ) -> list[dict[str, Any]]:
        # Lucene: escape special chars, use OR for multi-token
        tokens = re.findall(r"[0-9A-Za-z가-힣]{2,}", query)
        fts_query = " OR ".join(f"{t}*" for t in tokens) if tokens else query
        cat_filter = "WHERE d.category = $category" if category else ""
        async with self._driver.session() as s:
            try:
                result = await s.run(
                    f"""
                    CALL db.index.fulltext.queryNodes('document_fulltext', $fts_query)
                    YIELD node AS c, score
                    MATCH (d:Document)-[:HAS_CHUNK]->(c)
                    {cat_filter}
                    RETURN d.id AS document_id,
                           d.source_url AS source_url,
                           d.title AS title,
                           d.category AS category,
                           d.source_type AS source_type,
                           d.summary_date AS summary_date,
                           c.text AS chunk_text,
                           score
                    ORDER BY score DESC
                    LIMIT $limit
                    """,
                    fts_query=fts_query,
                    category=category,
                    limit=limit,
                )
                return await result.data()
            except Exception:  # noqa: BLE001
                logger.warning("Fulltext search failed for query=%s", query)
                return []

    async def hybrid_search(
        self,
        query: str,
        query_embedding: list[float],
        limit: int,
        category: str | None = None,
    ) -> list[dict[str, Any]]:
        """Vector + fulltext search merged with Reciprocal Rank Fusion."""
        vector_results = await self.vector_search(query_embedding, limit, category)
        fts_results = await self.fulltext_search(query, limit, category)

        # RRF merge (k=60)
        rrf_k = 60
        scores: dict[str, float] = {}
        data: dict[str, dict] = {}

        for rank, item in enumerate(vector_results):
            key = f"{item['document_id']}::{item['chunk_text'][:50]}"
            scores[key] = scores.get(key, 0) + 1 / (rrf_k + rank + 1)
            data[key] = item

        for rank, item in enumerate(fts_results):
            key = f"{item['document_id']}::{item['chunk_text'][:50]}"
            scores[key] = scores.get(key, 0) + 1 / (rrf_k + rank + 1)
            data[key] = item

        sorted_keys = sorted(scores, key=lambda k: scores[k], reverse=True)
        merged = []
        for key in sorted_keys[:limit]:
            item = dict(data[key])
            item["score"] = round(scores[key], 6)
            merged.append(item)
        return merged

    # ─── Document queries ──────────────────────────────────────────────────────

    async def get_document(self, document_id: str) -> dict[str, Any] | None:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d:Document {id: $id})
                RETURN d.id AS id, d.source_url AS source_url,
                       d.source_type AS source_type, d.title AS title,
                       d.category AS category, d.summary_text AS summary_text,
                       d.raw_text AS raw_text,
                       d.summary_date AS summary_date,
                       toString(d.created_at) AS created_at
                """,
                id=document_id,
            )
            record = await result.single()
            return dict(record) if record else None

    async def recent_documents(self, limit: int = 10) -> list[dict[str, Any]]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d:Document)
                RETURN d.id AS id, d.source_url AS source_url,
                       d.source_type AS source_type, d.title AS title,
                       d.category AS category, d.summary_text AS summary_text,
                       d.summary_date AS summary_date,
                       toString(d.created_at) AS created_at
                ORDER BY d.created_at DESC
                LIMIT $limit
                """,
                limit=limit,
            )
            return await result.data()

    async def list_categories(self) -> list[dict[str, Any]]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d:Document)
                RETURN d.category AS category, count(d) AS document_count
                ORDER BY document_count DESC
                """
            )
            return await result.data()
