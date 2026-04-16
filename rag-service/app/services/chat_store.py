import json
import logging
import uuid
from datetime import datetime, timezone

import aiosqlite

logger = logging.getLogger(__name__)

DB_PATH = "chat_history.db"


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                title TEXT NOT NULL,
                category TEXT,
                doc_id TEXT,
                doc_title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            )
        """)
        # 기존 DB 마이그레이션 (컬럼 없으면 추가)
        try:
            await db.execute("ALTER TABLE chat_sessions ADD COLUMN doc_id TEXT")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE chat_sessions ADD COLUMN doc_title TEXT")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE chat_messages ADD COLUMN source_docs TEXT")
        except Exception:
            pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_session_user ON chat_sessions(user_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_msg_session ON chat_messages(session_id)")
        await db.commit()
    logger.info("Chat DB initialized: %s", DB_PATH)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def list_sessions(user_id: str | None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if user_id:
            cur = await db.execute(
                "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100",
                (user_id,),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 100"
            )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def create_session(title: str, user_id: str | None, category: str | None,
                        doc_id: str | None = None, doc_title: str | None = None) -> dict:
    session_id = str(uuid.uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chat_sessions (id, user_id, title, category, doc_id, doc_title, created_at, updated_at, message_count) VALUES (?,?,?,?,?,?,?,?,0)",
            (session_id, user_id, title[:80], category, doc_id, doc_title, now, now),
        )
        await db.commit()
    return {"id": session_id, "user_id": user_id, "title": title[:80], "category": category,
            "doc_id": doc_id, "doc_title": doc_title, "created_at": now, "updated_at": now, "message_count": 0}


async def get_session_with_messages(session_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,))
        row = await cur.fetchone()
        if not row:
            return None
        session = dict(row)

        cur = await db.execute(
            "SELECT role, content, sources, source_docs FROM chat_messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        )
        msgs = await cur.fetchall()
        session["messages"] = [
            {"role": r["role"], "content": r["content"],
             "sources": json.loads(r["sources"]) if r["sources"] else [],
             "source_docs": json.loads(r["source_docs"]) if r["source_docs"] else []}
            for r in msgs
        ]
        return session


async def append_messages(session_id: str, messages: list[dict]) -> None:
    """Add one or more messages and update session metadata."""
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        for msg in messages:
            sources = json.dumps(msg.get("sources") or [])
            source_docs = json.dumps(msg.get("source_docs") or [])
            await db.execute(
                "INSERT INTO chat_messages (session_id, role, content, sources, source_docs, created_at) VALUES (?,?,?,?,?,?)",
                (session_id, msg["role"], msg["content"], sources, source_docs, now),
            )
        await db.execute(
            "UPDATE chat_sessions SET updated_at = ?, message_count = message_count + ? WHERE id = ?",
            (now, len(messages), session_id),
        )
        await db.commit()


async def list_sessions_by_doc(doc_id: str) -> list[dict]:
    """특정 문서와 연결된 대화 세션 목록을 반환한다."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, title, message_count, updated_at FROM chat_sessions WHERE doc_id = ? ORDER BY updated_at DESC LIMIT 20",
            (doc_id,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def get_doc_ids_with_sessions() -> set[str]:
    """대화 세션이 연결된 문서 ID 집합을 반환한다."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT DISTINCT doc_id FROM chat_sessions WHERE doc_id IS NOT NULL AND doc_id != ''"
        )
        rows = await cur.fetchall()
        return {row[0] for row in rows}


async def delete_session(session_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        await db.commit()
        return cur.rowcount > 0


async def delete_all_sessions(user_id: str | None) -> int:
    """사용자의 모든 대화 세션을 삭제한다. 삭제 건수 반환."""
    async with aiosqlite.connect(DB_PATH) as db:
        if user_id:
            cur = await db.execute("DELETE FROM chat_sessions WHERE user_id = ?", (user_id,))
        else:
            cur = await db.execute("DELETE FROM chat_sessions")
        await db.commit()
        return cur.rowcount
