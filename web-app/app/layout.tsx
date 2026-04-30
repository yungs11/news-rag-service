import type { Metadata, Viewport } from "next";
import "./globals.css";
import { type ReactNode } from "react";
import HeaderNav from "./components/HeaderNav";
import AuthGuard from "./components/AuthGuard";

export const metadata: Metadata = {
  title: "AI Knowledge Base",
  description: "AI Architect 기술 트렌드 지식베이스",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-[#f5f6fa] text-gray-900 font-sans" suppressHydrationWarning>
        <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm pt-[env(safe-area-inset-top)]">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 py-0 flex items-center justify-between h-14 w-full">
            <HeaderNav />
          </div>
        </header>
        <AuthGuard>
          <main className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</main>
        </AuthGuard>
      </body>
    </html>
  );
}
