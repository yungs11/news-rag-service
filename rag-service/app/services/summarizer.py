from app.prompts import (
    AI_LLM_SECTION,
    CLASSIFY_SYSTEM,
    CLASSIFY_USER,
    FILE_SYSTEM_PROMPT,
    FILE_USER_PROMPT_TEMPLATE,
    VALID_CATEGORIES,
    YOUTUBE_SYSTEM_PROMPT,
    YOUTUBE_USER_PROMPT_TEMPLATE,
)
from app.services.content_extractor import ExtractedContent
from app.services.openrouter_client import generate_chat_text

_FAILURE_KEYWORDS = ("요약불가", "알 수 없", "확인 불가", "접근 불가", "내용을 읽을 수 없", "요약할 수 없")

_FILE_SOURCE_TYPES = {"pdf", "docx"}


def _build_prompt(content: ExtractedContent, template: str, category: str) -> str:
    ai_llm_section = AI_LLM_SECTION if category == "AI/LLM" else ""
    return (
        template.replace("{source_type}", content.source_type)
        .replace("{title}", content.title)
        .replace("{url}", content.url)
        .replace("{category}", category)
        .replace("{ai_llm_section}", ai_llm_section)
        .replace("{content}", content.content)
    )


async def summarize_content(
    content: ExtractedContent,
    category: str,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt_template: str,
) -> str:
    # 소스 타입별 전용 프롬프트 사용
    if content.source_type in _FILE_SOURCE_TYPES:
        sys_prompt = FILE_SYSTEM_PROMPT
        tmpl = FILE_USER_PROMPT_TEMPLATE
    elif content.source_type == "youtube":
        sys_prompt = YOUTUBE_SYSTEM_PROMPT
        tmpl = YOUTUBE_USER_PROMPT_TEMPLATE
    else:
        sys_prompt = system_prompt
        tmpl = user_prompt_template

    prompt = _build_prompt(content, tmpl, category)
    return await generate_chat_text(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=sys_prompt,
        user_prompt=prompt,
        temperature=0.2,
    )


def is_failed_summary(text: str) -> bool:
    return any(kw in text for kw in _FAILURE_KEYWORDS)


async def classify_category(
    title: str,
    summary: str,
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    prompt = CLASSIFY_USER.replace("{title}", title).replace("{summary}", summary[:800])
    result = await generate_chat_text(
        api_key=api_key,
        base_url=base_url,
        model=model,
        system_prompt=CLASSIFY_SYSTEM,
        user_prompt=prompt,
        temperature=0.0,
    )
    category = result.strip().strip("\"'")
    return category if category in VALID_CATEGORIES else "Other"
