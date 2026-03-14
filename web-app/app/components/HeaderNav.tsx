"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { getUserId, isAdmin, logout } from "@/lib/auth";

const Logo = () => (
  <Link href="/" className="flex items-center gap-1.5 shrink-0">
    <span className="text-blue-600 text-xl">⬡</span>
    <span className="font-bold text-gray-900 text-sm tracking-tight">AI Knowledge</span>
  </Link>
);

// 문서 — 책 아이콘
const IconDoc = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);

// 챗봇 — 로봇 얼굴
const IconChat = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <rect x="3" y="8" width="18" height="13" rx="2"/>
    <path d="M12 2v6"/>
    <circle cx="12" cy="2" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none"/>
    <path d="M9 18h6"/>
  </svg>
);

// 그래프DB — 노드 3개 연결 네트워크
const IconGraph = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <circle cx="12" cy="4" r="2.5"/>
    <circle cx="4" cy="19" r="2.5"/>
    <circle cx="20" cy="19" r="2.5"/>
    <line x1="11" y1="6.2" x2="5.2" y2="17"/>
    <line x1="13" y1="6.2" x2="18.8" y2="17"/>
    <line x1="6.5" y1="19" x2="17.5" y2="19"/>
  </svg>
);

// 로그아웃
const IconLogout = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

export default function HeaderNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setUserId(getUserId());
    setAdmin(isAdmin());
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  if (!mounted || !userId) {
    return (
      <div className="w-full flex items-center justify-between">
        <Logo />
        <Link
          href="/login"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          로그인
        </Link>
      </div>
    );
  }

  const navLinkClass = "flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors";

  return (
    <div className="w-full flex items-center justify-between">
      {/* 로고 + 데스크탑 네비게이션 */}
      <div className="flex items-center gap-6">
        <Logo />
        <nav className="hidden sm:flex items-center gap-1">
          <Link href="/" className={navLinkClass}>
            <IconDoc />
            <span className="text-sm">문서</span>
          </Link>
          <Link href="/chat" className={navLinkClass}>
            <IconChat />
            <span className="text-sm">챗봇</span>
          </Link>
          {admin && (
            <Link href="/graph" className={navLinkClass}>
              <IconGraph />
              <span className="text-sm">그래프DB</span>
            </Link>
          )}
        </nav>
      </div>

      {/* 오른쪽: 모바일 아이콘 + 데스크탑 인증 */}
      <div className="flex items-center gap-0.5">
        {/* 모바일: 아이콘만 */}
        <div className="flex sm:hidden items-center gap-0.5">
          <Link href="/" className={navLinkClass} title="문서"><IconDoc /></Link>
          <Link href="/chat" className={navLinkClass} title="챗봇"><IconChat /></Link>
          {admin && <Link href="/graph" className={navLinkClass} title="그래프DB"><IconGraph /></Link>}
        </div>

        {/* 데스크탑: 관리자 라벨 + 로그아웃 */}
        <div className="hidden sm:flex items-center gap-1">
          <div className="w-px h-4 bg-gray-200 mx-1" />
          {admin && (
            <span className="text-[11px] font-semibold text-violet-500 mr-1">관리자</span>
          )}
          <button onClick={handleLogout} className={navLinkClass} title="로그아웃">
            <IconLogout />
            <span className="text-sm">로그아웃</span>
          </button>
        </div>

        {/* 모바일: 로그아웃 */}
        <button onClick={handleLogout} className="sm:hidden flex items-center px-2 py-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-red-500 transition-colors" title="로그아웃">
          <IconLogout />
        </button>
      </div>
    </div>
  );
}
