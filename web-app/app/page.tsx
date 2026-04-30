"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, DocumentDetail, CategoryItem, Category, SourceItem, MANUAL_SOURCE_SENTINEL } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { getSessionsByDoc } from "@/lib/chat-history";
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
function SummaryModal({ doc, onClose, isBookmarked, onToggleBookmark }: {
  doc: DocumentDetail;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"summary" | "raw">("summary");
  const [fullDoc, setFullDoc] = useState<DocumentDetail | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [memoText, setMemoText] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [memoLoading, setMemoLoading] = useState(false);
  const [relatedSessions, setRelatedSessions] = useState<{ id: string; title: string; message_count: number; updated_at: string }[]>([]);
  const [showRelated, setShowRelated] = useState(false);

  // Load related chat sessions
  useEffect(() => {
    if (!doc.id) return;
    getSessionsByDoc(doc.id).then(setRelatedSessions).catch(() => {});
  }, [doc.id]);

  // Load existing memo
  useEffect(() => {
    const uid = getUserId();
    if (!uid || !doc.id) return;
    api.getMemo(doc.id, uid).then((res) => {
      if (res.text) { setMemoText(res.text); setMemoSaved(true); }
    }).catch(() => {});
  }, [doc.id]);

  useEffect(() => {
    let cancelled = false;

    if (!doc.id) return;

    setLoadingDoc(true);
    api.getDocument(doc.id)
      .then((detail) => {
        if (!cancelled) setFullDoc(detail);
      })
      .catch(() => {
        if (!cancelled) setFullDoc(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  const handleRawTab = async () => {
    setTab("raw");
  };

  const resolvedDoc = fullDoc ?? doc;
  const rawText = resolvedDoc.raw_text;

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
              {resolvedDoc.summary_date && <span className="text-xs text-gray-400">{resolvedDoc.summary_date}</span>}
              {resolvedDoc.collected_from && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-50 text-cyan-600">
                  {resolvedDoc.collected_from}
                </span>
              )}
            </div>
            <h2 className="text-sm font-bold text-gray-900 leading-snug">{resolvedDoc.title || "Untitled"}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {doc.id && (
              <button
                onClick={onToggleBookmark}
                className={`transition-colors ${isBookmarked ? "text-yellow-500 hover:text-yellow-600" : "text-gray-300 hover:text-yellow-400"}`}
                title={isBookmarked ? "북마크 해제" : "북마크"}
                aria-label={isBookmarked ? "북마크 해제" : "북마크"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
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
            loadingDoc && !fullDoc ? (
              <p className="text-sm text-gray-400 text-center py-10">불러오는 중...</p>
            ) : (
              <SummaryRenderer text={resolvedDoc.summary_text} />
            )
          ) : loadingDoc && !fullDoc ? (
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

        {/* Memo */}
        <div className="px-5 pb-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <input
              value={memoText}
              onChange={(e) => { setMemoText(e.target.value); setMemoSaved(false); }}
              placeholder="메모를 남겨보세요..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={async () => {
                const uid = getUserId();
                if (!uid || !doc.id || !memoText.trim()) return;
                setMemoLoading(true);
                try {
                  await api.upsertMemo(doc.id, uid, memoText.trim());
                  setMemoSaved(true);
                } catch { /* ignore */ }
                setMemoLoading(false);
              }}
              disabled={memoLoading || !memoText.trim()}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-300 px-2 py-2 transition-colors"
            >
              {memoSaved ? "저장됨" : "저장"}
            </button>
            {memoSaved && (
              <button
                onClick={async () => {
                  const uid = getUserId();
                  if (!uid || !doc.id) return;
                  await api.deleteMemo(doc.id, uid).catch(() => {});
                  setMemoText("");
                  setMemoSaved(false);
                }}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                title="메모 삭제"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {resolvedDoc.source_url && !resolvedDoc.source_url.startsWith("upload://") && (
              <a
                href={resolvedDoc.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                원문보기
              </a>
            )}
            {doc.id && (
              <button
                onClick={() => { onClose(); router.push(`/chat?doc_id=${doc.id}&title=${encodeURIComponent(resolvedDoc.title || "")}`); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors font-medium"
              >
                질의하기
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {relatedSessions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowRelated(!showRelated)}
                  className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors font-medium"
                >
                  관련 대화 {relatedSessions.length}건
                  <svg className={`w-3 h-3 transition-transform ${showRelated ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showRelated && (
                  <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] z-10">
                    {relatedSessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { onClose(); router.push(`/chat?session=${s.id}`); }}
                        className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                      >
                        {s.title.length > 15 ? s.title.slice(0, 15) + "..." : s.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [apiError, setApiError] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [shareDoc, setShareDoc] = useState<DocumentDetail | null>(null);
  const [showIngest, setShowIngest] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  const handleToggleBookmark = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    const uid = getUserId();
    if (!uid || !docId) return;
    try {
      const res = await api.toggleBookmark(docId, uid);
      setBookmarkIds((prev) => {
        const next = new Set(prev);
        if (res.bookmarked) next.add(docId);
        else next.delete(docId);
        return next;
      });
    } catch { /* ignore */ }
  };

  const handleOpenDoc = (doc: DocumentDetail) => {
    setSelectedDoc(doc);
    if (doc.id) {
      const uid = getUserId();
      if (uid) {
        api.markRead(doc.id, uid).catch(() => {});
      }
      setReadIds((prev) => new Set([...prev, doc.id]));
    }
  };

  const loadMetadata = useCallback(() => {
    const uid = typeof window !== "undefined" ? getUserId() : null;
    Promise.all([
      api.categories().catch(() => null),
      api.sources().catch(() => null),
      uid ? api.getReadIds(uid).catch(() => null) : Promise.resolve(null),
      uid ? api.getBookmarkIds(uid).catch(() => null) : Promise.resolve(null),
    ]).then(([catRes, srcRes, readRes, bmRes]) => {
      if (catRes) setCategories(catRes.items);
      if (srcRes) setSources(srcRes.items);
      if (readRes) setReadIds(new Set(readRes.ids));
      if (bmRes) setBookmarkIds(new Set(bmRes.ids));
    });
  }, []);

  const loadDocs = useCallback(() => {
    api.recentDocuments(500, selectedCategory, selectedSource)
      .then((res) => { setDocs(res.items); setApiError(false); })
      .catch(() => setApiError(true));
  }, [selectedCategory, selectedSource]);

  useEffect(() => { setMounted(true); loadMetadata(); }, [loadMetadata]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ?doc=ID 쿼리 파라미터로 문서 모달 자동 오픈
  const searchParams = useSearchParams();
  useEffect(() => {
    const docId = searchParams.get("doc");
    if (docId && docs.length > 0) {
      const found = docs.find((d) => d.id === docId);
      if (found) {
        handleOpenDoc(found);
      } else {
        // docs에 없으면 API에서 직접 로드
        api.getDocument(docId).then((detail) => {
          if (detail) handleOpenDoc(detail);
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, docs]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setLoading(true);
    try {
      const res = await api.search(searchQuery, 20, selectedCategory, selectedSource);
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
          summary_text: item.summary_text,
          summary_date: item.summary_date,
          ingest_type: "manual",
          collected_from: null,
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

  const displayDocs = searchResults ?? docs;

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
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100 overflow-x-auto pb-1 scrollbar-none touch-pan-x">
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

        {/* Source filter */}
        {sources.length > 0 && (
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none touch-pan-x">
            <span className="shrink-0 self-center text-[11px] font-semibold text-gray-400 pr-1">출처</span>
            <button
              onClick={() => setSelectedSource(undefined)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                !selectedSource
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              전체
            </button>
            {sources.map((s) => {
              const label = s.source === MANUAL_SOURCE_SENTINEL ? "수동 등록" : s.source;
              return (
                <button
                  key={s.source}
                  onClick={() => setSelectedSource(s.source)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    selectedSource === s.source
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label} ({s.document_count})
                </button>
              );
            })}
          </div>
        )}
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
          {displayDocs.map((doc, i) => {
            const unread = mounted && doc.id ? !readIds.has(doc.id) : false;
            return (
            <div
              key={doc.id || `${doc.source_url}-${i}`}
              className={`bg-white rounded-xl border shadow-sm p-5 min-w-0 break-words hover:border-blue-200 hover:shadow-md transition-all group ${unread ? "border-blue-100" : "border-gray-100"}`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Unread dot */}
                  {unread && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" title="읽지 않음" />
                  )}
                  <CategoryBadge category={doc.category} />
                  {/* Ingest type badge */}
                  {doc.ingest_type === "auto" ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-50 text-cyan-600">
                      자동{doc.collected_from ? ` · ${doc.collected_from}` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-500">
                      수동
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Bookmark star */}
                  {mounted && doc.id && (
                    <button
                      onClick={(e) => handleToggleBookmark(e, doc.id)}
                      className={`transition-colors ${bookmarkIds.has(doc.id) ? "text-yellow-400 hover:text-yellow-500" : "text-gray-200 hover:text-yellow-300"}`}
                      title={bookmarkIds.has(doc.id) ? "북마크 해제" : "북마크"}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={bookmarkIds.has(doc.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  )}
                  <span className="text-xs text-gray-400">
                    {SOURCE_ICONS[doc.source_type] ?? "🔗"}
                  </span>
                  {doc.summary_date && (
                    <span className="text-xs text-gray-400">{doc.summary_date}</span>
                  )}
                </div>
              </div>

              <button onClick={() => handleOpenDoc(doc)} className="text-left w-full">
                <h3 className={`font-semibold text-sm leading-snug mb-2 line-clamp-2 group-hover:text-blue-700 transition-colors cursor-pointer ${unread ? "text-gray-900" : "text-gray-500"}`}>
                  {doc.title || "Untitled"}
                </h3>
              </button>

              <button onClick={() => handleOpenDoc(doc)} className="text-left w-full mb-4">
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
          );
          })}
        </div>
      )}

      {/* Summary Modal */}
      {selectedDoc && (
        <SummaryModal
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          isBookmarked={bookmarkIds.has(selectedDoc.id)}
          onToggleBookmark={async () => {
            const uid = getUserId();
            if (!uid || !selectedDoc.id) return;
            try {
              const res = await api.toggleBookmark(selectedDoc.id, uid);
              setBookmarkIds((prev) => {
                const next = new Set(prev);
                if (res.bookmarked) next.add(selectedDoc.id);
                else next.delete(selectedDoc.id);
                return next;
              });
            } catch { /* ignore */ }
          }}
        />
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
