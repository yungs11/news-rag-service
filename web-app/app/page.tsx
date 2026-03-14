"use client";

import { useCallback, useEffect, useState } from "react";
import { api, DocumentDetail, CategoryItem, Category } from "@/lib/api";
import IngestModal from "./components/IngestModal";
import SummaryRenderer from "./components/SummaryRenderer";

const CATEGORY_COLORS: Record<string, string> = {
  "AI/LLM":    "bg-violet-100 text-violet-700",
  "Infra":     "bg-sky-100 text-sky-700",
  "DB":        "bg-teal-100 text-teal-700",
  "Product":   "bg-emerald-100 text-emerald-700",
  "Business":  "bg-amber-100 text-amber-700",
  "Financial": "bg-rose-100 text-rose-700",
  "Other":     "bg-gray-100 text-gray-600",
};

const SOURCE_ICONS: Record<string, string> = {
  youtube: "▶",
  news:    "📰",
  blog:    "✍️",
  pdf:     "📕",
  docx:    "📘",
  other:   "🌐",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>
      {category}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
      <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

/* ── Summary Modal ── */
function SummaryModal({ doc, onClose }: { doc: DocumentDetail; onClose: () => void }) {
  const [tab, setTab] = useState<"summary" | "raw">("summary");
  const [fullDoc, setFullDoc] = useState<DocumentDetail | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);

  const handleRawTab = async () => {
    setTab("raw");
    if (!fullDoc && doc.id) {
      setLoadingRaw(true);
      try {
        const d = await api.getDocument(doc.id);
        setFullDoc(d);
      } catch { /* ignore */ }
      finally { setLoadingRaw(false); }
    }
  };

  const rawText = fullDoc?.raw_text ?? doc.raw_text;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CategoryBadge category={doc.category} />
              <span className="text-xs text-gray-400">{SOURCE_ICONS[doc.source_type] ?? "🔗"} {doc.source_type}</span>
              {doc.summary_date && <span className="text-xs text-gray-400">{doc.summary_date}</span>}
            </div>
            <h2 className="text-sm font-bold text-gray-900 leading-snug">{doc.title || "Untitled"}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab("summary")}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              tab === "summary"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            요약
          </button>
          <button
            onClick={handleRawTab}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              tab === "raw"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            원문 내용
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">
          {tab === "summary" ? (
            <SummaryRenderer text={doc.summary_text} />
          ) : loadingRaw ? (
            <p className="text-sm text-gray-400 text-center py-10">불러오는 중...</p>
          ) : rawText ? (
            <div className="space-y-2">
              {rawText
                .replace(/\s+/g, " ")
                .split(/(?<=[.?!。])\s+|(?=\s*-\s)/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((sentence, i) => (
                  <p key={i} className="text-sm text-gray-700 leading-relaxed">
                    {sentence}
                  </p>
                ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-10">원문 내용이 없습니다.</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Share Modal ── */
function ShareModal({ doc, onClose }: { doc: DocumentDetail; onClose: () => void }) {
  const fullShareText = `[${doc.category}] ${doc.title}\n\n${doc.summary_text}${doc.source_url && !doc.source_url.startsWith("upload://") ? `\n\n원문: ${doc.source_url}` : ""}`;
  const [textCopied, setTextCopied] = useState(false);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(fullShareText);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">공유하기</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Doc info */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{doc.title}</p>
        </div>

        {/* Share buttons */}
        <div className="p-5">
          <button
            onClick={handleCopyText}
            className={`w-full flex items-center justify-center gap-2 font-semibold text-sm py-3.5 rounded-xl transition-colors ${
              textCopied
                ? "bg-green-500 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {textCopied ? "✓ 복사 완료" : "📋 요약 + 원문링크 텍스트 복사"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [apiError, setApiError] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [shareDoc, setShareDoc] = useState<DocumentDetail | null>(null);
  const [showIngest, setShowIngest] = useState(false);

  const loadDocs = useCallback(() => {
    Promise.all([
      api.recentDocuments(50).catch(() => null),
      api.categories().catch(() => null),
    ]).then(([docRes, catRes]) => {
      if (!docRes && !catRes) setApiError(true);
      if (docRes) setDocs(docRes.items);
      if (catRes) setCategories(catRes.items);
    });
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setLoading(true);
    try {
      const res = await api.search(searchQuery, 20, selectedCategory);
      // Deduplicate by document_id (multiple chunks from same doc)
      const seen = new Set<string>();
      const mapped: DocumentDetail[] = [];
      for (const item of res.items) {
        if (seen.has(item.document_id)) continue;
        seen.add(item.document_id);
        mapped.push({
          id: item.document_id,
          source_url: item.source_url,
          source_type: item.source_type,
          title: item.title,
          category: item.category,
          summary_text: item.chunk_text,
          summary_date: item.summary_date,
          created_at: "",
        });
      }
      setSearchResults(mapped);
    } catch {
      setApiError(true);
    } finally {
      setLoading(false);
    }
  };

  const displayDocs = searchResults
    ? searchResults
    : selectedCategory
    ? docs.filter((d) => d.category === selectedCategory)
    : docs;

  const totalDocs = categories.reduce((s, c) => s + c.document_count, 0);

  return (
    <div className="space-y-6">

      {/* API 오프라인 배너 */}
      {apiError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-3 text-sm flex items-center gap-2">
          <span>⚠️</span>
          <span>RAG 서비스에 연결할 수 없습니다. <code className="bg-amber-100 px-1 rounded">rag-service</code>가 실행 중인지 확인해주세요.</span>
        </div>
      )}

      {/* Stats */}
      {!apiError && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="전체 문서" value={totalDocs} />
          <StatCard label="카테고리" value={categories.length} />
          <StatCard
            label="최근 추가"
            value={docs[0]?.summary_date ?? "-"}
          />
          <StatCard
            label="AI/LLM"
            value={categories.find((c) => c.category === "AI/LLM")?.document_count ?? 0}
          />
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="키워드로 문서 검색..."
              className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "검색 중..." : "검색"}
          </button>
          {searchResults && (
            <button
              type="button"
              onClick={() => { setSearchResults(null); setSearchQuery(""); }}
              className="border border-gray-200 px-4 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              초기화
            </button>
          )}
        </form>

        {/* Category filter */}
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory(undefined)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              !selectedCategory
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            전체 {totalDocs > 0 && `(${totalDocs})`}
          </button>
          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => setSelectedCategory(c.category as Category)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedCategory === c.category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {c.category} ({c.document_count})
            </button>
          ))}
        </div>
      </div>

      {/* Results header */}
      {searchResults && (
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">&quot;{searchQuery}&quot;</span> 검색 결과 {searchResults.length}건
        </p>
      )}

      {/* Document grid */}
      {displayDocs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-20 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-gray-500 text-sm">
            {apiError ? "RAG 서비스 연결 후 문서를 확인할 수 있습니다." : "저장된 문서가 없습니다."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {displayDocs.map((doc, i) => (
            <div
              key={doc.id || `${doc.source_url}-${i}`}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:border-blue-200 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <CategoryBadge category={doc.category} />
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-400">
                    {SOURCE_ICONS[doc.source_type] ?? "🔗"}
                  </span>
                  {doc.summary_date && (
                    <span className="text-xs text-gray-400">{doc.summary_date}</span>
                  )}
                </div>
              </div>

              <button onClick={() => setSelectedDoc(doc)} className="text-left w-full">
                <h3 className="font-semibold text-sm text-gray-900 leading-snug mb-2 line-clamp-2 group-hover:text-blue-700 transition-colors cursor-pointer">
                  {doc.title || "Untitled"}
                </h3>
              </button>

              <button onClick={() => setSelectedDoc(doc)} className="text-left w-full mb-4">
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 cursor-pointer">
                  {doc.summary_text?.slice(0, 250)}
                </p>
              </button>

              <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  {doc.source_url && !doc.source_url.startsWith("upload://") && (
                    <a
                      href={doc.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors"
                    >
                      원문보기
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {doc.id && (
                    <button
                      onClick={() => setShareDoc(doc)}
                      className="text-gray-300 hover:text-gray-500 transition-colors"
                      title="공유하기"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                      </svg>
                    </button>
                  )}
                  {doc.id && (
                    <button
                      onClick={async () => {
                        if (!confirm(`"${doc.title || "이 문서"}"를 삭제하시겠습니까?`)) return;
                        setDeletingId(doc.id);
                        try {
                          await api.deleteDocument(doc.id);
                          loadDocs();
                        } catch {
                          alert("삭제에 실패했습니다.");
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      disabled={deletingId === doc.id}
                      className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40"
                      title="삭제"
                    >
                      {deletingId === doc.id ? (
                        <span className="text-xs">·</span>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary Modal */}
      {selectedDoc && (
        <SummaryModal doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
      )}

      {/* Share Modal */}
      {shareDoc && (
        <ShareModal doc={shareDoc} onClose={() => setShareDoc(null)} />
      )}

      {/* Ingest Modal */}
      {showIngest && (
        <IngestModal
          onClose={() => setShowIngest(false)}
          onSuccess={() => { setShowIngest(false); loadDocs(); }}
        />
      )}

      {/* FAB */}
      <button
        onClick={() => setShowIngest(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 transition-colors flex items-center justify-center text-2xl leading-none"
        aria-label="문서 추가"
      >
        +
      </button>
    </div>
  );
}
