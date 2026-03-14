import os
from dataclasses import dataclass

from dotenv import load_dotenv

from app.prompts import SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT_TEMPLATE

load_dotenv()


def _env_text(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.replace("\\n", "\n")


@dataclass(frozen=True)
class Settings:
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    openrouter_api_key: str
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_rag_model: str = "openai/gpt-4o-mini"
    openrouter_summary_model: str = "openai/gpt-4o-mini"
    embedding_model: str = "nlpai-lab/KURE-v1"
    embedding_dim: int = 1024
    http_timeout_seconds: int = 15
    allowed_user_ids: frozenset = frozenset()
    summary_system_prompt: str = SUMMARY_SYSTEM_PROMPT
    summary_user_prompt_template: str = SUMMARY_USER_PROMPT_TEMPLATE

    @staticmethod
    def from_env() -> "Settings":
        raw = os.getenv("ALLOWED_USER_IDS", "")
        allowed = frozenset(uid.strip() for uid in raw.split(",") if uid.strip())
        default_model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
        return Settings(
            neo4j_uri=os.environ["NEO4J_URI"],
            neo4j_user=os.environ["NEO4J_USER"],
            neo4j_password=os.environ["NEO4J_PASSWORD"],
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
            openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            openrouter_rag_model=os.getenv("OPENROUTER_RAG_MODEL", default_model),
            openrouter_summary_model=os.getenv("OPENROUTER_SUMMARY_MODEL", default_model),
            embedding_model=os.getenv("EMBEDDING_MODEL", "nlpai-lab/KURE-v1"),
            embedding_dim=int(os.getenv("EMBEDDING_DIM", "1024")),
            http_timeout_seconds=int(os.getenv("HTTP_TIMEOUT_SECONDS", "15")),
            allowed_user_ids=allowed,
            summary_system_prompt=_env_text("SUMMARY_SYSTEM_PROMPT", SUMMARY_SYSTEM_PROMPT),
            summary_user_prompt_template=_env_text("SUMMARY_USER_PROMPT_TEMPLATE", SUMMARY_USER_PROMPT_TEMPLATE),
        )
