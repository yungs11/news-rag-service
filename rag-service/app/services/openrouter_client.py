import asyncio
import logging
import os
import time

import httpx
from openai import OpenAI

logger = logging.getLogger(__name__)

# 로컬 vLLM(Qwen 27B 등)은 e2e 57s 평균 + 긴 generation 시 120s 넘기는 경우 빈번.
# 환경변수 LLM_HTTP_TIMEOUT로 조정 가능 (기본 300s).
_LLM_HTTP_TIMEOUT = float(os.getenv("LLM_HTTP_TIMEOUT", "300"))

# Qwen3 thinking mode 비활성화 (chat_template_kwargs={"enable_thinking": False}).
# vLLM/Qwen3에서 thinking 토큰을 생성하지 않으면 동일 요약이 8x 빨라짐.
# OpenAI/OpenRouter에선 무시되며 (호환 path), vLLM Qwen3 경로에서만 효과.
# LLM_DISABLE_THINKING=false 로 끌 수 있음.
_LLM_DISABLE_THINKING = os.getenv("LLM_DISABLE_THINKING", "true").lower() in ("true", "1", "yes")


def _strip_thinking(text: str) -> str:
    """모델의 thinking/reasoning 출력을 제거한다."""
    import re
    # <think>...</think> 태그 제거
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    # "Thinking Process:" 또는 "Thinking:" 블록 제거 (본문 시작 전까지)
    # 패턴: "Thinking" 으로 시작해서 빈 줄 2개 이상 또는 "---" 구분선 이후가 본문
    if text.startswith("Thinking"):
        # "---" 구분선 이후를 본문으로
        if "\n---\n" in text:
            text = text.split("\n---\n", 1)[-1].strip()
        # 또는 "\n\n\n" 이후
        elif "\n\n\n" in text:
            text = text.split("\n\n\n", 1)[-1].strip()
        # 또는 마지막 "**Summary" / "**요약" / "[핵심" 등의 섹션 헤더부터
        for marker in ("[핵심", "[주요", "**요약", "**Summary", "## 요약", "## Summary"):
            idx = text.find(marker)
            if idx > 0:
                text = text[idx:].strip()
                break
    return text


def _normalize_message_content(raw_content: str | list | None) -> str:
    if isinstance(raw_content, str):
        return _strip_thinking(raw_content.strip())

    if isinstance(raw_content, list):
        parts: list[str] = []
        for part in raw_content:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return _strip_thinking("\n".join(parts).strip())

    return ""


def _call_via_httpx(
    base_url: str, model: str, system_prompt: str, user_prompt: str,
    api_key: str, temperature: float, max_tokens: int | None,
) -> str:
    """OpenAI SDK 없이 직접 httpx로 호출 (로컬/커스텀 서버용)."""
    started = time.perf_counter()
    logger.info("LLM request start (httpx): model=%s prompt_chars=%d", model, len(user_prompt))

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    if _LLM_DISABLE_THINKING:
        # Qwen3의 thinking 토큰 생성을 끄면 ~8x 빠르고 출력도 깨끗.
        payload["chat_template_kwargs"] = {"enable_thinking": False}

    with httpx.Client(timeout=_LLM_HTTP_TIMEOUT) as client:
        resp = client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"].get("content") or ""
    text = _normalize_message_content(content)
    if not text:
        raise ValueError("모델 응답 텍스트를 추출하지 못했습니다.")

    elapsed = time.perf_counter() - started
    logger.info("LLM request done (httpx): model=%s elapsed=%.2fs output_chars=%d", model, elapsed, len(text))
    return text


async def generate_chat_text(
    *,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    # OpenRouter가 아닌 커스텀 서버는 httpx로 직접 호출
    is_openrouter = "openrouter.ai" in base_url
    if not is_openrouter:
        return await asyncio.to_thread(
            _call_via_httpx, base_url, model, system_prompt, user_prompt,
            api_key, temperature, max_tokens,
        )

    if not api_key:
        raise ValueError("OPENROUTER_API_KEY가 설정되지 않았습니다.")

    client = OpenAI(api_key=api_key, base_url=base_url)

    def _call_model() -> str:
        started = time.perf_counter()
        logger.info(
            "LLM request start: model=%s prompt_chars=%d max_tokens=%s",
            model,
            len(user_prompt),
            str(max_tokens),
        )
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        if not response.choices:
            raise ValueError("모델 응답이 비어 있습니다.")

        message = response.choices[0].message
        text = _normalize_message_content(message.content)
        if not text:
            raise ValueError("모델 응답 텍스트를 추출하지 못했습니다.")

        elapsed = time.perf_counter() - started
        logger.info(
            "LLM request done: model=%s elapsed=%.2fs output_chars=%d",
            model,
            elapsed,
            len(text),
        )
        return text

    return await asyncio.to_thread(_call_model)
