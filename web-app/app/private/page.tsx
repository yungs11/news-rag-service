"use client";

import { useCallback, useEffect, useState } from "react";
import { api, DocumentDetail } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { useRouter } from "next/navigation";

const CATEGORY_COLORS: Record<string, string> = {
  "AI/LLM": "bg-violet-100 text-violet-700",
  "Infra": "bg-sky-100 text-sky-700",
  "DB": "bg-teal-100 text-teal-700",
  "Product": "bg-emerald-100 text-emerald-700",
  "Business": "bg-amber-100 text-amber-700",
  "Financial": "bg-rose-100 text-rose-700",
  "Other": "bg-gray-100 text-gray-600",
};

interface MemoItem {
  document_id: string;
  title: string;
  category: string;
  source_url: string;
  source_type: string;
  summary_date: string | null;
  collected_from: string | null;
  memo_text: string;
  memo_created_at: string;
  memo_updated_at: string;
}

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>
      {category}
    </span>
  );
}

export default function PrivatePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"bookmarks" | "memos">("bookmarks");
  const [bookmarks, setBookmarks] = useState<DocumentDetail[]>([]);
  const [memos, setMemos] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const uid = typeof window !== "undefined" ? getUserId() : null;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [bmRes, memoRes] = await Promise.all([
        api.getBookmarks(uid).catch(() => ({ items: [] })),
        api.getMemos(uid).catch(() => ({ items: [] })),
      ]);
      setBookmarks(bmRes.items);
      setMemos(memoRes.items);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) { router.replace("/login"); return; }
    load();
  }, [uid, load, router]);

  const handleRemoveBookmark = async (docId: string) => {
    if (!uid) return;
    await api.toggleBookmark(docId, uid).catch(() => {});
    setBookmarks((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleSaveMemo = async (docId: string) => {
    if (!uid || !editText.trim()) return;
    await api.upsertMemo(docId, uid, editText.trim()).catch(() => {});
    setEditingMemo(null);
    load();
  };

  const handleDeleteMemo = async (docId: string) => {
    if (!uid) return;
    if (!confirm("메모를 삭제하시겠습니까?")) return;
    await api.deleteMemo(docId, uid).catch(() => {});
    setMemos((prev) => prev.filter((m) => m.document_id !== docId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">나의 라이브러리</h1>
        <p className="text-xs text-gray-400 mt-1">
          북마크 {bookmarks.length}건 / 메모 {memos.length}건
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab("bookmarks")}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
            tab === "bookmarks"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          ★ 북마크 ({bookmarks.length})
        </button>
        <button
          onClick={() => setTab("memos")}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
            tab === "memos"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          메모 ({memos.length})
        </button>
      </div>

      {/* Bookmarks Tab */}
      {tab === "bookmarks" && (
        bookmarks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center">
            <p className="text-3xl mb-2">★</p>
            <p className="text-gray-500 text-sm">북마크한 문서가 없습니다.</p>
            <p className="text-gray-400 text-xs mt-1">문서 카드의 별 아이콘을 눌러 북마크하세요.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {bookmarks.map((doc) => (
              <div
                key={doc.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:border-blue-200 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <CategoryBadge category={doc.category} />
                  <button
                    onClick={() => handleRemoveBookmark(doc.id)}
                    className="text-yellow-400 hover:text-yellow-500 transition-colors"
                    title="북마크 해제"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                </div>
                <h3 className="font-semibold text-sm text-gray-900 leading-snug mb-2 line-clamp-2">
                  {doc.title || "Untitled"}
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 mb-3">
                  {doc.summary_text?.slice(0, 200)}
                </p>
                <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-50">
                  <span>{doc.summary_date ?? ""}</span>
                  {doc.source_url && !doc.source_url.startsWith("upload://") && (
                    <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 hover:underline">
                      원문보기
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Memos Tab */}
      {tab === "memos" && (
        memos.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center">
            <p className="text-3xl mb-2">📝</p>
            <p className="text-gray-500 text-sm">메모가 없습니다.</p>
            <p className="text-gray-400 text-xs mt-1">문서를 열고 메모를 남겨보세요.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {memos.map((memo) => (
              <div key={memo.document_id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={memo.category} />
                    {memo.collected_from && (
                      <span className="text-[10px] font-semibold text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded">
                        {memo.collected_from}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{memo.summary_date ?? ""}</span>
                </div>

                <h3 className="font-semibold text-sm text-gray-900 leading-snug mb-3">
                  {memo.title || "Untitled"}
                </h3>

                {editingMemo === memo.document_id ? (
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveMemo(memo.document_id)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-2"
                    >
                      저장
                    </button>
                    <button
                      onClick={() => setEditingMemo(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="bg-amber-50 rounded-lg px-4 py-3 mb-3">
                    <p className="text-sm text-amber-900">{memo.memo_text}</p>
                    <p className="text-[10px] text-amber-400 mt-1">
                      {memo.memo_updated_at?.replace("T", " ").slice(0, 19)}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                  <button
                    onClick={() => { setEditingMemo(memo.document_id); setEditText(memo.memo_text); }}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDeleteMemo(memo.document_id)}
                    className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    삭제
                  </button>
                  {memo.source_url && !memo.source_url.startsWith("upload://") && (
                    <a href={memo.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-gray-600 hover:underline ml-auto">
                      원문보기
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
