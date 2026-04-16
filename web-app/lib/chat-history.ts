import { getUserId, isAdmin } from "./auth";

const BASE = "/api/rag/chat";

export interface ChatSession {
  id: string;
  user_id: string | null;
  title: string;
  category: string | null;
  doc_id: string | null;
  doc_title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SourceDoc {
  document_id: string;
  title: string;
  source_url: string;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  source_docs?: SourceDoc[];
}

function _userIdParam(): string | null {
  if (isAdmin()) return null;
  return getUserId();
}

export async function getSessions(): Promise<ChatSession[]> {
  const uid = _userIdParam();
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  const res = await fetch(`${BASE}/sessions${qs}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

export async function createSession(
  title: string, category?: string, docId?: string, docTitle?: string
): Promise<ChatSession> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title, user_id: _userIdParam(), category: category ?? null,
      doc_id: docId ?? null, doc_title: docTitle ?? null,
    }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function getSessionWithMessages(
  sessionId: string
): Promise<(ChatSession & { messages: StoredMessage[] }) | null> {
  const res = await fetch(`${BASE}/sessions/${sessionId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function appendMessages(sessionId: string, messages: StoredMessage[]): Promise<void> {
  await fetch(`${BASE}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

export async function getSessionsByDoc(docId: string): Promise<{ id: string; title: string; message_count: number; updated_at: string }[]> {
  const res = await fetch(`${BASE}/sessions/by-doc/${docId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" });
}

export async function deleteAllSessions(): Promise<number> {
  const uid = _userIdParam();
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  const res = await fetch(`${BASE}/sessions${qs}`, { method: "DELETE" });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.deleted ?? 0;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
