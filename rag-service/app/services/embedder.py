import asyncio
import logging
from functools import partial

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class Embedder:
    def __init__(self, model: str = "nlpai-lab/KURE-v1") -> None:
        logger.info("Loading embedding model: %s (HuggingFace)", model)
        self._model = SentenceTransformer(model, trust_remote_code=True)
        logger.info("Embedding model loaded - dim=%d", self._model.get_sentence_embedding_dimension())

    async def embed(self, text: str) -> list[float]:
        text = text.replace("\n", " ").strip()
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, partial(self._model.encode, text, normalize_embeddings=True)
        )
        return result.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        import time
        cleaned = [t.replace("\n", " ").strip() for t in texts]
        t0 = time.perf_counter()
        logger.info("Embedding start: chunks=%d", len(cleaned))
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, partial(self._model.encode, cleaned, normalize_embeddings=True)
        )
        logger.info("Embedding done: chunks=%d elapsed=%.2fs", len(cleaned), time.perf_counter() - t0)
        return [r.tolist() for r in result]
