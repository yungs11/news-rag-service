from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


SourceType = Literal["youtube", "news", "blog", "pdf", "docx", "other"]
Category = Literal["AI/LLM", "Infra", "DB", "Product", "Business", "Financial", "Other"]


class IngestRequest(BaseModel):
    source_url: str
    source_type: SourceType = "other"
    title: str
    category: Category = "Other"
    summary_text: str
    raw_text: str
    summary_date: date | None = None
    user_id: str | None = None


class IngestResponse(BaseModel):
    document_id: str
    created: bool  # False = 중복으로 기존 document_id 반환


class SearchRequest(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1, le=20)
    category: Category | None = None
    user_id: str | None = None


class SearchItem(BaseModel):
    document_id: str
    source_url: str
    title: str
    category: str
    source_type: str
    summary_date: str | None
    summary_text: str
    chunk_text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    count: int
    items: list[SearchItem]


class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AskRequest(BaseModel):
    query: str
    limit: int = Field(default=6, ge=1, le=20)
    category: Category | None = None
    user_id: str | None = None
    document_id: str | None = None
    history: list[HistoryMessage] | None = None


class AskResponse(BaseModel):
    query: str
    answer: str
    sources: list[str]
    hits: list[SearchItem]


class DocumentDetail(BaseModel):
    id: str
    source_url: str
    source_type: str
    title: str
    category: str
    summary_text: str
    raw_text: str | None = None
    summary_date: str | None
    ingest_type: str = "manual"  # "auto" | "manual"
    collected_from: str | None = None  # 자동 수집 소스 이름
    created_at: str


class RecentDocumentsResponse(BaseModel):
    count: int
    items: list[DocumentDetail]


class CategoryItem(BaseModel):
    category: str
    document_count: int


class CategoriesResponse(BaseModel):
    items: list[CategoryItem]


class SummarizeRequest(BaseModel):
    url: str
    user_id: str | None = None


class SummarizeResponse(BaseModel):
    status: Literal["ok", "failed"]
    message: str
    summary: str | None = None
    title: str | None = None
    category: str | None = None
    source_type: str | None = None
    document_id: str | None = None
    created: bool | None = None


# ── Feed Source (Collector) ──────────────────────────────────────────────────

FilterMode = Literal["all", "ai_only"]
FeedType = Literal["rss", "reddit_rss", "arxiv", "youtube_channel", "arca_live"]


class FeedSourceCreate(BaseModel):
    name: str
    feed_url: str = ""
    feed_type: FeedType = "rss"
    filter_mode: FilterMode = "all"
    enabled: bool = True
    max_items: int = Field(default=10, ge=1, le=50)
    keywords: str | None = None  # arXiv 검색 키워드 (쉼표 구분)
    retain: bool = False  # True면 이 소스의 문서는 자동 삭제에서 제외


class FeedSourceUpdate(BaseModel):
    name: str | None = None
    feed_url: str | None = None
    feed_type: FeedType | None = None
    filter_mode: FilterMode | None = None
    enabled: bool | None = None
    max_items: int | None = Field(default=None, ge=1, le=50)
    keywords: str | None = None
    retain: bool | None = None


class FeedSourceDetail(BaseModel):
    id: str
    name: str
    feed_url: str
    feed_type: str
    filter_mode: str
    enabled: bool
    max_items: int
    keywords: str | None = None
    retain: bool = False
    last_collected_at: str | None
    last_collected_count: int | None
    created_at: str


class FeedSourceListResponse(BaseModel):
    sources: list[FeedSourceDetail]


class CollectionResultItem(BaseModel):
    source_name: str
    source_id: str
    total_entries: int
    filtered: int
    collected: int
    skipped_duplicate: int
    failed: int
    errors: list[str]
    skipped_no_date: list[dict] = []


class CollectionRunResponse(BaseModel):
    status: str
    results: list[CollectionResultItem]


class CollectorStatusResponse(BaseModel):
    last_run: str | None
    results: list[CollectionResultItem]


# ── Retention / Cleanup ──────────────────────────────────────────────────────

class RetentionSettings(BaseModel):
    days: int = Field(default=7, ge=1, le=365)
    enabled: bool = True


class CleanupResultItem(BaseModel):
    date: str
    deleted: int
    protected: int
    active: int
