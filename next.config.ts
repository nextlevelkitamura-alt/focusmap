import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  // Cloud Run デプロイ用の設定
  output: 'standalone',
  // HTTP 431 対策: リクエストヘッダーサイズ制限を緩和
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
