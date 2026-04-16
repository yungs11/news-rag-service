import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import cloudscraper
import feedparser
import httpx
from bs4 import BeautifulSoup

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

@dataclass
class FeedEntry:
    title: str
    url: str
    published: str | None = None
    source_label: str | None = None  # 개별 채널/출처 이름 (collected_from에 사용)
    pre_content: str | None = None  # RSS 본문 (Reddit self-post 등)


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
    skipped_no_date: list[dict] = field(default_factory=list)

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
            "skipped_no_date": self.skipped_no_date,
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


async def _fetch_youtube_channel_single(channel_url: str, max_items: int) -> list[FeedEntry]:
    """yt-dlp로 단일 YouTube 채널의 최근 영상 목록 추출."""
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        raise ValueError("yt-dlp is not installed")

    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playlistend": max_items,
    }

    def _extract():
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(channel_url, download=False)

    info = await asyncio.to_thread(_extract)
    # 채널 이름 추출
    channel_name = (info.get("channel") or info.get("uploader") or info.get("title") or "").replace(" - Videos", "").strip()

    entries: list[FeedEntry] = []
    for e in (info.get("entries") or [])[:max_items]:
        vid = e.get("id", "")
        title = e.get("title", "")
        if not vid or not title:
            continue
        url = f"https://www.youtube.com/watch?v={vid}"
        entries.append(FeedEntry(title=title.strip(), url=url, source_label=channel_name or None))
    return entries


async def _fetch_youtube_channels(keywords: str | None, feed_url: str, max_items: int) -> list[FeedEntry]:
    """여러 YouTube 채널에서 영상 목록 추출. keywords에 채널 핸들 목록 (쉼표 구분)."""
    if keywords:
        handles = [h.strip().lstrip("@") for h in keywords.split(",") if h.strip()]
        urls = [f"https://www.youtube.com/@{h}/videos" for h in handles]
    elif feed_url:
        urls = [feed_url]
    else:
        return []

    per_channel = max(1, max_items // len(urls)) if urls else max_items
    all_entries: list[FeedEntry] = []
    for url in urls:
        try:
            entries = await _fetch_youtube_channel_single(url, per_channel)
            all_entries.extend(entries)
            logger.info("YouTube channel fetch: url=%s entries=%d", url, len(entries))
        except Exception as exc:
            logger.warning("YouTube channel fetch failed: url=%s error=%s", url, exc)
        await asyncio.sleep(2)

    return all_entries[:max_items]


def _fetch_arca_entries(board_url: str, max_items: int) -> list[FeedEntry]:
    """arca.live 게시판에서 최신 글 목록 + 본문을 cloudscraper로 가져온다."""
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "linux", "desktop": True},
    )
    resp = scraper.get(board_url, timeout=20)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    entries: list[FeedEntry] = []

    for row in soup.select("a.vrow.column"):
        # Notice, 광고 제외
        classes = row.get("class", [])
        if "notice" in classes:
            continue
        href = row.get("href", "")
        if not href or "subscribe" in href or "notificate" in href:
            continue

        title_el = row.select_one(".col-title")
        title = title_el.get_text(strip=True) if title_el else ""
        if not title:
            continue

        time_el = row.select_one("time[datetime]")
        published = time_el["datetime"] if time_el else None

        full_url = f"https://arca.live{href.split('?')[0]}" if href.startswith("/") else href

        # 개별 게시글 본문도 cloudscraper로 가져오기 (Cloudflare 우회)
        pre_content = None
        try:
            article_resp = scraper.get(full_url, timeout=20)
            if article_resp.status_code == 200:
                article_soup = BeautifulSoup(article_resp.text, "html.parser")
                body = article_soup.select_one(".article-body")
                if body:
                    pre_content = body.get_text(separator=" ", strip=True)
        except Exception as exc:
            logger.warning("Arca article fetch failed: url=%s error=%s", full_url, exc)

        entries.append(FeedEntry(title=title, url=full_url, published=published, pre_content=pre_content))

        if len(entries) >= max_items:
            break

        time.sleep(1)  # rate limiting

    return entries


async def fetch_feed_entries(feed_url: str, feed_type: str, max_items: int,
                              keywords: str | None = None) -> list[FeedEntry]:
    # arca.live 게시판 (cloudscraper 기반)
    if feed_type == "arca_live":
        return await asyncio.to_thread(_fetch_arca_entries, feed_url, max_items)

    # YouTube 채널 (yt-dlp 기반)
    if feed_type == "youtube_channel":
        return await _fetch_youtube_channels(keywords, feed_url, max_items)

    # arXiv: keywords로 API URL 생성
    if feed_type == "arxiv":
        if not keywords:
            raise ValueError("arXiv source requires keywords")
        feed_url = _build_arxiv_url(keywords, max_items)

    if feed_type == "reddit_rss":
        # Reddit은 봇 UA + RSS Accept 헤더 조합을 차단 → 브라우저형 헤더 사용
        headers = {
            "User-Agent": _BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        }
    else:
        headers = {
            "User-Agent": _BROWSER_UA,
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

        # Reddit: RSS content에서 본문 텍스트 추출 (self-post / link-post 공통)
        # Reddit RSS의 link는 항상 reddit.com 게시물 URL, content에 HTML 본문 포함
        pre_content = None
        if feed_type == "reddit_rss":
            raw_html = ""
            content_list = item.get("content", [])
            if content_list and isinstance(content_list, list):
                raw_html = content_list[0].get("value", "")
            if not raw_html:
                raw_html = item.get("summary", "")
            if raw_html:
                soup = BeautifulSoup(raw_html, "html.parser")
                pre_content = soup.get_text(separator=" ").strip()

        # arXiv: 제목 줄바꿈 정리
        if feed_type == "arxiv":
            title = title.replace("\n", " ").strip()

        published = item.get("published", item.get("updated", None))
        entries.append(FeedEntry(
            title=title.strip(), url=link.strip(), published=published,
            pre_content=pre_content,
        ))

    return entries


async def collect_source(source: dict, settings, rag, summary_model: str | None = None) -> CollectionResult:
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
            if pub_dt is None:
                result.skipped_no_date.append({"title": e.title, "url": e.url})
                logger.warning("Collector: skipping entry without date: %s", e.title[:60])
                continue
            if pub_dt > last_collected:
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
            if entry.pre_content and is_valid_content(entry.pre_content):
                # RSS 본문이 이미 있는 경우 (Reddit self-post 등)
                content = ExtractedContent(
                    url=entry.url,
                    source_type="blog",
                    title=entry.title,
                    content=entry.pre_content,
                )
                logger.info("Collector: using pre-extracted RSS content url=%s chars=%d", entry.url, len(entry.pre_content))
            else:
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
                model=summary_model or settings.openrouter_summary_model,
            )

            # Summarize
            summary = await summarize_content(
                content,
                category=category,
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                model=summary_model or settings.openrouter_summary_model,
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
                collected_from=entry.source_label or source["name"],
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
        delay = 3.0 if source.get("feed_type") in ("arxiv", "youtube_channel") else 1.5
        await asyncio.sleep(delay)

    return result


async def run_all_sources(settings, store, rag, summary_model: str | None = None) -> list[CollectionResult]:
    sources = await store.list_feed_sources()
    enabled = [s for s in sources if s.get("enabled")]

    if not enabled:
        logger.info("Collector: no enabled sources, skipping")
        return []

    # 동적 모델 조회
    if not summary_model:
        mc = await store.get_model_config()
        if mc:
            summary_model = mc["summary_model"]

    logger.info("Collector: starting collection cycle, %d enabled sources, model=%s", len(enabled), summary_model or "default")
    t_start = time.perf_counter()

    results: list[CollectionResult] = []
    for source in enabled:
        try:
            result = await collect_source(source, settings, rag, summary_model=summary_model)
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
    {
        "name": "Reddit AI_Agents",
        "feed_url": "https://www.reddit.com/r/AI_Agents/.rss",
        "feed_type": "reddit_rss",
        "filter_mode": "all",
        "max_items": 10,
    },
    {
        "name": "Reddit ArtificialInteligence",
        "feed_url": "https://www.reddit.com/r/ArtificialInteligence/.rss",
        "feed_type": "reddit_rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
    {
        "name": "AI타임즈",
        "feed_url": "https://www.aitimes.com/rss/allArticle.xml",
        "feed_type": "rss",
        "filter_mode": "all",
        "max_items": 10,
    },
    {
        "name": "전자신문 AI",
        "feed_url": "https://www.etnews.com/rss/Section901.xml",
        "feed_type": "rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
    {
        "name": "HuggingFace Blog",
        "feed_url": "https://huggingface.co/blog/feed.xml",
        "feed_type": "rss",
        "filter_mode": "all",
        "max_items": 10,
    },
    {
        "name": "Simon Willison Blog",
        "feed_url": "https://simonwillison.net/atom/everything/",
        "feed_type": "rss",
        "filter_mode": "ai_only",
        "max_items": 10,
    },
    {
        "name": "아카라이브 알파카",
        "feed_url": "https://arca.live/b/alpaca",
        "feed_type": "arca_live",
        "filter_mode": "all",
        "max_items": 15,
    },
]


async def seed_default_sources(store) -> None:
    existing_urls = await store.get_feed_source_urls()
    new_sources = [s for s in DEFAULT_SOURCES if s["feed_url"] not in existing_urls]
    if not new_sources:
        logger.info("Collector: all default sources already exist, skipping seed")
        return
    logger.info("Collector: seeding %d new default feed sources", len(new_sources))
    for src in new_sources:
        await store.create_feed_source(**src)
    logger.info("Collector: default sources seeded (%d new)", len(new_sources))
