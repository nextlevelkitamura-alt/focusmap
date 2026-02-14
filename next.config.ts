import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  // Cloud Run デプロイ用の設定
  output: 'standalone',
};

export default nextConfig;
