import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    openrouter_api_key: str
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_rag_model: str = "openai/gpt-4o-mini"
    embedding_model: str = "nlpai-lab/KURE-v1"
    embedding_dim: int = 1024

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            neo4j_uri=os.environ["NEO4J_URI"],
            neo4j_user=os.environ["NEO4J_USER"],
            neo4j_password=os.environ["NEO4J_PASSWORD"],
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
            openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            openrouter_rag_model=os.getenv("OPENROUTER_RAG_MODEL", "openai/gpt-4o-mini"),
            embedding_model=os.getenv("EMBEDDING_MODEL", "nlpai-lab/KURE-v1"),
            embedding_dim=int(os.getenv("EMBEDDING_DIM", "1024")),
        )
