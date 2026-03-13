import logging
import re

import httpx

from app.config import Settings
from app.services.embedder import Embedder
from app.services.neo4j_store import Neo4jStore, _chunks

logger = logging.getLogger(__name__)

RAG_SYSTEM_PROMPT = (
    "당신은 AI Architect의 지식베이스 기반 어시스턴트입니다. "
    "주어진 문맥에 근거해서만 답하고, 근거가 없으면 '확인 불가'라고 명시하세요."
)

RAG_USER_PROMPT = """
아래 검색 문맥을 참고하여 질문에 답변하세요.

요구사항:
1) 한국어로 답변
2) 답변 마지막에 참고 문서 URL을 1~3개 제시
3) 문맥에 없는 내용은 추측하지 말고 "확인 불가"라고 표시

질문:
{query}

검색 문맥:
{context}
""".strip()


class RagService:
    def __init__(self, settings: Settings, store: Neo4jStore, embedder: Embedder) -> None:
        self.settings = settings
        self.store = store
        self.embedder = embedder

    async def ingest(
        self,
        *,
        source_url: str,
        source_type: str,
        title: str,
        category: str,
        summary_text: str,
        raw_text: str,
        summary_date: str | None,
    ) -> tuple[str, bool]:
        # 청킹: summary 우선, raw 보조
        summary_chunks = _chunks(summary_text, chunk_size=700, overlap=80)
        raw_chunks = _chunks(raw_text, chunk_size=900, overlap=150)

        all_texts = [(t, "summary") for t in summary_chunks] + [(t, "raw") for t in raw_chunks]
        texts_only = [t for t, _ in all_texts]

        embeddings = await self.embedder.embed_batch(texts_only) if texts_only else []
        chunk_embeddings = [
            (text, ctype, emb)
            for (text, ctype), emb in zip(all_texts, embeddings)
        ]

        return await self.store.ingest_document(
            source_url=source_url,
            source_type=source_type,
            title=title,
            category=category,
            summary_text=summary_text,
            raw_text=raw_text,
            summary_date=summary_date,
            chunk_embeddings=chunk_embeddings,
        )

    async def search(self, query: str, limit: int, category: str | None) -> list[dict]:
        query_embedding = await self.embedder.embed(query)
        return await self.store.hybrid_search(
            query=query,
            query_embedding=query_embedding,
            limit=limit,
            category=category,
        )

    async def ask(self, query: str, limit: int, category: str | None) -> dict:
        hits = await self.search(query, limit, category)
        if not hits:
            return {
                "answer": "저장된 지식에서 관련 문서를 찾지 못했습니다.",
                "sources": [],
                "hits": [],
            }

        context_parts: list[str] = []
        seen_urls: list[str] = []
        for i, hit in enumerate(hits, start=1):
            url = hit.get("source_url", "")
            if url and url not in seen_urls:
                seen_urls.append(url)
            context_parts.append(
                f"[{i}] title={hit.get('title', '')} category={hit.get('category', '')} "
                f"url={url}\n{hit.get('chunk_text', '')}"
            )
        context = "\n\n".join(context_parts)
        prompt = RAG_USER_PROMPT.replace("{query}", query).replace("{context}", context)

        answer = await self._generate(prompt)
        return {
            "answer": answer,
            "sources": seen_urls[:3],
            "hits": hits,
        }

    async def _generate(self, user_prompt: str) -> str:
        payload = {
            "model": self.settings.openrouter_rag_model,
            "messages": [
                {"role": "system", "content": RAG_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 800,
        }
        headers = {
            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.settings.openrouter_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
