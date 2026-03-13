import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
    yield
    await store.close()
    logger.info("Neo4j connection closed")


app = FastAPI(title="News RAG Service", lifespan=lifespan)

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
    )
    logger.info("Ingest: document_id=%s created=%s url=%s", document_id, created, req.source_url)
    return IngestResponse(document_id=document_id, created=created)


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    hits = await rag.search(req.query, req.limit, req.category)
    items = [_to_search_item(h) for h in hits]
    return SearchResponse(query=req.query, count=len(items), items=items)


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    result = await rag.ask(req.query, req.limit, req.category)
    hits = [_to_search_item(h) for h in result["hits"]]
    return AskResponse(
        query=req.query,
        answer=result["answer"],
        sources=result["sources"],
        hits=hits,
    )


@app.get("/documents/recent", response_model=RecentDocumentsResponse)
async def recent_documents(limit: int = 10):
    rows = await store.recent_documents(limit=min(limit, 50))
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
async def list_categories():
    rows = await store.list_categories()
    items = [CategoryItem(category=str(r["category"]), document_count=int(r["document_count"])) for r in rows]
    return CategoriesResponse(items=items)


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
