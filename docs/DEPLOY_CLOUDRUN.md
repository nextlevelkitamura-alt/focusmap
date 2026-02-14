# Cloud Run デプロイ情報

## 本番環境

| 項目 | 値 |
|---|---|
| **Service URL** | https://shikumika-app-364jgme3ja-an.a.run.app |
| **GCP プロジェクト** | `shikumika-app` (466617344999) |
| **リージョン** | `asia-northeast1` (東京) |
| **Node.js** | 22 (Alpine) |
| **メモリ / CPU** | 512Mi / 1 vCPU |
| **インスタンス** | 0〜10 (min 0 で無料枠最大活用) |

## 外部サービス設定

### Supabase (Authentication → URL Configuration)
- **Site URL**: `https://shikumika-app-364jgme3ja-an.a.run.app`
- **Redirect URLs**: `https://shikumika-app-364jgme3ja-an.a.run.app/**`

### Google Cloud Console (OAuth 2.0 クライアント)
- **承認済みの JavaScript 生成元**: `https://shikumika-app-364jgme3ja-an.a.run.app`
- **承認済みのリダイレクト URI**:
  - `http://localhost:3001/api/calendar/callback` (ローカル開発用)
  - `https://whsjsscgmkkkzgcwxjko.supabase.co/auth/v1/callback` (Supabase Auth用)

---

## デプロイ手順

### 前提条件
- Google Cloud SDK (`gcloud`) インストール済み
- Docker は不要 (Cloud Build がクラウド上でビルド)

### ワンコマンドデプロイ

```bash
# 1. ビルド (Cloud Build)
cd /path/to/shikumika-app

SUPABASE_URL=$(grep 'NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d'"' -f2)
SUPABASE_KEY=$(grep 'NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d'"' -f2)

gcloud builds submit \
  --config=cloudbuild.yaml \
  --region=asia-northeast1 \
  --project=shikumika-app \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL,_NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_KEY"

# 2. デプロイ (Cloud Run)
SERVICE_URL="https://shikumika-app-364jgme3ja-an.a.run.app"
ENV_VARS=$(grep -v '^#' .env.local | grep -v '^$' | grep '=' | \
  sed "s|GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=$SERVICE_URL/api/calendar/callback|" | \
  sed "s|NEXTAUTH_URL=.*|NEXTAUTH_URL=$SERVICE_URL|" | \
  while IFS='=' read -r key value; do echo -n "$key=$value,"; done | sed 's/,$//')

gcloud run deploy shikumika-app \
  --image asia-northeast1-docker.pkg.dev/shikumika-app/cloud-run-source-deploy/shikumika-app:latest \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 10 \
  --timeout 300s --port 3000 \
  --set-env-vars "$ENV_VARS"
```

### 重要: NEXT_PUBLIC_* 変数について
`NEXT_PUBLIC_*` 環境変数は Next.js がビルド時に JS へ埋め込むため、**ランタイムでは上書きできない**。
必ず `cloudbuild.yaml` の `--substitutions` でビルド引数として渡すこと。

---

## 運用コマンド

```bash
# ログ確認
gcloud run logs read shikumika-app --region asia-northeast1

# サービス詳細
gcloud run services describe shikumika-app --region asia-northeast1

# 環境変数確認
gcloud run services describe shikumika-app \
  --region asia-northeast1 \
  --format 'value(spec.template.spec.containers[0].env)'
```

## コスト
無料枠: 月200万リクエスト、360,000 vCPU秒、180,000 GiB秒
