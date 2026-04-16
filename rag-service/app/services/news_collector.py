import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from app.services.content_extractor import ExtractedContent, extract_content, is_valid_content
from app.services.summarizer import classify_category, is_failed_summary, summarize_content

logger = logging.getLogger(__name__)

_AI_KEYWORDS = {
    "ai", "llm", "gpt", "chatgpt", "claude", "gemini", "transformer", "neural",
    "machine learning", "deep learning", "diffusion", "embedding", "rag",
    "fine-tuning", "finetuning", "fine tuning", "prompt", "agent", "openai",
    "anthropic", "mistral", "llama", "hugging face", "huggingface",
    "stable diffusion", "midjourney", "copilot", "langchain",
    "인공지능", "머신러닝", "딥러닝", "생성형", "언어모델", "파인튜닝",
    "sora", "vllm", "pytorch", "tensorflow", "jax", "mlops",
    "multimodal", "멀티모달", "vision language", "reasoning",
}

_REDDIT_USER_AGENT = (
    "Mozilla/5.0 (compatible; NewsCollectorBot/1.0; "
    "+https://github.com/yungs11/news-rag-service)"
)


@dataclass
class FeedEntry:
    title: str
    url: str
    published: str | None = None


@dataclass
class CollectionResult:
    source_name: str
    source_id: str
    total_entries: int = 0
    filtered: int = 0
    collected: int = 0
    skipped_duplicate: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source_name": self.source_name,
            "source_id": self.source_id,
            "total_entries": self.total_entries,
            "filtered": self.filtered,
            "collected": self.collected,
            "skipped_duplicate": self.skipped_duplicate,
            "failed": self.failed,
            "errors": self.errors,
        }


def _matches_ai_filter(title: str) -> bool:
    title_lower = title.lower()
    return any(kw in title_lower for kw in _AI_KEYWORDS)


def _parse_published(raw: str | None) -> datetime | None:
    """RSS published 문자열을 UTC datetime으로 파싱. 실패하면 None."""
    if not raw:
        return None
    try:
        # RFC 2822 (e.g. "Sun, 12 Apr 2026 18:06:29 +0900")
        dt = parsedate_to_datetime(raw)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        # ISO 8601 (e.g. "2026-04-16T04:32:58+09:00")
        dt = datetime.fromisoformat(raw)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        # feedparser의 time struct
        ts = feedparser._parse_date(raw)
        if ts:
            return datetime(*ts[:6], tzinfo=timezone.utc)
    except Exception:
        pass
    return None


def _parse_last_collected(raw: str | None) -> datetime | None:
    """Neo4j에서 가져온 last_collected_at 문자열을 UTC datetime으로 파싱."""
    if not raw:
        return None
    try:
        # Neo4j datetime toString() → "2026-04-15T21:39:03.28Z"
        cleaned = raw.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned).astimezone(timezone.utc)
    except Exception:
        return None


_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _build_arxiv_url(keywords: str, max_items: int) -> str:
    """키워드 문자열에서 arXiv API 쿼리 URL 생성."""
    from urllib.parse import quote_plus
    parts = [kw.strip() for kw in keywords.split(",") if kw.strip()]
    # 각 키워드를 "로 감싸서 구문 검색, 공백 있는 키워드 처리
    terms = []
    for p in parts:
        if " " in p:
            terms.append(f'all:"{p}"')
        else:
            terms.append(f"all:{p}")
    query = quote_plus(" OR ".join(terms))
    return (
        f"https://arxiv.org/api/query?search_query={query}"
        f"&sortBy=submittedDate&sortOrder=descending&max_results={max_items}"
    )


async def fetch_feed_entries(feed_url: str, feed_type: str, max_items: int,
                              keywords: str | None = None) -> list[FeedEntry]:
    # arXiv: keywords로 API URL 생성
    if feed_type == "arxiv":
        if not keywords:
            raise ValueError("arXiv source requires keywords")
        feed_url = _build_arxiv_url(keywords, max_items)

    headers = {
        "User-Agent": _REDDIT_USER_AGENT if feed_type == "reddit_rss" else _BROWSER_UA,
        "Accept": "application/rss+xml,application/xml,text/xml,*/*",
    }

    timeout = 60.0 if feed_type == "arxiv" else 15.0
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(feed_url, headers=headers)
            # arXiv 429 rate limit — 최대 2회 재시도, 30초 간격
            if resp.status_code == 429 and feed_type == "arxiv":
                for attempt in range(1, 3):
                    wait = 30 * attempt
                    logger.warning("arXiv rate limit (429), retry %d/2 after %ds...", attempt, wait)
                    await asyncio.sleep(wait)
                    resp = await client.get(feed_url, headers=headers)
                    if resp.status_code != 429:
                        break
            resp.raise_for_status()
            raw = resp.text
    except Exception as exc:
        logger.warning("Feed fetch failed: url=%s type=%s reason=%s: %s", feed_url[:80], feed_type, exc.__class__.__name__, exc)
        raise

    feed = await asyncio.to_thread(feedparser.parse, raw)

    entries: list[FeedEntry] = []
    for item in feed.entries[:max_items]:
        link = item.get("link", "")
        title = item.get("title", "")
        if not link or not title:
            continue

        # Reddit: link가 comments 페이지일 수 있음 → 실제 외부 링크 우선
        if feed_type == "reddit_rss":
            actual_url = item.get("url", link)
            if actual_url.startswith("https://www.reddit.com/r/") and item.get("link"):
                actual_url = item.get("link", link)
            link = actual_url

        # arXiv: 제목 줄바꿈 정리
        if feed_type == "arxiv":
            title = title.replace("\n", " ").strip()

        published = item.get("published", item.get("updated", None))
        entries.append(FeedEntry(title=title.strip(), url=link.strip(), published=published))

    return entries


async def collect_source(source: dict, settings, rag) -> CollectionResult:
    result = CollectionResult(
        source_name=source["name"],
        source_id=source["id"],
    )

    # 1. Fetch feed entries
    try:
        entries = await fetch_feed_entries(
            source["feed_url"],
            source.get("feed_type", "rss"),
            source.get("max_items", 10),
            keywords=source.get("keywords"),
        )
    except Exception as exc:
        result.errors.append(f"Feed fetch failed: {exc.__class__.__name__}: {str(exc)[:200]}")
        logger.error("Collector: feed fetch failed source=%s error=%s: %s", source["name"], exc.__class__.__name__, exc)
        return result

    result.total_entries = len(entries)
    logger.info("Collector: fetched %d entries from %s", len(entries), source["name"])

    # 2a. Filter by published date (skip entries older than last collection)
    last_collected = _parse_last_collected(source.get("last_collected_at"))
    if last_collected:
        before_count = len(entries)
        new_entries = []
        for e in entries:
            pub_dt = _parse_published(e.published)
            if pub_dt is None or pub_dt > last_collected:
                new_entries.append(e)
        entries = new_entries
        skipped_old = before_count - len(entries)
        if skipped_old > 0:
            logger.info("Collector: skipped %d old entries (before %s) from %s", skipped_old, last_collected.isoformat(), source["name"])

    # 2b. Filter by mode (ai_only / all)
    filter_mode = source.get("filter_mode", "all")
    if filter_mode == "ai_only":
        entries = [e for e in entries if _matches_ai_filter(e.title)]
    result.filtered = len(entries)
    logger.info("Collector: %d entries after filter (%s) from %s", len(entries), filter_mode, source["name"])

    # 3. Process each entry
    for entry in entries:
        try:
            # Check duplicate in DB first (faster than full pipeline)
            already = await rag.store.is_url_already_ingested(entry.url)
            if already:
                result.skipped_duplicate += 1
                logger.debug("Collector: skip duplicate url=%s", entry.url)
                continue

            # Extract content
            content = await asyncio.to_thread(extract_content, entry.url, settings.http_timeout_seconds)

            if not is_valid_content(content.content):
                result.failed += 1
                result.errors.append(f"Invalid content: {entry.url}")
                continue

            # Classify category
            category = await classify_category(
                content.title,
                content.content[:800],
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                model=settings.openrouter_summary_model,
            )

            # Summarize
            summary = await summarize_content(
                content,
                category=category,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                model=settings.openrouter_summary_model,
                system_prompt=settings.summary_system_prompt,
                user_prompt_template=settings.summary_user_prompt_template,
            )

            if is_failed_summary(summary):
                result.failed += 1
                result.errors.append(f"Summary failed: {entry.url}")
                continue

            # Ingest
            from datetime import date as _date
            doc_id, created = await rag.ingest(
                source_url=content.url,
                source_type=content.source_type,
                title=content.title,
                category=category,
                summary_text=summary,
                raw_text=content.content,
                summary_date=_date.today().isoformat(),
                user_id=settings.collector_user_id,
                collected_from=source["name"],
            )

            if created:
                result.collected += 1
                logger.info("Collector: ingested doc_id=%s title=%r source=%s", doc_id, content.title[:60], source["name"])
            else:
                result.skipped_duplicate += 1

        except Exception as exc:
            result.failed += 1
            error_msg = f"{entry.url}: {exc.__class__.__name__}: {exc}"
            result.errors.append(error_msg[:200])
            logger.warning("Collector: entry failed url=%s error=%s", entry.url, exc)

        # Rate limiting (arXiv은 3초 권장)
        delay = 3.0 if source.get("feed_type") == "arxiv" else 1.5
        await asyncio.sleep(delay)

    return result


async def run_all_sources(settings, store, rag) -> list[CollectionResult]:
    sources = await store.list_feed_sources()
    enabled = [s for s in sources if s.get("enabled")]

    if not enabled:
        logger.info("Collector: no enabled sources, skipping")
        return []

    logger.info("Collector: starting collection cycle, %d enabled sources", len(enabled))
    t_start = time.perf_counter()

    results: list[CollectionResult] = []
    for source in enabled:
        try:
            result = await collect_source(source, settings, rag)
            results.append(result)

            # Update source status in DB
            await store.update_source_collection_status(source["id"], result.collected)

        except Exception as exc:
            logger.exception("Collector: source failed name=%s", source["name"])
            results.append(CollectionResult(
                source_name=source["name"],
                source_id=source["id"],
                errors=[str(exc)],
            ))

        # Delay between sources
        await asyncio.sleep(2)

    elapsed = time.perf_counter() - t_start
    total_collected = sum(r.collected for r in results)
    total_failed = sum(r.failed for r in results)
    logger.info(
        "Collector: cycle done in %.1fs — collected=%d failed=%d sources=%d",
        elapsed, total_collected, total_failed, len(results),
    )
    return results


# ── Default seed sources ──────────────────────────────────────────────────────

DEFAULT_SOURCES = [
    {
        "name": "GeekNews",
        "feed_url": "https://news.hada.io/rss/news",
        "feed_type": "rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
    {
        "name": "PyTorch Blog",
        "feed_url": "https://pytorch.org/blog/feed.xml",
        "feed_type": "rss",
        "filter_mode": "all",
        "max_items": 5,
    },
    {
        "name": "goddaehee Blog",
        "feed_url": "https://goddaehee.tistory.com/rss",
        "feed_type": "rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
    {
        "name": "Reddit MachineLearning",
        "feed_url": "https://www.reddit.com/r/MachineLearning/.rss",
        "feed_type": "reddit_rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
]


async def seed_default_sources(store) -> None:
    count = await store.feed_sources_count()
    if count > 0:
        return
    logger.info("Collector: seeding %d default feed sources", len(DEFAULT_SOURCES))
    for src in DEFAULT_SOURCES:
        await store.create_feed_source(**src)
    logger.info("Collector: default sources seeded")
