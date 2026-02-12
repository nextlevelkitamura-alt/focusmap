# ビルドステージ
FROM node:20-alpine AS builder

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm ci

# アプリケーションのコピー
COPY . .

# Next.js のビルド（standalone モード）
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
