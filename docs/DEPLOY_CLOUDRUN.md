# Cloud Run デプロイ手順

## 前提条件

1. **Google Cloud SDK** がインストールされていること
   ```bash
   gcloud --version
   ```
   未インストールの場合: https://cloud.google.com/sdk/docs/install

2. **Docker** がインストールされていること
   ```bash
   docker --version
   ```

3. **GCP プロジェクト** (`shikumika-app`) へのアクセス権限

## 初回セットアップ

### 1. gcloud の認証

```bash
gcloud auth login
gcloud config set project shikumika-app
```

### 2. 必要な API を有効化

```bash
# Cloud Run API
gcloud services enable run.googleapis.com

# Container Registry API
gcloud services enable containerregistry.googleapis.com

# Cloud Build API（オプション）
gcloud services enable cloudbuild.googleapis.com
```

### 3. Docker の認証

```bash
gcloud auth configure-docker
```

### 4. 環境変数の設定

デプロイ後、以下のコマンドで環境変数を設定します:

```bash
# Supabase
gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars NEXT_PUBLIC_SUPABASE_URL=your_supabase_url

gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Calendar API
gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars GOOGLE_CLIENT_ID=your_client_id

gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars GOOGLE_CLIENT_SECRET=your_client_secret

gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars GOOGLE_REDIRECT_URI=https://your-service-url.run.app/api/calendar/callback

# NextAuth
gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars NEXTAUTH_URL=https://your-service-url.run.app

gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars NEXTAUTH_SECRET=your_nextauth_secret
```

または、一括設定:

```bash
gcloud run services update shikumika-app \
  --region asia-northeast1 \
  --update-env-vars \
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url,\
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key,\
GOOGLE_CLIENT_ID=your_client_id,\
GOOGLE_CLIENT_SECRET=your_client_secret,\
GOOGLE_REDIRECT_URI=https://your-service-url.run.app/api/calendar/callback,\
NEXTAUTH_URL=https://your-service-url.run.app,\
NEXTAUTH_SECRET=your_nextauth_secret
```

## デプロイ

### 方法1: npm スクリプト（推奨）

```bash
npm run deploy:cloudrun
```

### 方法2: 直接スクリプト実行

```bash
./deploy-cloudrun.sh
```

## デプロイ後の確認

### サービス URL の取得

```bash
gcloud run services describe shikumika-app \
  --region asia-northeast1 \
  --format 'value(status.url)'
```

### ログの確認

```bash
gcloud run logs read shikumika-app --region asia-northeast1
```

### サービスの詳細確認

```bash
gcloud run services describe shikumika-app --region asia-northeast1
```

## Google OAuth リダイレクト URI の更新

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. `shikumika-app` プロジェクトを選択
3. **API とサービス** → **認証情報** に移動
4. 該当の OAuth 2.0 クライアント ID を選択
5. **承認済みのリダイレクト URI** に以下を追加:
   ```
   https://your-service-url.run.app/api/calendar/callback
   ```

## トラブルシューティング

### ビルドエラー

```bash
# ローカルでビルドテスト
npm run build
```

### Docker イメージのテスト

```bash
# ローカルでイメージをビルド
docker build -t shikumika-app .

# ローカルで実行
docker run -p 3000:3000 shikumika-app
```

### 環境変数の確認

```bash
gcloud run services describe shikumika-app \
  --region asia-northeast1 \
  --format 'value(spec.template.spec.containers[0].env)'
```

## コスト最適化

- **最小インスタンス数**: 0（無料枠を最大活用）
- **最大インスタンス数**: 10（必要に応じて調整）
- **メモリ**: 512Mi（必要に応じて増減）
- **CPU**: 1（必要に応じて増減）
- **タイムアウト**: 300秒

無料枠: 月 200 万リクエスト、360,000 vCPU 秒、180,000 GiB 秒

## 参考リンク

- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Next.js Standalone モード](https://nextjs.org/docs/advanced-features/output-file-tracing)
- [Cloud Run 料金](https://cloud.google.com/run/pricing)
