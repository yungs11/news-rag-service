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

export type FilterMode = "all" | "ai_only";
export type FeedType = "rss" | "reddit_rss" | "arxiv";

export interface FeedSource {
  id: string;
  name: string;
  feed_url: string;
  feed_type: FeedType;
  filter_mode: FilterMode;
  enabled: boolean;
  max_items: number;
  keywords: string | null;
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
  search: (query: string, limit = 10, category?: Category) =>
    post<{ query: string; count: number; items: SearchItem[] }>("/search", {
      query,
      limit,
      category,
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

  recentDocuments: (limit = 20) => {
    const uid = _userIdParam();
    const qs = uid ? `&user_id=${encodeURIComponent(uid)}` : "";
    return get<{ count: number; items: DocumentDetail[] }>(`/documents/recent?limit=${limit}${qs}`);
  },

  categories: () => {
    const uid = _userIdParam();
    const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
    return get<{ items: CategoryItem[] }>(`/documents/categories${qs}`);
  },

  getDocument: (id: string) => get<DocumentDetail>(`/documents/${id}`),

  markRead: (documentId: string, userId: string) =>
    post<{ ok: boolean }>("/documents/read", { document_id: documentId, user_id: userId }),

  getReadIds: (userId: string) =>
    get<{ ids: string[] }>(`/documents/read-ids?user_id=${encodeURIComponent(userId)}`),

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
};
