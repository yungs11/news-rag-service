import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/rag/* 는 nginx에서 직접 rag-service(8003)로 라우팅
};

export default nextConfig;
