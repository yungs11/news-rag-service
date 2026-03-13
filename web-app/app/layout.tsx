import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { type ReactNode } from "react";

export const metadata: Metadata = {
  title: "AI Knowledge Base",
  description: "AI Architect 기술 트렌드 지식베이스",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#f5f6fa] text-gray-900 font-sans">
        <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
          <div className="max-w-6xl mx-auto px-6 py-0 flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-blue-600 text-xl">⬡</span>
                <span className="font-bold text-gray-900 text-sm tracking-tight">AI Knowledge</span>
              </Link>
              <nav className="flex items-center gap-1">
                <Link
                  href="/"
                  className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  문서
                </Link>
                <Link
                  href="/chat"
                  className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  챗봇
                </Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
