"use client";

import { useCallback, useEffect, useState } from "react";
import { api, FeedSource, FilterMode, FeedType, CollectionResultItem } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { useRouter } from "next/navigation";

function toKST(utcStr: string | null): string {
  if (!utcStr) return "";
  try {
    const d = new Date(utcStr.endsWith("Z") ? utcStr : utcStr + "Z");
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }).replace(". ", "-").replace(". ", "-").replace(". ", " ");
  } catch {
    return utcStr.replace("T", " ").slice(0, 19);
  }
}

/* ── Source Add/Edit Modal ── */
function SourceModal({
  source,
  onClose,
  onSaved,
}: {
  source: FeedSource | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = source !== null;
  const [name, setName] = useState(source?.name ?? "");
  const [feedUrl, setFeedUrl] = useState(source?.feed_url ?? "");
  const [feedType, setFeedType] = useState<FeedType>(source?.feed_type ?? "rss");
  const [filterMode, setFilterMode] = useState<FilterMode>(source?.filter_mode ?? "all");
  const [maxItems, setMaxItems] = useState(source?.max_items ?? 10);
  const [keywords, setKeywords] = useState(source?.keywords ?? "");
  const [retain, setRetain] = useState(source?.retain ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // YouTube channel tags
  const [ytHandles, setYtHandles] = useState<string[]>(() => {
    if (source?.feed_type === "youtube_channel" && source?.keywords) {
      return source.keywords.split(",").map((h) => h.trim()).filter(Boolean);
    }
    return [];
  });
  const [ytInput, setYtInput] = useState("");

  // Test feed
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ title: string; url: string }[] | null>(null);
  const [testError, setTestError] = useState("");

  const addYtHandle = () => {
    const h = ytInput.trim().replace(/^@/, "").replace(/\/videos$/, "");
    if (h && !ytHandles.includes(h)) {
      setYtHandles([...ytHandles, h]);
    }
    setYtInput("");
  };

  const removeYtHandle = (handle: string) => {
    setYtHandles(ytHandles.filter((h) => h !== handle));
  };

  const handleTestFeed = async () => {
    setTesting(true);
    setTestResults(null);
    setTestError("");
    try {
      const params: { feed_type: string; feed_url?: string; keywords?: string; max_items?: number } = {
        feed_type: feedType,
        max_items: 5,
      };
      if (feedType === "youtube_channel") {
        params.keywords = ytHandles.join(", ");
      } else if (feedType === "arxiv") {
        params.keywords = keywords;
      } else {
        params.feed_url = feedUrl;
      }
      const res = await api.collectorTestFeed(params);
      if (res.ok) {
        setTestResults(res.entries);
      } else {
        setTestError(res.error || "테스트 실패");
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "테스트 실패");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (feedType === "arxiv" && !keywords.trim()) {
      setError("검색 키워드를 입력하세요.");
      return;
    }
    if (feedType === "youtube_channel" && ytHandles.length === 0) {
      setError("채널을 하나 이상 추가하세요.");
      return;
    }
    if (!["arxiv", "youtube_channel"].includes(feedType) && !feedUrl.trim()) {
      setError("RSS URL을 입력하세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ytKeywords = feedType === "youtube_channel" ? ytHandles.join(", ") : undefined;
      const payload = {
        name: name.trim(),
        feed_url: ["arxiv", "youtube_channel"].includes(feedType) ? "" : feedUrl.trim(),
        feed_type: feedType,
        filter_mode: filterMode,
        max_items: maxItems,
        keywords: feedType === "arxiv" ? keywords.trim() : ytKeywords,
        retain,
      };
      if (isEdit) {
        await api.collectorUpdateSource(source.id, payload);
      } else {
        await api.collectorAddSource(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">
            {isEdit ? "소스 편집" : "소스 추가"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: GeekNews"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Feed Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">소스 타입</label>
            <select
              value={feedType}
              onChange={(e) => setFeedType(e.target.value as FeedType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="rss">RSS / Atom</option>
              <option value="reddit_rss">Reddit RSS</option>
              <option value="arxiv">arXiv 논문</option>
              <option value="youtube_channel">YouTube 채널</option>
            </select>
          </div>

          {/* Feed URL (RSS types only) */}
          {!["arxiv", "youtube_channel"].includes(feedType) && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">RSS URL</label>
              <input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://example.com/rss"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* YouTube channel tags */}
          {feedType === "youtube_channel" && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">YouTube 채널</label>
              <div className="flex gap-2">
                <input
                  value={ytInput}
                  onChange={(e) => setYtInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addYtHandle(); } }}
                  placeholder="@채널명 입력 후 Enter"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={addYtHandle}
                  className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  추가
                </button>
              </div>
              {/* Tags */}
              {ytHandles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {ytHandles.map((h) => (
                    <span key={h} className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-medium">
                      @{h}
                      <button onClick={() => removeYtHandle(h)} className="text-red-400 hover:text-red-600 ml-0.5">✕</button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-1.5">예: jocoding, teddynote, zerochotv</p>
            </div>
          )}

          {/* Keywords (arXiv only) */}
          {feedType === "arxiv" && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">검색 키워드</label>
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="예: transformer, LLM, diffusion model"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">쉼표로 구분. arXiv에서 키워드가 포함된 최신 논문을 수집합니다.</p>
            </div>
          )}

          {/* Filter Mode */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">수집 필터</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="filterMode"
                  checked={filterMode === "all"}
                  onChange={() => setFilterMode("all")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">모든 글 수집</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="filterMode"
                  checked={filterMode === "ai_only"}
                  onChange={() => setFilterMode("ai_only")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">AI 관련 글만</span>
              </label>
            </div>
          </div>

          {/* Max Items */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              1회 최대 수집 건수
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxItems}
              onChange={(e) => setMaxItems(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
              className="w-24 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Retain toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-semibold text-gray-600">보존 (삭제 제외)</label>
              <p className="text-[10px] text-gray-400">자동 클린업에서 이 소스의 문서를 제외합니다</p>
            </div>
            <button
              type="button"
              onClick={() => setRetain(!retain)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                retain ? "bg-amber-500" : "bg-gray-200"
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                retain ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {/* Test feed button */}
          <div>
            <button
              type="button"
              onClick={handleTestFeed}
              disabled={testing}
              className="text-xs font-medium text-gray-500 hover:text-blue-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:border-blue-300 transition-colors disabled:opacity-50"
            >
              {testing ? "테스트 중..." : "피드 테스트"}
            </button>
            {testError && <p className="text-xs text-red-500 mt-1">{testError}</p>}
            {testResults && (
              <div className="mt-2 bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                <p className="text-[11px] text-gray-400 mb-1">{testResults.length}건 감지</p>
                {testResults.map((e, i) => (
                  <p key={i} className="text-xs text-gray-600 truncate">{e.title}</p>
                ))}
                {testResults.length === 0 && <p className="text-xs text-gray-400">항목이 없습니다.</p>}
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Collection Result Modal ── */
function ResultModal({
  results,
  onClose,
}: {
  results: CollectionResultItem[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">수집 결과</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-3">
          {results.map((r, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 space-y-1">
              <p className="text-sm font-semibold text-gray-900">{r.source_name}</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                <span>피드 항목: {r.total_entries}건</span>
                <span>필터 통과: {r.filtered}건</span>
                <span className="text-green-600 font-medium">수집 성공: {r.collected}건</span>
                <span>중복 건너뜀: {r.skipped_duplicate}건</span>
                {r.failed > 0 && (
                  <span className="text-red-500 col-span-2">실패: {r.failed}건</span>
                )}
              </div>
              {r.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {r.errors.slice(0, 3).map((err, j) => (
                    <p key={j} className="text-xs text-red-400 break-all">{err}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">수집 결과가 없습니다.</p>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Source Card ── */
function SourceCard({
  source,
  onEdit,
  onDelete,
  onRun,
  onToggle,
}: {
  source: FeedSource;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onToggle: () => void;
}) {
  const filterLabel = source.filter_mode === "ai_only" ? "AI 관련만" : "모두 수집";
  const filterColor = source.filter_mode === "ai_only" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-600";

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 transition-all ${source.enabled ? "border-gray-100" : "border-gray-200 opacity-60"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${source.enabled ? "bg-green-400" : "bg-gray-300"}`} />
          <h3 className="font-semibold text-sm text-gray-900">{source.name}</h3>
        </div>
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            source.enabled ? "bg-blue-600" : "bg-gray-200"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              source.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* URL or Keywords/Channels */}
      {source.feed_type === "arxiv" && source.keywords ? (
        <p className="text-xs text-purple-500 mb-3">
          키워드: {source.keywords}
        </p>
      ) : source.feed_type === "youtube_channel" && source.keywords ? (
        <div className="flex flex-wrap gap-1 mb-3">
          {source.keywords.split(",").map((h) => h.trim()).filter(Boolean).map((h) => (
            <span key={h} className="inline-flex items-center px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-medium">
              @{h}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 break-all mb-3">{source.feed_url}</p>
      )}

      {/* Badges */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
          source.feed_type === "arxiv" ? "bg-purple-100 text-purple-700" : filterColor
        }`}>
          {source.feed_type === "arxiv" ? "arXiv 논문" : filterLabel}
        </span>
        {source.retain && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-700">
            보존
          </span>
        )}
        <span className="text-xs text-gray-400">
          {({"arxiv": "arXiv", "youtube_channel": "YouTube", "reddit_rss": "Reddit", "arca_live": "Arca", "rss": "RSS"} as Record<string, string>)[source.feed_type] ?? "RSS"} | 최대 {source.max_items}건
        </span>
      </div>

      {/* Last collection */}
      {source.last_collected_at ? (
        <p className="text-xs text-gray-400 mb-4">
          마지막 수집: {toKST(source.last_collected_at)}
          {source.last_collected_count !== null && ` (${source.last_collected_count}건)`}
        </p>
      ) : (
        <p className="text-xs text-gray-300 mb-4">아직 수집 이력 없음</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-50">
        <button
          onClick={onRun}
          className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded hover:bg-blue-50"
        >
          수집
        </button>
        <button
          onClick={onEdit}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-50"
        >
          편집
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function CollectorPage() {
  const router = useRouter();
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editSource, setEditSource] = useState<FeedSource | null>(null);
  const [resultItems, setResultItems] = useState<CollectionResultItem[] | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [retDays, setRetDays] = useState(7);
  const [retEnabled, setRetEnabled] = useState(true);
  const [retSaving, setRetSaving] = useState(false);
  const [cleanupHistory, setCleanupHistory] = useState<{ date: string; deleted: number; protected: number; active: number }[]>([]);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [error, setError] = useState("");

  const loadSources = useCallback(async () => {
    try {
      const res = await api.collectorSources();
      setSources(res.sources);
    } catch {
      setError("소스 목록을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.collectorStatus();
      setLastRun(res.last_run);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && !isAdmin()) {
      router.replace("/");
      return;
    }
    loadSources();
    loadStatus();
    // Load retention settings
    api.retentionSettings().then((r) => { setRetDays(r.days); setRetEnabled(r.enabled); }).catch(() => {});
    api.retentionHistory().then((r) => setCleanupHistory(r.history)).catch(() => {});
  }, [loadSources, loadStatus, router]);

  const handleRunAll = async () => {
    if (!confirm("모든 활성 소스에서 뉴스를 수집합니다. 시간이 다소 걸릴 수 있습니다.")) return;
    setRunningAll(true);
    setError("");
    try {
      const res = await api.collectorRunAll();
      setResultItems(res.results);
      loadSources();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수집 실패");
    } finally {
      setRunningAll(false);
    }
  };

  const handleRunSource = async (source: FeedSource) => {
    setRunningId(source.id);
    setError("");
    try {
      const res = await api.collectorRunSource(source.id);
      setResultItems(res.results);
      loadSources();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수집 실패");
    } finally {
      setRunningId(null);
    }
  };

  const handleToggle = async (source: FeedSource) => {
    try {
      await api.collectorUpdateSource(source.id, { enabled: !source.enabled });
      loadSources();
    } catch { /* ignore */ }
  };

  const handleDelete = async (source: FeedSource) => {
    if (!confirm(`"${source.name}" 소스를 삭제하시겠습니까?`)) return;
    try {
      await api.collectorDeleteSource(source.id);
      loadSources();
    } catch {
      setError("삭제 실패");
    }
  };

  const enabledCount = sources.filter((s) => s.enabled).length;
  const totalCollected = sources.reduce((sum, s) => sum + (s.last_collected_count ?? 0), 0);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">뉴스 수집 관리</h1>
          <p className="text-xs text-gray-400 mt-1">
            3시간마다 자동 수집 | 매일 03:00 클린업 (KST) | {enabledCount}개 소스 활성
            {lastRun && ` | 마지막 실행: ${toKST(lastRun)}`}
          </p>
        </div>
        <button
          onClick={handleRunAll}
          disabled={runningAll}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {runningAll ? (
            <>
              <span className="animate-spin text-xs">&#9696;</span>
              수집 중...
            </>
          ) : (
            "전체 수집 실행"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">등록 소스</p>
          <p className="text-2xl font-bold text-gray-900">{sources.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">활성</p>
          <p className="text-2xl font-bold text-green-600">{enabledCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">최근 수집 합계</p>
          <p className="text-2xl font-bold text-blue-600">{totalCollected}</p>
        </div>
      </div>

      {/* Retention Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">데이터 보존 정책</h3>
          <button
            type="button"
            onClick={() => setRetEnabled(!retEnabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              retEnabled ? "bg-blue-600" : "bg-gray-200"
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              retEnabled ? "translate-x-4" : "translate-x-0.5"
            }`} />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <p className="text-xs text-gray-500">메모/북마크/대화가 없는 문서를</p>
          <input
            type="number"
            min={1}
            max={365}
            value={retDays}
            onChange={(e) => setRetDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 7)))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">일 후 자동 삭제</p>
          <button
            onClick={async () => {
              setRetSaving(true);
              try {
                await api.retentionUpdate(retDays, retEnabled);
              } catch { /* ignore */ }
              setRetSaving(false);
            }}
            disabled={retSaving}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {retSaving ? "저장 중..." : "저장"}
          </button>
          <button
            onClick={async () => {
              if (!confirm("지금 클린업을 실행합니다. 조건에 해당하는 문서가 삭제됩니다.")) return;
              setCleanupRunning(true);
              try {
                const res = await api.retentionRun();
                setCleanupHistory((prev) => [...prev, { date: new Date().toISOString(), deleted: res.deleted, protected: res.protected, active: res.active }]);
                alert(`클린업 완료: ${res.deleted}건 삭제`);
              } catch { alert("클린업 실패"); }
              setCleanupRunning(false);
            }}
            disabled={cleanupRunning}
            className="text-xs font-medium text-red-500 hover:text-red-700 px-3 py-1 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {cleanupRunning ? "실행 중..." : "수동 실행"}
          </button>
        </div>
        {!retEnabled && <p className="text-xs text-gray-400 mb-3">자동 클린업이 비활성화되어 있습니다.</p>}

        {/* Cleanup History */}
        {cleanupHistory.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">클린업 이력</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1.5 font-medium">날짜</th>
                    <th className="text-right py-1.5 font-medium">삭제</th>
                    <th className="text-right py-1.5 font-medium">보존 소스</th>
                    <th className="text-right py-1.5 font-medium">활성 문서</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cleanupHistory].reverse().slice(0, 10).map((h, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-600">{toKST(h.date)}</td>
                      <td className="py-1.5 text-right font-semibold text-red-500">{h.deleted}</td>
                      <td className="py-1.5 text-right text-amber-600">{h.protected}</td>
                      <td className="py-1.5 text-right text-blue-600">{h.active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Source cards */}
      {sources.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-3xl mb-2">📡</p>
          <p className="text-gray-500 text-sm">등록된 수집 소스가 없습니다.</p>
          <p className="text-gray-400 text-xs mt-1">아래 버튼으로 소스를 추가하세요.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onEdit={() => {
                setEditSource(source);
                setShowModal(true);
              }}
              onDelete={() => handleDelete(source)}
              onRun={() => handleRunSource(source)}
              onToggle={() => handleToggle(source)}
            />
          ))}
        </div>
      )}

      {/* Running indicator */}
      {runningId && (
        <div className="fixed bottom-20 right-6 bg-blue-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm flex items-center gap-2 z-40">
          <span className="animate-spin text-xs">&#9696;</span>
          수집 중...
        </div>
      )}

      {/* Add source FAB */}
      <button
        onClick={() => {
          setEditSource(null);
          setShowModal(true);
        }}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 transition-colors flex items-center justify-center text-2xl leading-none"
        aria-label="소스 추가"
      >
        +
      </button>

      {/* Source Modal */}
      {showModal && (
        <SourceModal
          source={editSource}
          onClose={() => {
            setShowModal(false);
            setEditSource(null);
          }}
          onSaved={loadSources}
        />
      )}

      {/* Result Modal */}
      {resultItems && (
        <ResultModal
          results={resultItems}
          onClose={() => setResultItems(null)}
        />
      )}
    </div>
  );
}
