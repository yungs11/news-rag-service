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
    chunk_text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    count: int
    items: list[SearchItem]


class AskRequest(BaseModel):
    query: str
    limit: int = Field(default=6, ge=1, le=20)
    category: Category | None = None
    user_id: str | None = None


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
    raw_chars: int | None = None
    embed_truncated: bool | None = None
