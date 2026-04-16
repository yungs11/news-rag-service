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


def _build_doc_filter(category: str | None, user_id: str | None, document_id: str | None = None) -> str:
    """Build WHERE clause for Document node filtering."""
    clauses = []
    if category:
        clauses.append("d.category = $category")
    if user_id:
        clauses.append("d.user_id = $user_id")
    if document_id:
        clauses.append("d.id = $document_id")
    return ("WHERE " + " AND ".join(clauses)) if clauses else ""


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
            # Unique constraint: FeedSource
            await s.run(
                "CREATE CONSTRAINT feed_source_id IF NOT EXISTS "
                "FOR (fs:FeedSource) REQUIRE fs.id IS UNIQUE"
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
            # Date / category / user_id index for filtering
            await s.run("CREATE INDEX doc_summary_date IF NOT EXISTS FOR (d:Document) ON (d.summary_date)")
            await s.run("CREATE INDEX doc_category IF NOT EXISTS FOR (d:Document) ON (d.category)")
            await s.run("CREATE INDEX doc_user_id IF NOT EXISTS FOR (d:Document) ON (d.user_id)")
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
        user_id: str | None = None,
        collected_from: str | None = None,
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
                    user_id: $user_id,
                    collected_from: $collected_from,
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
                user_id=user_id,
                collected_from=collected_from,
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
                        source_url: $source_url,
                        user_id: $user_id
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
                    user_id=user_id,
                )

            return doc_id, True

    # ─── Search ────────────────────────────────────────────────────────────────

    async def vector_search(
        self,
        embedding: list[float],
        limit: int,
        category: str | None = None,
        score_threshold: float = 0.5,
        user_id: str | None = None,
        document_id: str | None = None,
    ) -> list[dict[str, Any]]:
        doc_filter = _build_doc_filter(category, user_id, document_id)
        async with self._driver.session() as s:
            result = await s.run(
                f"""
                CALL db.index.vector.queryNodes('chunk_embedding_index', $k, $embedding)
                YIELD node AS c, score
                WHERE score >= $score_threshold
                MATCH (d:Document)-[:HAS_CHUNK]->(c)
                {doc_filter}
                RETURN d.id AS document_id,
                       d.source_url AS source_url,
                       d.title AS title,
                       d.category AS category,
                       d.source_type AS source_type,
                       d.summary_date AS summary_date,
                       d.summary_text AS summary_text,
                       c.text AS chunk_text,
                       score
                ORDER BY score DESC
                LIMIT $limit
                """,
                k=limit * 2,
                embedding=embedding,
                category=category,
                user_id=user_id,
                document_id=document_id,
                limit=limit,
                score_threshold=score_threshold,
            )
            return await result.data()

    async def fulltext_search(
        self,
        query: str,
        limit: int,
        category: str | None = None,
        user_id: str | None = None,
        document_id: str | None = None,
    ) -> list[dict[str, Any]]:
        # Lucene: escape special chars, use OR for multi-token
        tokens = re.findall(r"[0-9A-Za-z가-힣]{2,}", query)
        fts_query = " OR ".join(f"{t}*" for t in tokens) if tokens else query
        doc_filter = _build_doc_filter(category, user_id, document_id)
        async with self._driver.session() as s:
            try:
                result = await s.run(
                    f"""
                    CALL db.index.fulltext.queryNodes('document_fulltext', $fts_query)
                    YIELD node AS c, score
                    MATCH (d:Document)-[:HAS_CHUNK]->(c)
                    {doc_filter}
                    RETURN d.id AS document_id,
                           d.source_url AS source_url,
                           d.title AS title,
                           d.category AS category,
                           d.source_type AS source_type,
                           d.summary_date AS summary_date,
                           d.summary_text AS summary_text,
                           c.text AS chunk_text,
                           score
                    ORDER BY score DESC
                    LIMIT $limit
                    """,
                    fts_query=fts_query,
                    category=category,
                    user_id=user_id,
                    document_id=document_id,
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
        user_id: str | None = None,
        document_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Vector + fulltext search merged with Reciprocal Rank Fusion."""
        vector_results = await self.vector_search(query_embedding, limit, category, user_id=user_id, document_id=document_id)
        fts_results = await self.fulltext_search(query, limit, category, user_id=user_id, document_id=document_id)

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
                       d.user_id AS user_id,
                       d.collected_from AS collected_from,
                       toString(d.created_at) AS created_at
                """,
                id=document_id,
            )
            record = await result.single()
            return dict(record) if record else None

    async def recent_documents(self, limit: int = 10, user_id: str | None = None) -> list[dict[str, Any]]:
        doc_filter = _build_doc_filter(None, user_id)
        async with self._driver.session() as s:
            result = await s.run(
                f"""
                MATCH (d:Document)
                {doc_filter}
                RETURN d.id AS id, d.source_url AS source_url,
                       d.source_type AS source_type, d.title AS title,
                       d.category AS category, d.summary_text AS summary_text,
                       d.summary_date AS summary_date,
                       d.user_id AS user_id,
                       d.collected_from AS collected_from,
                       toString(d.created_at) AS created_at
                ORDER BY d.created_at DESC
                LIMIT $limit
                """,
                limit=limit,
                user_id=user_id,
            )
            return await result.data()

    async def similar_document_pairs(
        self,
        score_threshold: float = 0.75,
        limit: int = 300,
    ) -> list[dict[str, Any]]:
        """청크 벡터 인덱스를 이용해 문서 간 유사도 쌍을 반환."""
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d1:Document)-[:HAS_CHUNK]->(c1:Chunk)
                CALL db.index.vector.queryNodes('chunk_embedding_index', 6, c1.embedding)
                YIELD node AS c2, score
                WHERE score >= $threshold AND NOT (d1)-[:HAS_CHUNK]->(c2)
                MATCH (d2:Document)-[:HAS_CHUNK]->(c2)
                WHERE d1.id <> d2.id
                WITH d1.id AS source_id, d2.id AS target_id, max(score) AS max_score
                WHERE source_id < target_id
                RETURN source_id, target_id, max_score
                ORDER BY max_score DESC
                LIMIT $limit
                """,
                threshold=score_threshold,
                limit=limit,
            )
            return await result.data()

    async def graph_data(self) -> list[dict[str, Any]]:
        """모든 Document 노드 반환 (그래프 시각화용, 관리자 전용)."""
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d:Document)
                RETURN d.id AS id, d.title AS title, d.category AS category,
                       d.source_type AS source_type, d.source_url AS source_url,
                       d.summary_text AS summary_text, d.user_id AS user_id,
                       toString(d.created_at) AS created_at
                ORDER BY d.created_at DESC
                LIMIT 500
                """
            )
            return await result.data()

    async def delete_document(self, document_id: str) -> bool:
        """Document와 관련 Chunk 노드 및 관계를 모두 삭제. Tag 노드는 유지."""
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (d:Document {id: $id})
                OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
                DETACH DELETE c, d
                RETURN count(d) AS deleted
                """,
                id=document_id,
            )
            record = await result.single()
            return bool(record and record["deleted"] > 0)

    async def list_categories(self, user_id: str | None = None) -> list[dict[str, Any]]:
        doc_filter = _build_doc_filter(None, user_id)
        async with self._driver.session() as s:
            result = await s.run(
                f"""
                MATCH (d:Document)
                {doc_filter}
                RETURN d.category AS category, count(d) AS document_count
                ORDER BY document_count DESC
                """,
                user_id=user_id,
            )
            return await result.data()

    # ─── Read Status ────────────────────────────────────────────────────────

    async def mark_document_read(self, document_id: str, user_id: str) -> None:
        async with self._driver.session() as s:
            await s.run(
                """
                MATCH (d:Document {id: $doc_id})
                MERGE (r:Reader {user_id: $user_id})
                MERGE (r)-[:HAS_READ]->(d)
                """,
                doc_id=document_id,
                user_id=user_id,
            )

    async def get_read_doc_ids(self, user_id: str) -> list[str]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[:HAS_READ]->(d:Document)
                RETURN d.id AS id
                """,
                user_id=user_id,
            )
            records = await result.data()
            return [str(r["id"]) for r in records]

    # ─── Bookmark ──────────────────────────────────────────────────────────

    async def toggle_bookmark(self, user_id: str, document_id: str) -> bool:
        """Toggle bookmark. Returns True if bookmarked, False if removed."""
        async with self._driver.session() as s:
            # Check if already bookmarked
            check = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[rel:HAS_BOOKMARKED]->(d:Document {id: $doc_id})
                RETURN count(rel) AS cnt
                """,
                user_id=user_id,
                doc_id=document_id,
            )
            record = await check.single()
            already = bool(record and record["cnt"] > 0)

            if already:
                await s.run(
                    """
                    MATCH (r:Reader {user_id: $user_id})-[rel:HAS_BOOKMARKED]->(d:Document {id: $doc_id})
                    DELETE rel
                    """,
                    user_id=user_id,
                    doc_id=document_id,
                )
                return False
            else:
                await s.run(
                    """
                    MATCH (d:Document {id: $doc_id})
                    MERGE (r:Reader {user_id: $user_id})
                    MERGE (r)-[:HAS_BOOKMARKED]->(d)
                    """,
                    user_id=user_id,
                    doc_id=document_id,
                )
                return True

    async def get_bookmarked_doc_ids(self, user_id: str) -> list[str]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[:HAS_BOOKMARKED]->(d:Document)
                RETURN d.id AS id
                """,
                user_id=user_id,
            )
            records = await result.data()
            return [str(r["id"]) for r in records]

    async def get_bookmarked_documents(self, user_id: str) -> list[dict[str, Any]]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[:HAS_BOOKMARKED]->(d:Document)
                RETURN d.id AS id, d.source_url AS source_url,
                       d.source_type AS source_type, d.title AS title,
                       d.category AS category, d.summary_text AS summary_text,
                       d.summary_date AS summary_date,
                       d.user_id AS user_id,
                       d.collected_from AS collected_from,
                       toString(d.created_at) AS created_at
                ORDER BY d.created_at DESC
                """,
                user_id=user_id,
            )
            return await result.data()

    # ─── Memo ─────────────────────────────────────────────────────────────

    async def upsert_memo(self, user_id: str, document_id: str, text: str) -> None:
        async with self._driver.session() as s:
            await s.run(
                """
                MATCH (d:Document {id: $doc_id})
                MERGE (r:Reader {user_id: $user_id})
                MERGE (r)-[m:HAS_MEMO]->(d)
                SET m.text = $text,
                    m.updated_at = datetime(),
                    m.created_at = coalesce(m.created_at, datetime())
                """,
                user_id=user_id,
                doc_id=document_id,
                text=text,
            )

    async def delete_memo(self, user_id: str, document_id: str) -> bool:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[m:HAS_MEMO]->(d:Document {id: $doc_id})
                DELETE m
                RETURN count(m) AS deleted
                """,
                user_id=user_id,
                doc_id=document_id,
            )
            record = await result.single()
            return bool(record and record["deleted"] > 0)

    async def get_memos(self, user_id: str) -> list[dict[str, Any]]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[m:HAS_MEMO]->(d:Document)
                RETURN d.id AS document_id, d.title AS title,
                       d.category AS category, d.source_url AS source_url,
                       d.source_type AS source_type, d.summary_date AS summary_date,
                       d.collected_from AS collected_from,
                       m.text AS memo_text,
                       toString(m.created_at) AS memo_created_at,
                       toString(m.updated_at) AS memo_updated_at
                ORDER BY m.updated_at DESC
                """,
                user_id=user_id,
            )
            return await result.data()

    async def get_memo(self, user_id: str, document_id: str) -> str | None:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (r:Reader {user_id: $user_id})-[m:HAS_MEMO]->(d:Document {id: $doc_id})
                RETURN m.text AS text
                """,
                user_id=user_id,
                doc_id=document_id,
            )
            record = await result.single()
            return str(record["text"]) if record else None

    # ─── FeedSource CRUD ──────────────────────────────────────────────────────

    async def list_feed_sources(self) -> list[dict[str, Any]]:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (fs:FeedSource)
                RETURN fs.id AS id, fs.name AS name, fs.feed_url AS feed_url,
                       fs.feed_type AS feed_type, fs.filter_mode AS filter_mode,
                       fs.enabled AS enabled, fs.max_items AS max_items,
                       toString(fs.last_collected_at) AS last_collected_at,
                       fs.keywords AS keywords,
                       fs.last_collected_count AS last_collected_count,
                       toString(fs.created_at) AS created_at
                ORDER BY fs.created_at DESC
                """
            )
            return await result.data()

    async def get_feed_source(self, source_id: str) -> dict[str, Any] | None:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (fs:FeedSource {id: $id})
                RETURN fs.id AS id, fs.name AS name, fs.feed_url AS feed_url,
                       fs.feed_type AS feed_type, fs.filter_mode AS filter_mode,
                       fs.enabled AS enabled, fs.max_items AS max_items,
                       toString(fs.last_collected_at) AS last_collected_at,
                       fs.keywords AS keywords,
                       fs.last_collected_count AS last_collected_count,
                       toString(fs.created_at) AS created_at
                """,
                id=source_id,
            )
            record = await result.single()
            return dict(record) if record else None

    async def create_feed_source(
        self,
        *,
        name: str,
        feed_url: str,
        feed_type: str = "rss",
        filter_mode: str = "all",
        enabled: bool = True,
        max_items: int = 10,
        keywords: str | None = None,
    ) -> str:
        source_id = str(uuid.uuid4())
        async with self._driver.session() as s:
            await s.run(
                """
                CREATE (fs:FeedSource {
                    id: $id,
                    name: $name,
                    feed_url: $feed_url,
                    feed_type: $feed_type,
                    filter_mode: $filter_mode,
                    enabled: $enabled,
                    max_items: $max_items,
                    keywords: $keywords,
                    last_collected_at: null,
                    last_collected_count: null,
                    created_at: datetime()
                })
                """,
                id=source_id,
                name=name,
                feed_url=feed_url,
                feed_type=feed_type,
                filter_mode=filter_mode,
                enabled=enabled,
                max_items=max_items,
                keywords=keywords,
            )
        return source_id

    async def update_feed_source(self, source_id: str, **kwargs: Any) -> bool:
        allowed = {"name", "feed_url", "feed_type", "filter_mode", "enabled", "max_items", "keywords"}
        updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not updates:
            return False
        set_clauses = ", ".join(f"fs.{k} = ${k}" for k in updates)
        params = {"id": source_id, **updates}
        async with self._driver.session() as s:
            result = await s.run(
                f"MATCH (fs:FeedSource {{id: $id}}) SET {set_clauses} RETURN fs.id AS id",
                **params,
            )
            record = await result.single()
            return record is not None

    async def delete_feed_source(self, source_id: str) -> bool:
        async with self._driver.session() as s:
            result = await s.run(
                """
                MATCH (fs:FeedSource {id: $id})
                DETACH DELETE fs
                RETURN count(fs) AS deleted
                """,
                id=source_id,
            )
            record = await result.single()
            return bool(record and record["deleted"] > 0)

    async def update_source_collection_status(self, source_id: str, count: int) -> None:
        async with self._driver.session() as s:
            await s.run(
                """
                MATCH (fs:FeedSource {id: $id})
                SET fs.last_collected_at = datetime(),
                    fs.last_collected_count = $count
                """,
                id=source_id,
                count=count,
            )

    async def is_url_already_ingested(self, url: str) -> bool:
        async with self._driver.session() as s:
            result = await s.run(
                "MATCH (d:Document {source_url: $url}) RETURN count(d) AS cnt",
                url=url,
            )
            record = await result.single()
            return bool(record and record["cnt"] > 0)

    async def feed_sources_count(self) -> int:
        async with self._driver.session() as s:
            result = await s.run("MATCH (fs:FeedSource) RETURN count(fs) AS cnt")
            record = await result.single()
            return int(record["cnt"]) if record else 0
