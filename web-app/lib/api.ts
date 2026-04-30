import { getUserId, isAdmin } from "./auth";

const BASE = "/api/rag";

export type SourceType = "youtube" | "news" | "blog" | "other";
export type Category = "AI/LLM" | "Infra" | "DB" | "Product" | "Business" | "Financial" | "Other";

export interface SearchItem {
  document_id: string;
  source_url: string;
  title: string;
  category: string;
  source_type: string;
  summary_date: string | null;
  summary_text: string;
  chunk_text: string;
  score: number;
}

export type IngestType = "auto" | "manual";

export interface DocumentDetail {
  id: string;
  source_url: string;
  source_type: string;
  title: string;
  category: string;
  summary_text: string;
  raw_text?: string | null;
  summary_date: string | null;
  ingest_type: IngestType;
  collected_from: string | null;
  created_at: string;
}

export interface CategoryItem {
  category: string;
  document_count: number;
}

export const MANUAL_SOURCE_SENTINEL = "__manual__";

export interface SourceItem {
  source: string; // "__manual__" sentinel 포함
  document_count: number;
}

export type FilterMode = "all" | "ai_only";
export type FeedType = "rss" | "reddit_rss" | "arxiv" | "youtube_channel" | "arca_live" | "sitemap";

export interface FeedSource {
  id: string;
  name: string;
  feed_url: string;
  feed_type: FeedType;
  filter_mode: FilterMode;
  enabled: boolean;
  max_items: number;
  keywords: string | null;
  retain: boolean;
  last_collected_at: string | null;
  last_collected_count: number | null;
  created_at: string;
}

export interface CollectionResultItem {
  source_name: string;
  source_id: string;
  total_entries: number;
  filtered: number;
  collected: number;
  skipped_duplicate: number;
  failed: number;
  errors: string[];
}

function _userIdParam(): string | null {
  if (isAdmin()) return null; // admin: no filter
  return getUserId();
}

export interface AskStreamSourceDoc {
  document_id: string;
  title: string;
  source_url: string;
}

export interface AskStreamCallbacks {
  onHits: (data: { sources: string[]; source_docs: AskStreamSourceDoc[]; hits: SearchItem[] }) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

function _parseSSEBlock(raw: string): { event?: string; data?: string } {
  let event: string | undefined;
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  return { event, data: data || undefined };
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = `${res.status}: ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}`;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = `${res.status}: ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}`;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function put<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = `${res.status}: ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}`;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = `${res.status}: ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}`;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  search: (query: string, limit = 10, category?: Category, source?: string) =>
    post<{ query: string; count: number; items: SearchItem[] }>("/search", {
      query,
      limit,
      category,
      source,
      user_id: _userIdParam(),
    }),

  ask: (query: string, limit = 6, category?: Category, documentId?: string,
        history?: { role: string; content: string }[]) =>
    post<{ query: string; answer: string; sources: string[]; hits: SearchItem[] }>("/ask", {
      query,
      limit,
      category,
      user_id: _userIdParam(),
      document_id: documentId,
      history,
    }),

  askWithFile: async (
    query: string,
    file: File,
    limit = 6,
    category?: Category,
    documentId?: string,
    history?: { role: string; content: string }[],
  ) => {
    const uid = _userIdParam();
    const form = new FormData();
    form.append("file", file);
    form.append("query", query);
    form.append("limit", String(limit));
    if (category) form.append("category", category);
    if (uid) form.append("user_id", uid);
    if (documentId) form.append("document_id", documentId);
    if (history && history.length > 0) form.append("history", JSON.stringify(history));
    const res = await fetch(`${BASE}/ask/upload`, { method: "POST", body: form });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const data = await res.json();
        if (data?.detail) detail = `${res.status}: ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}`;
      } catch {}
      throw new Error(detail);
    }
    return res.json() as Promise<{ query: string; answer: string; sources: string[]; hits: SearchItem[] }>;
  },

  askStream: (
    query: string,
    limit = 6,
    category?: Category,
    documentId?: string,
    history?: { role: string; content: string }[],
    cb?: AskStreamCallbacks,
  ): AbortController => {
    const abort = new AbortController();
    (async () => {
      if (!cb) return;
      try {
        const res = await fetch(`${BASE}/ask/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            limit,
            category,
            user_id: _userIdParam(),
            document_id: documentId,
            history,
          }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          cb.onError(`HTTP ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const { event, data } = _parseSSEBlock(block);
            if (!event || !data) continue;
            if (event === "hits") cb.onHits(JSON.parse(data));
            else if (event === "delta") cb.onDelta(JSON.parse(data).text);
            else if (event === "done") cb.onDone();
            else if (event === "error") cb.onError(JSON.parse(data).message ?? "stream error");
          }
        }
      } catch (e) {
        if (!abort.signal.aborted) cb.onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return abort;
  },

  recentDocuments: (limit = 20, category?: string, source?: string) => {
    const uid = _userIdParam();
    const parts = [`limit=${limit}`];
    if (uid) parts.push(`user_id=${encodeURIComponent(uid)}`);
    if (category) parts.push(`category=${encodeURIComponent(category)}`);
    if (source) parts.push(`source=${encodeURIComponent(source)}`);
    return get<{ count: number; items: DocumentDetail[] }>(`/documents/recent?${parts.join("&")}`);
  },

  categories: () => {
    const uid = _userIdParam();
    const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
    return get<{ items: CategoryItem[] }>(`/documents/categories${qs}`);
  },

  sources: () => {
    const uid = _userIdParam();
    const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
    return get<{ items: SourceItem[] }>(`/documents/sources${qs}`);
  },

  getDocument: (id: string) => get<DocumentDetail>(`/documents/${id}`),

  markRead: (documentId: string, userId: string) =>
    post<{ ok: boolean }>("/documents/read", { document_id: documentId, user_id: userId }),

  getReadIds: (userId: string) =>
    get<{ ids: string[] }>(`/documents/read-ids?user_id=${encodeURIComponent(userId)}`),

  // ── Bookmark ──
  toggleBookmark: (documentId: string, userId: string) =>
    post<{ ok: boolean; bookmarked: boolean }>("/documents/bookmark", { document_id: documentId, user_id: userId }),

  getBookmarkIds: (userId: string) =>
    get<{ ids: string[] }>(`/documents/bookmark-ids?user_id=${encodeURIComponent(userId)}`),

  getBookmarks: (userId: string) =>
    get<{ items: DocumentDetail[] }>(`/documents/bookmarks?user_id=${encodeURIComponent(userId)}`),

  // ── Memo ──
  upsertMemo: (documentId: string, userId: string, text: string) =>
    post<{ ok: boolean }>("/documents/memo", { document_id: documentId, user_id: userId, text }),

  deleteMemo: (documentId: string, userId: string) =>
    del<{ ok: boolean }>(`/documents/memo?document_id=${encodeURIComponent(documentId)}&user_id=${encodeURIComponent(userId)}`),

  getMemos: (userId: string) =>
    get<{ items: { document_id: string; title: string; category: string; source_url: string; source_type: string; summary_date: string | null; collected_from: string | null; memo_text: string; memo_created_at: string; memo_updated_at: string }[] }>(`/documents/memos?user_id=${encodeURIComponent(userId)}`),

  getMemo: (documentId: string, userId: string) =>
    get<{ text: string | null }>(`/documents/memo?document_id=${encodeURIComponent(documentId)}&user_id=${encodeURIComponent(userId)}`),

  deleteDocument: async (id: string) => {
    const res = await fetch(`${BASE}/documents/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean; id: string }>;
  },

  summarize: (url: string) => {
    const uid = _userIdParam();
    return post<{ status: string; message: string; title?: string; category?: string; summary?: string; created?: boolean }>("/summarize", {
      url,
      user_id: uid,
    });
  },

  summarizeUpload: async (file: File) => {
    const uid = _userIdParam();
    const form = new FormData();
    form.append("file", file);
    if (uid) form.append("user_id", uid);
    const res = await fetch(`${BASE}/summarize/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ status: string; message: string; title?: string; category?: string; summary?: string; created?: boolean }>;
  },

  graphData: () =>
    get<{
      nodes: { id: string; label: string; type: "category" | "document"; category?: string; source_url?: string; source_type?: string; summary_text?: string; user_id?: string }[];
      links: { source: string; target: string }[];
    }>("/graph"),

  // ── Collector ──
  collectorSources: () =>
    get<{ sources: FeedSource[] }>("/collector/sources"),

  collectorAddSource: (source: {
    name: string;
    feed_url?: string;
    feed_type?: FeedType;
    filter_mode?: FilterMode;
    enabled?: boolean;
    max_items?: number;
    keywords?: string;
  }) => post<{ id: string }>("/collector/sources", source),

  collectorUpdateSource: (id: string, data: Partial<Omit<FeedSource, "id" | "created_at" | "last_collected_at" | "last_collected_count">>) =>
    put<{ ok: boolean }>(`/collector/sources/${id}`, data),

  collectorDeleteSource: (id: string) =>
    del<{ ok: boolean }>(`/collector/sources/${id}`),

  collectorRunSource: (id: string) =>
    post<{ status: string; results: CollectionResultItem[] }>(`/collector/sources/${id}/run`, {}),

  collectorRunAll: () =>
    post<{ status: string; results: CollectionResultItem[] }>("/collector/run", {}),

  collectorStatus: () =>
    get<{ last_run: string | null; results: CollectionResultItem[] }>("/collector/status"),

  collectorTestFeed: (params: { feed_type: string; feed_url?: string; keywords?: string; max_items?: number }) =>
    post<{ ok: boolean; count: number; entries: { title: string; url: string }[]; error?: string }>("/collector/test-feed", params),

  // ── Model Settings ──
  modelSettings: () =>
    get<{ summary_model: string; rag_model: string; summary_base_url: string; rag_base_url: string }>("/settings/models"),

  modelUpdate: (summary_model: string, rag_model: string, summary_base_url?: string, rag_base_url?: string, summary_api_key?: string, rag_api_key?: string) =>
    put<{ ok: boolean }>("/settings/models", { summary_model, rag_model, summary_base_url: summary_base_url || "", rag_base_url: rag_base_url || "", summary_api_key: summary_api_key || "", rag_api_key: rag_api_key || "" }),

  modelTest: (type: "summary" | "rag") =>
    post<{ ok: boolean; model: string; base_url: string; response?: string; error?: string }>("/settings/models/test", { type }),

  collectorLogs: () =>
    get<{ logs: { timestamp: string; sources: CollectionResultItem[] }[] }>("/collector/logs"),

  // ── Retention ──
  retentionSettings: () =>
    get<{ days: number; enabled: boolean }>("/retention/settings"),

  retentionUpdate: (days: number, enabled: boolean) =>
    put<{ ok: boolean; days: number; enabled: boolean }>("/retention/settings", { days, enabled }),

  retentionHistory: () =>
    get<{ history: { date: string; deleted: number; protected: number; active: number }[] }>("/retention/history"),

  retentionRun: () =>
    post<{ ok: boolean; deleted: number; protected: number; active: number }>("/retention/run", {}),
};
