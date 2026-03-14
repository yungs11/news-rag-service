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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            )
        """)
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


async def create_session(title: str, user_id: str | None, category: str | None) -> dict:
    session_id = str(uuid.uuid4())
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chat_sessions (id, user_id, title, category, created_at, updated_at, message_count) VALUES (?,?,?,?,?,?,0)",
            (session_id, user_id, title[:80], category, now, now),
        )
        await db.commit()
    return {"id": session_id, "user_id": user_id, "title": title[:80], "category": category,
            "created_at": now, "updated_at": now, "message_count": 0}


async def get_session_with_messages(session_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,))
        row = await cur.fetchone()
        if not row:
            return None
        session = dict(row)

        cur = await db.execute(
            "SELECT role, content, sources FROM chat_messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        )
        msgs = await cur.fetchall()
        session["messages"] = [
            {"role": r["role"], "content": r["content"],
             "sources": json.loads(r["sources"]) if r["sources"] else []}
            for r in msgs
        ]
        return session


async def append_messages(session_id: str, messages: list[dict]) -> None:
    """Add one or more messages and update session metadata."""
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        for msg in messages:
            sources = json.dumps(msg.get("sources") or [])
            await db.execute(
                "INSERT INTO chat_messages (session_id, role, content, sources, created_at) VALUES (?,?,?,?,?)",
                (session_id, msg["role"], msg["content"], sources, now),
            )
        await db.execute(
            "UPDATE chat_sessions SET updated_at = ?, message_count = message_count + ? WHERE id = ?",
            (now, len(messages), session_id),
        )
        await db.commit()


async def delete_session(session_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        await db.commit()
        return cur.rowcount > 0
