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
    extract_from_pdf,
    is_valid_content,
)
from app.services.summarizer import classify_category, is_failed_summary, summarize_content
from app.services.chat_store import (
    append_messages,
    create_session,
    delete_session,
    get_session_with_messages,
    init_db,
    list_sessions,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to Neo4j...")
    await store.verify_connectivity()
    await store.ensure_indexes()
    logger.info("Neo4j ready")
    await init_db()
    yield
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


def _to_search_item(hit: dict) -> SearchItem:
    return SearchItem(
        document_id=str(hit.get("document_id", "")),
        source_url=str(hit.get("source_url", "")),
        title=str(hit.get("title", "")),
        category=str(hit.get("category", "")),
        source_type=str(hit.get("source_type", "")),
        summary_date=str(hit["summary_date"]) if hit.get("summary_date") else None,
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
    result = await rag.ask(req.query, req.limit, req.category, user_id=req.user_id)
    hits = [_to_search_item(h) for h in result["hits"]]
    return AskResponse(
        query=req.query,
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


# ── Chat History ──────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    title: str
    user_id: str | None = None
    category: str | None = None


class AppendMessagesRequest(BaseModel):
    messages: list[dict]


@app.get("/chat/sessions")
async def chat_list_sessions(user_id: str | None = None):
    sessions = await list_sessions(user_id)
    return {"sessions": sessions}


@app.post("/chat/sessions", status_code=201)
async def chat_create_session(req: CreateSessionRequest):
    session = await create_session(req.title, req.user_id, req.category)
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


@app.delete("/chat/sessions/{session_id}")
async def chat_delete_session(session_id: str):
    deleted = await delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


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

    result = await _run_summarize_pipeline(content, req.user_id)
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

    result = await _run_summarize_pipeline(content, user_id)
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
        created_at=str(doc.get("created_at", "")),
    )
