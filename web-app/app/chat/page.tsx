"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { api, Category } from "@/lib/api";
import {
  ChatSession,
  StoredMessage,
  getSessions,
  createSession,
  getSessionWithMessages,
  appendMessages,
  deleteSession,
  formatDate,
} from "@/lib/chat-history";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message extends StoredMessage {}

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
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<Category | undefined>();
  const [showSidebar, setShowSidebar] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    const list = await getSessions();
    setSessions(list);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectSession = useCallback(async (sessionId: string) => {
    const data = await getSessionWithMessages(sessionId);
    if (!data) return;
    setCurrentSessionId(sessionId);
    setMessages(data.messages);
    setCategory((data.category as Category) ?? undefined);
    setShowSidebar(false);
  }, []);

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setInput("");
    setShowSidebar(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      await deleteSession(sessionId);
      if (currentSessionId === sessionId) newChat();
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    },
    [currentSessionId, newChat]
  );

  const send = async (query?: string) => {
    const q = (query ?? input).trim();
    if (!q || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: q };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    let sessionId = currentSessionId;
    if (!sessionId) {
      const session = await createSession(q, category);
      sessionId = session.id;
      setCurrentSessionId(sessionId);
      setSessions((prev) => [session, ...prev]);
    }

    try {
      const result = await api.ask(q, 6, category);
      const aiMsg: Message = {
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      };
      const finalMessages = [...nextMessages, aiMsg];
      setMessages(finalMessages);
      await appendMessages(sessionId, [userMsg, aiMsg]);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, message_count: finalMessages.length, updated_at: new Date().toISOString() }
            : s
        )
      );
    } catch {
      const errMsg: Message = {
        role: "assistant",
        content: "⚠️ RAG 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인해주세요.",
      };
      setMessages([...nextMessages, errMsg]);
      await appendMessages(sessionId, [userMsg, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-4 h-[calc(100dvh-64px)] sm:h-[calc(100vh-88px)] -mx-6 sm:mx-0 px-0 sm:px-0">

      {/* ── Mobile top bar ── */}
      <div className="sm:hidden fixed top-14 left-0 right-0 z-30 bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => setShowSidebar(true)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="대화 목록"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex-1 overflow-x-auto flex gap-1.5 scrollbar-none">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              onClick={() => setCategory(c.value)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                category === c.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={newChat}
          className="shrink-0 p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="새 대화"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* ── Mobile sidebar drawer ── */}
      {showSidebar && (
        <div className="sm:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSidebar(false)} />
          <div className="relative w-72 bg-white h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-bold text-gray-900">대화 내역</span>
              <button onClick={() => setShowSidebar(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <button
              onClick={newChat}
              className="mx-3 mt-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              + 새 대화
            </button>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {sessions.length === 0 ? (
                <p className="text-xs text-gray-300 text-center mt-8">저장된 대화가 없습니다.</p>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                    className={`group flex items-start gap-1 p-3 rounded-xl cursor-pointer transition-colors ${
                      currentSessionId === s.id ? "bg-blue-50 border border-blue-100" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate leading-snug">{s.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(s.updated_at)} · {s.message_count}개</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, s.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-sm shrink-0 mt-0.5 p-1"
                    >✕</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <aside className="hidden sm:flex w-56 shrink-0 flex-col gap-3">
        <button
          onClick={newChat}
          className="w-full py-2 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + 새 대화
        </button>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">카테고리</p>
          <div className="flex flex-col gap-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => setCategory(c.value)}
                className={`text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex-1 overflow-hidden flex flex-col">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">대화 내역</p>
          {sessions.length === 0 ? (
            <p className="text-xs text-gray-300 text-center mt-4">저장된 대화가 없습니다.</p>
          ) : (
            <div className="overflow-y-auto flex-1 -mr-1 pr-1 space-y-1">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={`group flex items-start gap-1 p-2 rounded-lg cursor-pointer transition-colors ${
                    currentSessionId === s.id ? "bg-blue-50 border border-blue-100" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate leading-snug">{s.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(s.updated_at)} · {s.message_count}개</p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, s.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xs shrink-0 mt-0.5"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col bg-white sm:rounded-xl sm:border sm:border-gray-100 sm:shadow-sm overflow-hidden mt-0 sm:mt-0 pt-[52px] sm:pt-0">

        {/* Desktop header */}
        <div className="hidden sm:flex px-5 py-3.5 border-b border-gray-100 items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="text-sm font-semibold text-gray-700">AI Knowledge 챗봇</span>
          {category && (
            <span className="ml-auto text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-medium">{category}</span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
              <div className="text-5xl">🤖</div>
              <p className="text-gray-700 font-semibold">무엇이 궁금하신가요?</p>
              <p className="text-gray-400 text-sm max-w-xs">저장된 AI 기술 문서를 기반으로 실무 관점의 답변을 드립니다.</p>
              <div className="flex flex-col gap-2 mt-2 w-full max-w-sm px-4">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="text-left text-xs text-gray-500 hover:text-blue-600 leading-relaxed hover:underline transition-colors bg-gray-50 rounded-xl px-4 py-3"
                  >
                    {ex}
                  </button>
                ))}
              </div>
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
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-gray-50 border border-gray-100 text-gray-800 rounded-tl-sm"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-sm prose-gray max-w-none
                    prose-p:my-1 prose-p:leading-relaxed
                    prose-headings:font-bold prose-headings:my-2
                    prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
                    prose-ul:my-1 prose-ul:pl-4 prose-ol:my-1 prose-ol:pl-4
                    prose-li:my-0.5
                    prose-strong:font-semibold
                    prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-code:text-xs prose-code:font-mono
                    prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:rounded-lg prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto
                    prose-blockquote:border-l-2 prose-blockquote:border-blue-300 prose-blockquote:pl-3 prose-blockquote:text-gray-600
                    prose-hr:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
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
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs mr-2 shrink-0">AI</div>
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
        <div className="p-3 sm:p-4 border-t border-gray-100 bg-white">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="질문을 입력하세요..."
              disabled={loading}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 min-w-0"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="shrink-0 bg-blue-600 text-white px-4 sm:px-5 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 transition-colors"
            >
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
