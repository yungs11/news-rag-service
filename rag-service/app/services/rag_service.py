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

CONV_SYSTEM_PROMPT = (
    "당신은 AI Architect의 지식베이스 기반 어시스턴트입니다. "
    "이전 대화 내역을 참고하여 사용자의 질문에 한국어로 친절하게 답변하세요."
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
        self._rag_model_override: str | None = None

    async def refresh_model(self) -> None:
        """Neo4j에서 최신 모델 설정을 로드한다."""
        mc = await self.store.get_model_config()
        self._rag_model_override = mc["rag_model"] if mc else None

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
        user_id: str | None = None,
        collected_from: str | None = None,
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
            user_id=user_id,
            collected_from=collected_from,
        )

    async def delete_document(self, document_id: str) -> bool:
        return await self.store.delete_document(document_id)

    async def search(self, query: str, limit: int, category: str | None, user_id: str | None = None,
                     document_id: str | None = None) -> list[dict]:
        query_embedding = await self.embedder.embed(query)
        return await self.store.hybrid_search(
            query=query,
            query_embedding=query_embedding,
            limit=limit,
            category=category,
            user_id=user_id,
            document_id=document_id,
        )

    async def ask(self, query: str, limit: int, category: str | None, user_id: str | None = None,
                  document_id: str | None = None, history: list[dict] | None = None,
                  attached_context: str | None = None) -> dict:
        hits = await self.search(query, limit, category, user_id=user_id, document_id=document_id)

        # 첨부 파일 컨텍스트 (최대 8000자)
        attached_part = ""
        if attached_context:
            trimmed = attached_context[:8000]
            attached_part = f"\n\n첨부 파일 내용:\n{trimmed}"

        if not hits and not attached_context:
            if history:
                answer = await self._generate(query, history=history, system_prompt=CONV_SYSTEM_PROMPT)
                return {"answer": answer, "sources": [], "hits": []}
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
        context = "\n\n".join(context_parts) + attached_part
        prompt = RAG_USER_PROMPT.replace("{query}", query).replace("{context}", context)

        answer = await self._generate(prompt, history=history)
        return {
            "answer": answer,
            "sources": seen_urls[:3],
            "hits": hits,
        }

    async def _generate(self, user_prompt: str, history: list[dict] | None = None,
                        system_prompt: str | None = None) -> str:
        messages: list[dict] = [{"role": "system", "content": system_prompt or RAG_SYSTEM_PROMPT}]
        # 이전 대화 턴 포함 (최근 6개 메시지 = 3턴)
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": user_prompt})
        payload = {
            "model": self._rag_model_override or self.settings.openrouter_rag_model,
            "messages": messages,
            "temperature": 0.2,
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
