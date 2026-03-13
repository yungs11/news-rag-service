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
  chunk_text: string;
  score: number;
}

export interface DocumentDetail {
  id: string;
  source_url: string;
  source_type: string;
  title: string;
  category: string;
  summary_text: string;
  raw_text?: string | null;
  summary_date: string | null;
  created_at: string;
}

export interface CategoryItem {
  category: string;
  document_count: number;
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  search: (query: string, limit = 10, category?: Category) =>
    post<{ query: string; count: number; items: SearchItem[] }>("/search", {
      query,
      limit,
      category,
    }),

  ask: (query: string, limit = 6, category?: Category) =>
    post<{ query: string; answer: string; sources: string[]; hits: SearchItem[] }>("/ask", {
      query,
      limit,
      category,
    }),

  recentDocuments: (limit = 20) =>
    get<{ count: number; items: DocumentDetail[] }>(`/documents/recent?limit=${limit}`),

  categories: () => get<{ items: CategoryItem[] }>("/documents/categories"),

  getDocument: (id: string) => get<DocumentDetail>(`/documents/${id}`),
};
