"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { isAdmin } from "@/lib/auth";
import { api } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const CATEGORY_COLORS: Record<string, string> = {
  "AI/LLM":    "#8B5CF6",
  "Infra":     "#3B82F6",
  "DB":        "#10B981",
  "Product":   "#F59E0B",
  "Business":  "#EF4444",
  "Financial": "#06B6D4",
  "Other":     "#6B7280",
};

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "#6B7280";
}

interface GraphNode {
  id: string;
  label: string;
  type: "category" | "document";
  category?: string;
  source_url?: string;
  source_type?: string;
  summary_text?: string;
  user_id?: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  link_type?: "category" | "similarity";
  score?: number;
}

interface Popup {
  node: GraphNode;
  x: number;
  y: number;
}

export default function GraphPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSimilarity, setShowSimilarity] = useState(true);
  const [threshold, setThreshold] = useState(0.75);

  useEffect(() => {
    if (!isAdmin()) router.replace("/login");
  }, [router]);

  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const fetchGraph = useCallback((t: number) => {
    setLoading(true);
    setError(null);
    fetch(`/api/rag/graph?threshold=${t}`)
      .then((r) => r.json())
      .then((data) => setGraphData(data as { nodes: GraphNode[]; links: GraphLink[] }))
      .catch(() => setError("그래프 데이터를 불러올 수 없습니다."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGraph(threshold);
  }, [fetchGraph, threshold]);

  const handleNodeClick = useCallback((node: GraphNode, event: MouseEvent) => {
    if (node.type === "category") { setPopup(null); return; }
    setPopup({ node, x: event.clientX, y: event.clientY });
  }, []);

  const paintNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (node.type === "category") {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, 2 * Math.PI);
      ctx.fillStyle = categoryColor(node.label);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "bold 5px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(node.label, x, y);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = categoryColor(node.category ?? "Other");
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, []);

  const paintLink = useCallback((link: GraphLink, ctx: CanvasRenderingContext2D) => {
    const src = link.source as GraphNode;
    const tgt = link.target as GraphNode;
    if (!src?.x || !tgt?.x) return;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y ?? 0);
    ctx.lineTo(tgt.x, tgt.y ?? 0);

    if (link.link_type === "similarity") {
      const score = link.score ?? 0.75;
      // 유사도에 따라 색상: 높을수록 주황→빨강
      const alpha = Math.min(1, (score - 0.7) * 4);
      ctx.strokeStyle = `rgba(251, 146, 60, ${alpha})`;
      ctx.lineWidth = 1 + (score - 0.7) * 6;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = "rgba(75, 85, 99, 0.25)";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  const visibleData = graphData
    ? {
        nodes: graphData.nodes,
        links: showSimilarity
          ? graphData.links
          : graphData.links.filter((l) => l.link_type !== "similarity"),
      }
    : null;

  const docCount = graphData?.nodes.filter((n) => n.type === "document").length ?? 0;
  const catCount = graphData?.nodes.filter((n) => n.type === "category").length ?? 0;
  const simCount = graphData?.links.filter((l) => l.link_type === "similarity").length ?? 0;

  return (
    <div className="relative w-full h-screen bg-gray-950 overflow-hidden" ref={containerRef}>
      {/* 범례 + 컨트롤 */}
      <div className="absolute top-4 left-4 z-10 bg-gray-900 bg-opacity-90 rounded-lg p-3 text-xs text-gray-300 space-y-2 min-w-[160px]">
        <div className="font-semibold text-white">
          문서 {docCount} · 카테고리 {catCount}
        </div>
        <div className="text-gray-400">유사도 연결 {simCount}개</div>

        {/* 카테고리 범례 */}
        <div className="space-y-1 pt-1 border-t border-gray-700">
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {cat}
            </div>
          ))}
        </div>

        {/* 링크 범례 */}
        <div className="space-y-1 pt-1 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <span className="w-6 border-t border-gray-500" />
            카테고리 연결
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-orange-400" />
            유사도 연결
          </div>
        </div>

        {/* 유사도 토글 */}
        <div className="pt-1 border-t border-gray-700 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSimilarity}
              onChange={(e) => setShowSimilarity(e.target.checked)}
              className="accent-orange-400"
            />
            유사도 링크 표시
          </label>
          <div>
            <div className="flex justify-between mb-1">
              <span>임계값</span>
              <span className="text-orange-300">{threshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.65}
              max={0.95}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              onMouseUp={(e) => fetchGraph(parseFloat((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => fetchGraph(parseFloat((e.target as HTMLInputElement).value))}
              className="w-full accent-orange-400"
            />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>넓게</span><span>엄격</span>
            </div>
          </div>
        </div>
      </div>

      {/* 뒤로가기 */}
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 right-4 z-10 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-md transition-colors"
      >
        ← 문서 목록
      </button>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm z-10">
          {simCount === 0 ? "유사도 분석 중..." : "그래프 로딩 중..."}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 z-10">
          {error}
        </div>
      )}

      {visibleData && (
        <ForceGraph2D
          graphData={visibleData}
          width={dimensions.width}
          height={dimensions.height}
          nodeCanvasObject={paintNode as (node: object, ctx: CanvasRenderingContext2D) => void}
          nodeCanvasObjectMode={() => "replace"}
          linkCanvasObject={paintLink as (link: object, ctx: CanvasRenderingContext2D) => void}
          linkCanvasObjectMode={() => "replace"}
          onNodeClick={handleNodeClick as (node: object, event: MouseEvent) => void}
          onBackgroundClick={() => setPopup(null)}
          cooldownTicks={150}
          nodeLabel={(node) => (node as GraphNode).label}
        />
      )}

      {/* 팝업 */}
      {popup && (
        <div
          className="absolute z-20 bg-gray-900 border border-gray-700 rounded-lg p-4 max-w-xs shadow-xl text-sm"
          style={{
            left: Math.min(popup.x + 10, dimensions.width - 320),
            top: Math.min(popup.y + 10, dimensions.height - 200),
          }}
        >
          <button
            onClick={() => setPopup(null)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕
          </button>
          <p className="font-semibold text-white leading-snug mb-1 pr-4">{popup.node.label}</p>
          <p className="text-xs text-gray-400 mb-2">
            {popup.node.source_type} · {popup.node.category}
            {popup.node.user_id && (
              <span className="ml-1 text-gray-500">({popup.node.user_id.slice(0, 8)}...)</span>
            )}
          </p>
          {popup.node.summary_text && (
            <p className="text-gray-300 text-xs leading-relaxed mb-2 line-clamp-4">
              {popup.node.summary_text}
            </p>
          )}
          {popup.node.source_url && (
            <a
              href={popup.node.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-xs underline"
            >
              원본 이동 →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
