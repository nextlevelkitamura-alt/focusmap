# ==========================================
# Multi-stage Dockerfile for Cloud Run
# ==========================================

# ビルドステージ
FROM node:22-alpine AS builder

WORKDIR /app

# 依存関係のインストール（devDependencies含む）
COPY package*.json ./
RUN npm install

# アプリケーションのコピー
COPY . .

# Next.js のビルド（standalone モード）
# NEXT_PUBLIC_* はビルド時にJSへ埋め込まれるため、ビルド引数で渡す
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN node --version && ./node_modules/.bin/next build

# 本番ステージ
FROM node:22-alpine AS runner

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
