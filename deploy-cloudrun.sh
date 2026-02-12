#!/bin/bash
set -e

# ==========================================
# Cloud Run デプロイスクリプト
# ==========================================

# 設定
PROJECT_ID="shikumika-app"
SERVICE_NAME="shikumika-app"
REGION="asia-northeast1"  # 東京リージョン
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Cloud Run デプロイを開始します..."
echo "プロジェクト: ${PROJECT_ID}"
echo "サービス: ${SERVICE_NAME}"
echo "リージョン: ${REGION}"
echo ""

# 1. プロジェクトIDを設定
echo "📝 GCP プロジェクトを設定中..."
gcloud config set project ${PROJECT_ID}

# 2. Docker イメージをビルド
echo "🔨 Docker イメージをビルド中..."
docker build -t ${IMAGE_NAME}:latest .

# 3. Container Registry にプッシュ
echo "📦 Docker イメージを Container Registry にプッシュ中..."
docker push ${IMAGE_NAME}:latest

# 4. Cloud Run にデプロイ
echo "🚢 Cloud Run にデプロイ中..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300s \
  --port 3000

echo ""
echo "✅ デプロイが完了しました！"
echo ""
echo "📋 次のステップ:"
echo "1. デプロイされた URL を確認:"
echo "   gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)'"
echo ""
echo "2. 環境変数を設定:"
echo "   gcloud run services update ${SERVICE_NAME} --region ${REGION} --update-env-vars KEY=VALUE"
echo ""
echo "3. ログを確認:"
echo "   gcloud run logs read ${SERVICE_NAME} --region ${REGION}"
