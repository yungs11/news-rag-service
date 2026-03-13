import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // RAG Service 프록시 (CORS 우회 및 API key 서버사이드 보관)
  async rewrites() {
    return [
      {
        source: "/api/rag/:path*",
        destination: `${process.env.RAG_SERVICE_URL ?? "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
