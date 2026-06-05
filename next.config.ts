import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: [
    '127.0.0.1',
    '::1',
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok.app',
    '*.ts.net',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: '/install.sh',
        destination: '/api/downloads/install-sh',
      },
      {
        source: '/focusmap-agent.tar.gz',
        destination: '/api/downloads/focusmap-agent-archive',
      },
    ];
  },
  // Cloud Run デプロイ用の設定
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': [
      './mobile/**/*',
      './.git/**/*',
      './dist-desktop/**/*',
    ],
  },
  // HTTP 431 対策: リクエストヘッダーサイズ制限を緩和
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
