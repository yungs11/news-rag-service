"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loginAsAdmin, loginAsUser, getUserId } from "@/lib/auth";

const ADMIN_CODE = "000001";

export default function LoginPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 이미 로그인된 경우 메인으로 이동
  useEffect(() => {
    if (getUserId()) router.replace("/");
  }, [router]);

  const handleLogin = async () => {
    const trimmed = otp.trim();
    if (!trimmed) return;

    if (trimmed === ADMIN_CODE) {
      loginAsAdmin();
      router.push("/");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rag/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: trimmed }),
      });
      const data = await res.json();
      if (!data.valid) {
        setError("코드가 올바르지 않거나 만료되었습니다.");
        return;
      }
      loginAsUser(data.user_id);
      router.push("/");
    } catch {
      setError("인증 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-sm p-8 space-y-6">
        <h1 className="text-xl font-bold text-gray-900">로그인</h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          카카오 챗봇에서 <strong className="text-gray-700">웹 로그인</strong>을 입력하면
          6자리 로그인 코드를 받을 수 있습니다.
        </p>
        <div className="space-y-4">
          <input
            value={otp}
            onChange={(e) => { setOtp(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="6자리 코드 입력..."
            maxLength={6}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 tracking-widest text-center text-lg font-mono"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={otp.trim().length < 6 || loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {loading ? "확인 중..." : "로그인"}
          </button>
        </div>
      </div>
    </div>
  );
}
