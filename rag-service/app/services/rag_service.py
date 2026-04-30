import json
import logging
import re
from typing import AsyncIterator

import httpx

from app.config import Settings
from app.services.embedder import Embedder
from app.services.neo4j_store import Neo4jStore, _chunks

logger = logging.getLogger(__name__)


class _StreamingThinkingFilter:
    """스트리밍 델타에서 thinking 블록을 제거한다.

    업스트림 토큰이 `<think>...</think>` 또는 `Thinking...\\n---\\n` 형식이면
    본문이 시작될 때까지 버퍼만 쌓고, 본문 시작 마커를 만나면 그 뒤부터 emit.
    thinking이 없으면 즉시 passthrough.
    """

    END_MARKERS = (
        "</think>", "\n---\n", "\n\n\n",
        "[핵심", "[주요", "**요약", "**Summary", "## 요약", "## Summary",
    )

    def __init__(self) -> None:
        self.buf = ""
        self.state = "detecting"  # detecting | thinking | passthrough
        self.emitted_len = 0

    def feed(self, chunk: str) -> str:
        self.buf += chunk

        if self.state == "detecting":
            head = self.buf.lstrip()
            if len(head) < 15:
                return ""
            if head.startswith("<think>") or head.startswith("Thinking"):
                self.state = "thinking"
            else:
                self.state = "passthrough"
                self.emitted_len = len(self.buf)
                return self.buf

        if self.state == "thinking":
            for marker in self.END_MARKERS:
                idx = self.buf.find(marker)
                if idx >= 0:
                    skip = len(marker) if marker in ("</think>", "\n---\n", "\n\n\n") else 0
                    tail = self.buf[idx + skip:].lstrip()
                    self.state = "passthrough"
                    self.emitted_len = len(self.buf)
                    return tail
            return ""

        out = self.buf[self.emitted_len:]
        self.emitted_len = len(self.buf)
        return out

    def finalize(self) -> str:
        if self.state != "passthrough":
            from app.services.openrouter_client import _strip_thinking
            return _strip_thinking(self.buf)
        return ""

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
        self._rag_base_url_override: str | None = None
        self._rag_api_key_override: str | None = None

    async def refresh_model(self) -> None:
        """Neo4j에서 최신 모델 설정을 로드한다."""
        mc = await self.store.get_model_config()
        if mc:
            self._rag_model_override = mc["rag_model"]
            self._rag_base_url_override = mc.get("rag_base_url") or None
            self._rag_api_key_override = mc.get("rag_api_key") or None
        else:
            self._rag_model_override = None
            self._rag_base_url_override = None
            self._rag_api_key_override = None

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
                     document_id: str | None = None, source: str | None = None) -> list[dict]:
        query_embedding = await self.embedder.embed(query)
        return await self.store.hybrid_search(
            query=query,
            query_embedding=query_embedding,
            limit=limit,
            category=category,
            user_id=user_id,
            document_id=document_id,
            source=source,
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
            "Authorization": f"Bearer {self._rag_api_key_override or self.settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._rag_base_url_override or self.settings.openrouter_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"].get("content") or ""
            return content.strip()

    async def _generate_stream(
        self,
        user_prompt: str,
        history: list[dict] | None = None,
        system_prompt: str | None = None,
    ) -> AsyncIterator[str]:
        messages: list[dict] = [{"role": "system", "content": system_prompt or RAG_SYSTEM_PROMPT}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": user_prompt})
        payload = {
            "model": self._rag_model_override or self.settings.openrouter_rag_model,
            "messages": messages,
            "temperature": 0.2,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {self._rag_api_key_override or self.settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self._rag_base_url_override or self.settings.openrouter_base_url}/chat/completions"

        flt = _StreamingThinkingFilter()
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if delta:
                        out = flt.feed(delta)
                        if out:
                            yield out
        tail = flt.finalize()
        if tail:
            yield tail

    async def ask_stream(
        self,
        query: str,
        limit: int,
        category: str | None,
        user_id: str | None = None,
        document_id: str | None = None,
        history: list[dict] | None = None,
        attached_context: str | None = None,
    ) -> AsyncIterator[tuple[str, dict]]:
        hits = await self.search(query, limit, category, user_id=user_id, document_id=document_id)

        attached_part = ""
        if attached_context:
            attached_part = f"\n\n첨부 파일 내용:\n{attached_context[:8000]}"

        seen_urls: list[str] = []
        seen_doc_ids: set[str] = set()
        source_docs: list[dict] = []
        for h in hits:
            url = h.get("source_url", "")
            if url and url not in seen_urls:
                seen_urls.append(url)
            did = h.get("document_id")
            if did and did not in seen_doc_ids:
                seen_doc_ids.add(did)
                source_docs.append({
                    "document_id": did,
                    "title": h.get("title", ""),
                    "source_url": url,
                })

        yield ("hits", {"hits": hits, "sources": seen_urls[:3], "source_docs": source_docs})

        if not hits and not attached_context:
            if history:
                async for delta in self._generate_stream(query, history=history, system_prompt=CONV_SYSTEM_PROMPT):
                    yield ("delta", {"text": delta})
            else:
                yield ("delta", {"text": "저장된 지식에서 관련 문서를 찾지 못했습니다."})
            yield ("done", {})
            return

        context_parts = [
            f"[{i}] title={h.get('title', '')} category={h.get('category', '')} "
            f"url={h.get('source_url', '')}\n{h.get('chunk_text', '')}"
            for i, h in enumerate(hits, start=1)
        ]
        context = "\n\n".join(context_parts) + attached_part
        prompt = RAG_USER_PROMPT.replace("{query}", query).replace("{context}", context)

        async for delta in self._generate_stream(prompt, history=history):
            yield ("delta", {"text": delta})
        yield ("done", {})
