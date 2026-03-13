"use client";

import { useState, useRef, useEffect } from "react";
import { api, Category } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

const CATEGORIES: { label: string; value: Category | undefined }[] = [
  { label: "전체", value: undefined },
  { label: "AI/LLM", value: "AI/LLM" },
  { label: "Infra", value: "Infra" },
  { label: "DB", value: "DB" },
  { label: "Product", value: "Product" },
  { label: "Business", value: "Business" },
  { label: "Financial", value: "Financial" },
];

const EXAMPLES = [
  "RAG 구현 시 고려할 벡터 DB 옵션은?",
  "LLM 파인튜닝과 RAG 중 어떤 상황에 무엇을 쓸까?",
  "MLOps 파이프라인 구성 시 주요 고려사항은?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<Category | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (query?: string) => {
    const q = (query ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);
    try {
      const result = await api.ask(q, 6, category);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.answer, sources: result.sources },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ RAG 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인해주세요." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-88px)]">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">카테고리 필터</p>
          <div className="flex flex-col gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => setCategory(c.value)}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  category === c.value
                    ? "bg-blue-600 text-white font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {messages.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">예시 질문</p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="text-left text-xs text-gray-500 hover:text-blue-600 leading-relaxed hover:underline transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="text-sm font-semibold text-gray-700">AI Knowledge 챗봇</span>
          {category && (
            <span className="ml-auto text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-medium">
              {category}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="text-5xl">🤖</div>
              <p className="text-gray-700 font-semibold">무엇이 궁금하신가요?</p>
              <p className="text-gray-400 text-sm max-w-sm">
                저장된 AI 기술 문서를 기반으로 실무 관점의 답변을 드립니다.
                왼쪽 예시 질문을 클릭하거나 직접 입력해보세요.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs mr-2 mt-1 shrink-0">
                  AI
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-gray-50 border border-gray-100 text-gray-800 rounded-tl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-semibold text-gray-400 mb-1.5">참고 문서</p>
                    {msg.sources.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-500 hover:underline truncate"
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs mr-2 shrink-0">
                AI
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="질문을 입력하세요..."
              disabled={loading}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 transition-colors"
            >
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
