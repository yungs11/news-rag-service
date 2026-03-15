"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import SummaryRenderer from "./SummaryRenderer";

type Tab = "url" | "file";
type Phase = "idle" | "loading" | "done" | "exists" | "error";

interface Result {
  title?: string;
  category?: string;
  summary?: string;
  message: string;
}

export default function IngestModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPhase("idle"); setResult(null); };

  const handleSubmit = async () => {
    setPhase("loading");
    setResult(null);
    try {
      let res;
      if (tab === "url") {
        if (!url.trim()) { setPhase("idle"); return; }
        res = await api.summarize(url.trim());
      } else {
        if (!file) { setPhase("idle"); return; }
        res = await api.summarizeUpload(file);
      }
      if (res.status === "ok") {
        if (res.created === false) {
          setResult({ message: "이미 등록된 문서입니다." });
          setPhase("exists");
        } else {
          setPhase("done");
          onSuccess();
        }
      } else {
        setResult({ message: res.message || "요약에 실패했습니다." });
        setPhase("error");
      }
    } catch (e: unknown) {
      setResult({ message: e instanceof Error ? e.message : "오류가 발생했습니다." });
      setPhase("error");
    }
  };

  const handleFile = (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx" && ext !== "doc") {
      setResult({ message: "PDF 또는 Word(.docx) 파일만 업로드할 수 있습니다." });
      setPhase("error");
      return;
    }
    setFile(f);
    setPhase("idle");
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={phase === "loading" ? undefined : onClose}
    >
      <div
        className="bg-white w-full sm:rounded-2xl sm:max-w-md shadow-xl flex flex-col rounded-t-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">문서 추가</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => { setTab("url"); reset(); }}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === "url" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-400 hover:text-gray-600"}`}
          >
            URL 링크
          </button>
          <button
            onClick={() => { setTab("file"); reset(); }}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === "file" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-400 hover:text-gray-600"}`}
          >
            파일 업로드
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {tab === "url" ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">웹페이지, 뉴스, 유튜브, Google Docs, Google Drive 링크를 붙여넣으세요.</p>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && phase === "idle" && handleSubmit()}
                placeholder="https://..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={phase === "loading"}
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">PDF 또는 Word(.docx) 파일을 올려주세요. (최대 50MB)</p>
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {file ? (
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB · 탭 하여 변경</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-2xl mb-2">📎</p>
                    <p className="text-sm text-gray-500">파일을 끌어다 놓거나 탭하여 선택</p>
                    <p className="text-xs text-gray-400 mt-1">PDF · DOCX</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Result */}
          {phase === "done" && result && (
            <div className="border border-green-200 rounded-xl overflow-hidden">
              <div className="bg-green-50 px-4 py-2.5 flex items-center gap-2 border-b border-green-200">
                <p className="text-xs font-semibold text-green-700">요약 완료</p>
                {result.category && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">{result.category}</span>
                )}
              </div>
              {result.title && (
                <div className="px-4 pt-3 pb-1">
                  <p className="text-sm font-bold text-gray-900">{result.title}</p>
                </div>
              )}
              {result.summary && (
                <div className="px-4 pb-4 pt-2 max-h-80 overflow-y-auto">
                  <SummaryRenderer text={result.summary} />
                </div>
              )}
            </div>
          )}

          {phase === "exists" && result && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-700 mb-1">알림</p>
              <p className="text-xs text-amber-600">{result.message}</p>
            </div>
          )}

          {phase === "error" && result && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-700 mb-1">오류</p>
              <p className="text-xs text-red-600">{result.message}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          {phase === "exists" ? (
            <button
              onClick={onClose}
              className="flex-1 bg-blue-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              닫기
            </button>
          ) : phase === "done" ? (
            <>
              <button
                onClick={() => { setUrl(""); setFile(null); reset(); }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-3 rounded-xl hover:bg-gray-50 transition-colors"
              >
                하나 더 추가
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-blue-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-blue-700 transition-colors"
              >
                닫기
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-3 rounded-xl hover:bg-gray-50 transition-colors"
                disabled={phase === "loading"}
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={phase === "loading" || (tab === "url" ? !url.trim() : !file)}
                className="flex-1 bg-blue-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {phase === "loading" ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    요약 중...
                  </>
                ) : "요약하기"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
