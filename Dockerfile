# ==========================================
# Multi-stage Dockerfile for Cloud Run
# ==========================================

# ビルドステージ
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm ci

# アプリケーションのコピー
COPY . .

# Next.js のビルド（standalone モード）
# 環境変数はランタイムに設定するため、ビルド時にはダミー値を設定
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
ENV GOOGLE_CLIENT_ID=placeholder
ENV GOOGLE_CLIENT_SECRET=placeholder
ENV NEXTAUTH_URL=http://placeholder
ENV NEXTAUTH_SECRET=placeholder
ENV NODE_ENV=production

RUN npm run build

# 本番ステージ
FROM node:20-alpine AS runner

WORKDIR /app

# 非 root ユーザーの作成
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 必要なファイルのみコピー
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run はデフォルトで PORT 環境変数を提供
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Next.js standalone サーバーの起動
CMD ["node", "server.js"]
