import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import Settings
from app.schemas import (
    AskRequest,
    AskResponse,
    CollectionResultItem,
    CollectionRunResponse,
    CollectorStatusResponse,
    FeedSourceCreate,
    FeedSourceDetail,
    FeedSourceListResponse,
    FeedSourceUpdate,
    HistoryMessage,
    CategoriesResponse,
    CategoryItem,
    DocumentDetail,
    IngestRequest,
    IngestResponse,
    RecentDocumentsResponse,
    SearchItem,
    SearchRequest,
    SearchResponse,
    SummarizeRequest,
    SummarizeResponse,
)
from app.services.content_extractor import (
    ExtractedContent,
    extract_content,
    extract_from_docx,
    extract_from_excel,
    extract_from_pdf,
    is_valid_content,
)
from app.services.summarizer import classify_category, is_failed_summary, summarize_content
from app.services.news_collector import (
    collect_source,
    run_all_sources,
    seed_default_sources,
)
from app import scheduler as sched
from app.services.chat_store import (
    append_messages,
    create_session,
    delete_all_sessions,
    delete_session,
    get_session_with_messages,
    init_db,
    list_sessions,
    list_sessions_by_doc,
)
from app.services.embedder import Embedder
from app.services.neo4j_store import Neo4jStore
from app.services.rag_service import RagService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings.from_env()
store = Neo4jStore(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password, settings.embedding_dim)
embedder = Embedder(settings.embedding_model)
rag = RagService(settings, store, embedder)


async def _scheduled_collection():
    """Cron job: collect from all enabled sources."""
    logger.info("Scheduled collection triggered")
    results = await run_all_sources(settings, store, rag)
    sched.set_last_status(results)


async def _scheduled_cleanup():
    """Cron job: delete expired unused documents."""
    from app.services.chat_store import get_doc_ids_with_sessions
    logger.info("Scheduled cleanup triggered")
    ret = await store.get_retention_settings()
    if not ret or not ret.get("enabled"):
        logger.info("Cleanup skipped: disabled")
        return
    days = ret["days"]
    protected = await store.get_protected_source_names()
    active_ids = await get_doc_ids_with_sessions()
    expired_ids = await store.find_expired_documents(days, protected, active_ids)
    deleted = await store.bulk_delete_documents(expired_ids)
    sched.add_cleanup_result(deleted=deleted, protected=len(protected), active=len(active_ids))
    logger.info("Cleanup done: deleted=%d protected_sources=%d active_docs=%d", deleted, len(protected), len(active_ids))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to Neo4j...")
    await store.verify_connectivity()
    await store.ensure_indexes()
    logger.info("Neo4j ready")
    await init_db()

    # Seed default feed sources if empty
    await seed_default_sources(store)

    # Initialize retention config if not exists
    ret = await store.get_retention_settings()
    if not ret:
        await store.upsert_retention_settings(settings.retention_days, settings.cleanup_enabled)

    # Start scheduler
    if settings.collector_enabled:
        sched.setup_scheduler(settings.collector_cron_hours, _scheduled_collection)
    sched.setup_cleanup_job(_scheduled_cleanup, start_date="2026-04-23T03:00:00")
    sched.start()

    yield

    sched.shutdown()
    await store.close()
    logger.info("Neo4j connection closed")


app = FastAPI(title="News RAG Service", lifespan=lifespan)

# OTP store: {otp: (kakao_user_id, expires_at)}
_otp_store: dict[str, tuple[str, float]] = {}
OTP_TTL = 300  # 5분


class OtpIssueRequest(BaseModel):
    user_id: str


class OtpVerifyRequest(BaseModel):
    otp: str


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 웹앱 배포 후 도메인으로 제한
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ingest_type(row: dict) -> str:
    uid = str(row.get("user_id", "") or "")
    return "auto" if uid == settings.collector_user_id else "manual"


def _to_search_item(hit: dict) -> SearchItem:
    return SearchItem(
        document_id=str(hit.get("document_id", "")),
        source_url=str(hit.get("source_url", "")),
        title=str(hit.get("title", "")),
        category=str(hit.get("category", "")),
        source_type=str(hit.get("source_type", "")),
        summary_date=str(hit["summary_date"]) if hit.get("summary_date") else None,
        summary_text=str(hit.get("summary_text", "")),
        chunk_text=str(hit.get("chunk_text", "")),
        score=float(hit.get("score", 0.0)),
    )


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/auth/issue-otp")
async def auth_issue_otp(req: OtpIssueRequest):
    # 만료된 OTP 정리
    now = time.time()
    expired = [k for k, (_, exp) in _otp_store.items() if now > exp]
    for k in expired:
        del _otp_store[k]

    otp = f"{secrets.randbelow(1000000):06d}"
    _otp_store[otp] = (req.user_id, now + OTP_TTL)
    logger.info("OTP issued for user_id=%s", req.user_id)
    return {"otp": otp}


@app.post("/auth/verify-otp")
async def auth_verify_otp(req: OtpVerifyRequest):
    entry = _otp_store.get(req.otp.strip())
    if not entry:
        return {"valid": False, "user_id": None}
    user_id, expires_at = entry
    del _otp_store[req.otp.strip()]  # 1회 사용
    if time.time() > expires_at:
        return {"valid": False, "user_id": None}
    logger.info("OTP verified for user_id=%s", user_id)
    return {"valid": True, "user_id": user_id}


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest):
    summary_date_str = req.summary_date.isoformat() if req.summary_date else None
    document_id, created = await rag.ingest(
        source_url=req.source_url,
        source_type=req.source_type,
        title=req.title,
        category=req.category,
        summary_text=req.summary_text,
        raw_text=req.raw_text,
        summary_date=summary_date_str,
        user_id=req.user_id,
    )
    logger.info("Ingest: document_id=%s created=%s url=%s user_id=%s", document_id, created, req.source_url, req.user_id)
    return IngestResponse(document_id=document_id, created=created)


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    hits = await rag.search(req.query, req.limit, req.category, user_id=req.user_id)
    items = [_to_search_item(h) for h in hits]
    return SearchResponse(query=req.query, count=len(items), items=items)


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    history = [{"role": h.role, "content": h.content} for h in req.history] if req.history else None
    result = await rag.ask(req.query, req.limit, req.category, user_id=req.user_id,
                           document_id=req.document_id, history=history)
    hits = [_to_search_item(h) for h in result["hits"]]
    return AskResponse(
        query=req.query,
        answer=result["answer"],
        sources=result["sources"],
        hits=hits,
    )


@app.post("/ask/upload", response_model=AskResponse)
async def ask_with_file(
    query: str = Form(...),
    file: UploadFile = File(...),
    limit: int = Form(6),
    category: str | None = Form(None),
    user_id: str | None = Form(None),
    document_id: str | None = Form(None),
    history: str | None = Form(None),
):
    """파일 첨부 질문: 파일 내용을 추출하여 RAG 컨텍스트에 포함합니다."""
    import json as _json

    filename = file.filename or "unnamed"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("pdf", "docx", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail="PDF, Word(.docx), Excel(.xlsx) 파일만 지원합니다.")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    try:
        if ext == "pdf":
            extracted = await asyncio.to_thread(extract_from_pdf, file_bytes, filename)
        elif ext in ("xlsx", "xls"):
            extracted = await asyncio.to_thread(extract_from_excel, file_bytes, filename)
        else:
            extracted = await asyncio.to_thread(extract_from_docx, file_bytes, filename)
    except Exception as exc:
        logger.warning("File extraction failed: filename=%s reason=%s", filename, exc)
        raise HTTPException(status_code=400, detail=f"파일에서 텍스트를 추출할 수 없습니다: {exc}")

    attached_context = extracted.content
    logger.info("Ask with file: filename=%s chars=%d query=%r", filename, len(attached_context), query[:100])

    parsed_history = None
    if history:
        try:
            parsed_history = [{"role": h["role"], "content": h["content"]} for h in _json.loads(history)]
        except Exception:
            pass

    result = await rag.ask(
        query, limit, category if category else None, user_id=user_id,
        document_id=document_id, history=parsed_history,
        attached_context=attached_context,
    )
    hits = [_to_search_item(h) for h in result["hits"]]
    return AskResponse(
        query=query,
        answer=result["answer"],
        sources=result["sources"],
        hits=hits,
    )


@app.get("/documents/recent", response_model=RecentDocumentsResponse)
async def recent_documents(limit: int = 10, user_id: str | None = None):
    rows = await store.recent_documents(limit=min(limit, 50), user_id=user_id)
    items = [
        DocumentDetail(
            id=str(r.get("id", "")),
            source_url=str(r.get("source_url", "")),
            source_type=str(r.get("source_type", "")),
            title=str(r.get("title", "")),
            category=str(r.get("category", "")),
            summary_text=str(r.get("summary_text", "")),
            summary_date=str(r["summary_date"]) if r.get("summary_date") else None,
            ingest_type=_ingest_type(r),
            collected_from=str(r["collected_from"]) if r.get("collected_from") else None,
            created_at=str(r.get("created_at", "")),
        )
        for r in rows
    ]
    return RecentDocumentsResponse(count=len(items), items=items)


@app.get("/documents/categories", response_model=CategoriesResponse)
async def list_categories(user_id: str | None = None):
    rows = await store.list_categories(user_id=user_id)
    items = [CategoryItem(category=str(r["category"]), document_count=int(r["document_count"])) for r in rows]
    return CategoriesResponse(items=items)


# ── Read Status ───────────────────────────────────────────────────────────────


class MarkReadRequest(BaseModel):
    document_id: str
    user_id: str


@app.post("/documents/read")
async def mark_read(req: MarkReadRequest):
    await store.mark_document_read(req.document_id, req.user_id)
    return {"ok": True}


@app.get("/documents/read-ids")
async def get_read_ids(user_id: str | None = None):
    if not user_id:
        return {"ids": []}
    ids = await store.get_read_doc_ids(user_id)
    return {"ids": ids}


# ── Bookmark ──────────────────────────────────────────────────────────────────


class BookmarkRequest(BaseModel):
    document_id: str
    user_id: str


@app.post("/documents/bookmark")
async def toggle_bookmark(req: BookmarkRequest):
    bookmarked = await store.toggle_bookmark(req.user_id, req.document_id)
    return {"ok": True, "bookmarked": bookmarked}


@app.get("/documents/bookmark-ids")
async def get_bookmark_ids(user_id: str | None = None):
    if not user_id:
        return {"ids": []}
    ids = await store.get_bookmarked_doc_ids(user_id)
    return {"ids": ids}


@app.get("/documents/bookmarks")
async def get_bookmarks(user_id: str | None = None):
    if not user_id:
        return {"items": []}
    rows = await store.get_bookmarked_documents(user_id)
    items = [
        DocumentDetail(
            id=str(r.get("id", "")),
            source_url=str(r.get("source_url", "")),
            source_type=str(r.get("source_type", "")),
            title=str(r.get("title", "")),
            category=str(r.get("category", "")),
            summary_text=str(r.get("summary_text", "")),
            summary_date=str(r["summary_date"]) if r.get("summary_date") else None,
            ingest_type=_ingest_type(r),
            collected_from=str(r["collected_from"]) if r.get("collected_from") else None,
            created_at=str(r.get("created_at", "")),
        )
        for r in rows
    ]
    return {"items": items}


# ── Memo ──────────────────────────────────────────────────────────────────────


class MemoUpsertRequest(BaseModel):
    document_id: str
    user_id: str
    text: str


class MemoDeleteRequest(BaseModel):
    document_id: str
    user_id: str


@app.post("/documents/memo")
async def upsert_memo(req: MemoUpsertRequest):
    await store.upsert_memo(req.user_id, req.document_id, req.text)
    return {"ok": True}


@app.delete("/documents/memo")
async def delete_memo(document_id: str, user_id: str):
    deleted = await store.delete_memo(user_id, document_id)
    return {"ok": True, "deleted": deleted}


@app.get("/documents/memos")
async def get_memos(user_id: str | None = None):
    if not user_id:
        return {"items": []}
    items = await store.get_memos(user_id)
    return {"items": items}


@app.get("/documents/memo")
async def get_memo(document_id: str, user_id: str | None = None):
    if not user_id:
        return {"text": None}
    text = await store.get_memo(user_id, document_id)
    return {"text": text}


# ── Chat History ──────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    title: str
    user_id: str | None = None
    category: str | None = None
    doc_id: str | None = None
    doc_title: str | None = None


class AppendMessagesRequest(BaseModel):
    messages: list[dict]


@app.get("/chat/sessions")
async def chat_list_sessions(user_id: str | None = None):
    sessions = await list_sessions(user_id)
    return {"sessions": sessions}


@app.post("/chat/sessions", status_code=201)
async def chat_create_session(req: CreateSessionRequest):
    session = await create_session(req.title, req.user_id, req.category, req.doc_id, req.doc_title)
    return session


@app.get("/chat/sessions/{session_id}")
async def chat_get_session(session_id: str):
    session = await get_session_with_messages(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.post("/chat/sessions/{session_id}/messages", status_code=201)
async def chat_append_messages(session_id: str, req: AppendMessagesRequest):
    session = await get_session_with_messages(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await append_messages(session_id, req.messages)
    return {"ok": True}


@app.get("/chat/sessions/by-doc/{doc_id}")
async def chat_sessions_by_doc(doc_id: str):
    sessions = await list_sessions_by_doc(doc_id)
    return {"sessions": sessions}


@app.delete("/chat/sessions/{session_id}")
async def chat_delete_session(session_id: str):
    deleted = await delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@app.delete("/chat/sessions")
async def chat_delete_all_sessions(user_id: str | None = None):
    count = await delete_all_sessions(user_id)
    logger.info("All chat sessions deleted: user_id=%s count=%d", user_id, count)
    return {"ok": True, "deleted": count}


# ─────────────────────────────────────────────────────────────────────────────

@app.get("/graph")
async def graph_data(threshold: float = 0.75):
    """그래프 시각화용 전체 문서 데이터 + 청크 유사도 기반 문서 간 연결."""
    rows, sim_pairs = await asyncio.gather(
        store.graph_data(),
        store.similar_document_pairs(score_threshold=threshold),
    )

    category_nodes: dict[str, dict] = {}
    doc_nodes: list[dict] = []
    links: list[dict] = []

    doc_id_set: set[str] = set()
    for row in rows:
        cat = str(row.get("category") or "Other")
        if cat not in category_nodes:
            category_nodes[cat] = {"id": f"cat:{cat}", "label": cat, "type": "category"}
        doc_id = f"doc:{row['id']}"
        doc_id_set.add(doc_id)
        doc_nodes.append({
            "id": doc_id,
            "label": (str(row.get("title") or "Untitled"))[:50],
            "type": "document",
            "category": cat,
            "source_url": str(row.get("source_url") or ""),
            "source_type": str(row.get("source_type") or ""),
            "summary_text": (str(row.get("summary_text") or ""))[:300],
            "user_id": str(row.get("user_id") or ""),
            "created_at": str(row.get("created_at") or ""),
        })
        links.append({"source": doc_id, "target": f"cat:{cat}", "link_type": "category"})

    # 유사도 링크 (두 문서 노드가 모두 결과에 포함된 경우만)
    for pair in sim_pairs:
        src = f"doc:{pair['source_id']}"
        tgt = f"doc:{pair['target_id']}"
        if src in doc_id_set and tgt in doc_id_set:
            links.append({
                "source": src,
                "target": tgt,
                "link_type": "similarity",
                "score": round(float(pair["max_score"]), 3),
            })

    return {"nodes": list(category_nodes.values()) + doc_nodes, "links": links}


async def _run_summarize_pipeline(content: ExtractedContent, user_id: str | None) -> SummarizeResponse:
    """추출된 콘텐츠를 요약·분류·저장하는 공통 파이프라인."""
    from datetime import date as _date

    t_start = time.perf_counter()
    logger.info("Pipeline start: source=%s source_type=%s chars=%d", content.url, content.source_type, len(content.content))

    if not is_valid_content(content.content):
        logger.warning("Pipeline abort: invalid/junk content source=%s chars=%d", content.url, len(content.content))
        return SummarizeResponse(
            status="failed",
            message=(
                f"[요약 불가] {content.url}\n\n콘텐츠를 충분히 추출할 수 없습니다.\n"
                "(내용이 너무 짧거나, 저작권/푸터 텍스트만 존재하는 경우)"
            ),
            title=content.title,
            source_type=content.source_type,
        )

    # 카테고리를 먼저 분류해서 요약 프롬프트에 전달 (AI/LLM 여부에 따라 섹션 조건 분기)
    t1 = time.perf_counter()
    category = await classify_category(
        content.title,
        content.content[:800],
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        model=settings.openrouter_summary_model,
    )
    logger.info("Pipeline step classify: category=%s elapsed=%.2fs", category, time.perf_counter() - t1)

    t2 = time.perf_counter()
    summary = await summarize_content(
        content,
        category=category,
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        model=settings.openrouter_summary_model,
        system_prompt=settings.summary_system_prompt,
        user_prompt_template=settings.summary_user_prompt_template,
    )
    logger.info("Pipeline step summarize: chars=%d elapsed=%.2fs", len(summary), time.perf_counter() - t2)

    if is_failed_summary(summary):
        logger.warning("Pipeline abort: failed summary source=%s", content.url)
        return SummarizeResponse(
            status="failed",
            message=(
                f"[요약 불가] {content.url}\n\n내용을 요약할 수 없습니다.\n"
                "(내용이 부족하거나 요약 불가 판정)"
            ),
            title=content.title,
            source_type=content.source_type,
        )

    t3 = time.perf_counter()
    document_id, created = await rag.ingest(
        source_url=content.url,
        source_type=content.source_type,
        title=content.title,
        category=category,
        summary_text=summary,
        raw_text=content.content,
        summary_date=_date.today().isoformat(),
        user_id=user_id,
    )
    logger.info("Pipeline step ingest: document_id=%s created=%s elapsed=%.2fs", document_id, created, time.perf_counter() - t3)

    logger.info("Pipeline done: source=%s total=%.2fs", content.url, time.perf_counter() - t_start)
    return SummarizeResponse(
        status="ok",
        message=f"[요약 완료] {content.url}",
        summary=summary,
        title=content.title,
        category=category,
        source_type=content.source_type,
        document_id=document_id,
        created=created,
    )


@app.post("/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest):
    """URL에서 콘텐츠를 추출하고 요약한 뒤 지식베이스에 저장합니다."""
    started = time.perf_counter()
    try:
        content = await asyncio.to_thread(extract_content, req.url, settings.http_timeout_seconds)
    except Exception as exc:
        logger.warning("Content extraction failed: url=%s reason=%s", req.url, exc)
        return SummarizeResponse(
            status="failed",
            message=f"[요약 불가] {req.url}\n\n콘텐츠를 가져올 수 없습니다: {exc}",
        )

    try:
        result = await _run_summarize_pipeline(content, req.user_id)
    except Exception as exc:
        logger.exception("Pipeline failed: url=%s reason=%s", req.url, exc)
        return SummarizeResponse(
            status="failed",
            message=f"[처리 오류] {req.url}\n\n요약 처리 중 오류가 발생했습니다: {exc}",
        )
    logger.info("Summarize(url) done: url=%s status=%s elapsed=%.2fs", req.url, result.status, time.perf_counter() - started)
    return result


@app.post("/summarize/upload", response_model=SummarizeResponse)
async def summarize_upload(
    file: UploadFile = File(...),
    user_id: str | None = Form(None),
    title: str | None = Form(None),
):
    """PDF 또는 Word 파일을 업로드하여 요약하고 지식베이스에 저장합니다."""
    started = time.perf_counter()
    filename = file.filename or "unnamed"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("pdf", "docx"):
        raise HTTPException(status_code=400, detail="PDF(.pdf) 또는 Word(.docx) 파일만 지원합니다.")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    try:
        if ext == "pdf":
            content = await asyncio.to_thread(extract_from_pdf, file_bytes, filename)
        else:
            content = await asyncio.to_thread(extract_from_docx, file_bytes, filename)
    except Exception as exc:
        logger.warning("File extraction failed: filename=%s reason=%s", filename, exc)
        return SummarizeResponse(
            status="failed",
            message=f"[요약 불가] {filename}\n\n파일에서 텍스트를 추출할 수 없습니다: {exc}",
        )

    # 타이틀 오버라이드 허용
    if title:
        content.title = title

    try:
        result = await _run_summarize_pipeline(content, user_id)
    except Exception as exc:
        logger.exception("Pipeline failed: filename=%s reason=%s", filename, exc)
        return SummarizeResponse(
            status="failed",
            message=f"[처리 오류] {filename}\n\n요약 처리 중 오류가 발생했습니다: {exc}",
        )
    logger.info("Summarize(upload) done: filename=%s status=%s elapsed=%.2fs", filename, result.status, time.perf_counter() - started)
    return result


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    deleted = await rag.delete_document(document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info("Document deleted: id=%s", document_id)
    return {"ok": True, "id": document_id}


@app.get("/documents/{document_id}", response_model=DocumentDetail)
async def get_document(document_id: str):
    doc = await store.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentDetail(
        id=str(doc.get("id", "")),
        source_url=str(doc.get("source_url", "")),
        source_type=str(doc.get("source_type", "")),
        title=str(doc.get("title", "")),
        category=str(doc.get("category", "")),
        summary_text=str(doc.get("summary_text", "")),
        raw_text=doc.get("raw_text") or None,
        summary_date=str(doc["summary_date"]) if doc.get("summary_date") else None,
        ingest_type=_ingest_type(doc),
        collected_from=str(doc["collected_from"]) if doc.get("collected_from") else None,
        created_at=str(doc.get("created_at", "")),
    )


# ── Collector API ─────────────────────────────────────────────────────────────

def _to_feed_source_detail(row: dict) -> FeedSourceDetail:
    return FeedSourceDetail(
        id=str(row.get("id", "")),
        name=str(row.get("name", "")),
        feed_url=str(row.get("feed_url", "")),
        feed_type=str(row.get("feed_type", "rss")),
        filter_mode=str(row.get("filter_mode", "all")),
        enabled=bool(row.get("enabled", True)),
        max_items=int(row.get("max_items", 10)),
        keywords=str(row["keywords"]) if row.get("keywords") else None,
        last_collected_at=str(row["last_collected_at"]) if row.get("last_collected_at") else None,
        last_collected_count=int(row["last_collected_count"]) if row.get("last_collected_count") is not None else None,
        created_at=str(row.get("created_at", "")),
    )


@app.get("/collector/sources", response_model=FeedSourceListResponse)
async def collector_list_sources():
    rows = await store.list_feed_sources()
    return FeedSourceListResponse(sources=[_to_feed_source_detail(r) for r in rows])


@app.post("/collector/sources", status_code=201)
async def collector_add_source(req: FeedSourceCreate):
    source_id = await store.create_feed_source(
        name=req.name,
        feed_url=req.feed_url,
        feed_type=req.feed_type,
        filter_mode=req.filter_mode,
        enabled=req.enabled,
        max_items=req.max_items,
        keywords=req.keywords,
    )
    logger.info("FeedSource created: id=%s name=%s", source_id, req.name)
    return {"id": source_id}


@app.put("/collector/sources/{source_id}")
async def collector_update_source(source_id: str, req: FeedSourceUpdate):
    updates = req.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await store.update_feed_source(source_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Source not found")
    logger.info("FeedSource updated: id=%s fields=%s", source_id, list(updates.keys()))
    return {"ok": True}


@app.delete("/collector/sources/{source_id}")
async def collector_delete_source(source_id: str):
    deleted = await store.delete_feed_source(source_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Source not found")
    logger.info("FeedSource deleted: id=%s", source_id)
    return {"ok": True}


@app.post("/collector/sources/{source_id}/run", response_model=CollectionRunResponse)
async def collector_run_source(source_id: str):
    source = await store.get_feed_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    result = await collect_source(source, settings, rag)
    await store.update_source_collection_status(source_id, result.collected)
    sched.set_last_status([result])
    return CollectionRunResponse(
        status="ok",
        results=[CollectionResultItem(**result.to_dict())],
    )


@app.post("/collector/run", response_model=CollectionRunResponse)
async def collector_run_all():
    results = await run_all_sources(settings, store, rag)
    sched.set_last_status(results)
    return CollectionRunResponse(
        status="ok",
        results=[CollectionResultItem(**r.to_dict()) for r in results],
    )


@app.get("/collector/status", response_model=CollectorStatusResponse)
async def collector_status():
    last_run, results = sched.get_last_status()
    return CollectorStatusResponse(
        last_run=last_run,
        results=[CollectionResultItem(**r.to_dict()) for r in results],
    )


class TestFeedRequest(BaseModel):
    feed_type: str
    feed_url: str = ""
    keywords: str | None = None
    max_items: int = 5


@app.post("/collector/test-feed")
async def collector_test_feed(req: TestFeedRequest):
    """피드에서 항목만 가져와서 제목 목록 반환 (요약 안 함). 테스트용."""
    from app.services.news_collector import fetch_feed_entries
    try:
        entries = await fetch_feed_entries(
            req.feed_url, req.feed_type, req.max_items, keywords=req.keywords,
        )
        return {
            "ok": True,
            "count": len(entries),
            "entries": [{"title": e.title, "url": e.url} for e in entries],
        }
    except Exception as exc:
        return {"ok": False, "count": 0, "entries": [], "error": f"{exc.__class__.__name__}: {exc}"}


# ── Retention / Cleanup ──────────────────────────────────────────────────────

@app.get("/retention/settings")
async def get_retention_settings():
    ret = await store.get_retention_settings()
    if not ret:
        return {"days": settings.retention_days, "enabled": settings.cleanup_enabled}
    return ret


@app.put("/retention/settings")
async def update_retention_settings(body: dict):
    days = body.get("days", 7)
    enabled = body.get("enabled", True)
    await store.upsert_retention_settings(days, enabled)
    logger.info("Retention settings updated: days=%d enabled=%s", days, enabled)
    return {"ok": True, "days": days, "enabled": enabled}


@app.get("/retention/history")
async def get_cleanup_history():
    return {"history": sched.get_cleanup_history()}


@app.post("/retention/run")
async def run_cleanup():
    await _scheduled_cleanup()
    history = sched.get_cleanup_history()
    latest = history[-1] if history else {"deleted": 0, "protected": 0, "active": 0}
    return {"ok": True, **latest}
