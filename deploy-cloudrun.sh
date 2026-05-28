#!/bin/bash
set -euo pipefail

# ==========================================
# Cloud Run デプロイスクリプト
# ==========================================

# 設定
PROJECT_ID="shikumika-app"
SERVICE_NAME="shikumika-app"
REGION="asia-northeast1"  # 東京リージョン
PUBLIC_URL="https://focusmap-official.com"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"
IMAGE_URI="${IMAGE_NAME}:${IMAGE_TAG}"
ENV_FILE=".env.local"

require_clean_main() {
  local current_branch
  current_branch="$(git branch --show-current)"

  if [[ "${ALLOW_NON_MAIN_DEPLOY:-}" != "1" && "${current_branch}" != "main" ]]; then
    echo "❌ 本番デプロイは main ブランチからのみ実行できます。"
    echo "現在のブランチ: ${current_branch:-detached HEAD}"
    echo ""
    echo "手順:"
    echo "  1. 変更をコミット"
    echo "  2. main に fast-forward/merge"
    echo "  3. origin/main に push（GitHub Actions が自動デプロイ）"
    echo ""
    echo "緊急時だけ ALLOW_NON_MAIN_DEPLOY=1 ./deploy-cloudrun.sh で上書きできます。"
    exit 1
  fi

  if [[ -n "$(git status --porcelain --untracked-files=all)" && "${ALLOW_DIRTY_DEPLOY:-}" != "1" ]]; then
    echo "❌ 未コミットの変更があるため、本番デプロイを中止します。"
    echo "先に commit するか、不要な変更を退避してください。"
    echo ""
    git status --short
    echo ""
    echo "緊急時だけ ALLOW_DIRTY_DEPLOY=1 ./deploy-cloudrun.sh で上書きできます。"
    exit 1
  fi

  git fetch --quiet origin main
  local head_sha origin_main_sha
  head_sha="$(git rev-parse HEAD)"
  origin_main_sha="$(git rev-parse origin/main)"

  if [[ "${ALLOW_UNPUSHED_DEPLOY:-}" != "1" && "${head_sha}" != "${origin_main_sha}" ]]; then
    echo "❌ ローカルHEADが origin/main と一致しないため、本番デプロイを中止します。"
    echo "local HEAD : ${head_sha}"
    echo "origin/main: ${origin_main_sha}"
    echo ""
    echo "先に git push origin main を実行し、GitHub Actions の自動デプロイを使ってください。"
    echo "緊急時だけ ALLOW_UNPUSHED_DEPLOY=1 ./deploy-cloudrun.sh で上書きできます。"
    exit 1
  fi
}

echo "🚀 Cloud Run デプロイを開始します..."
echo "プロジェクト: ${PROJECT_ID}"
echo "サービス: ${SERVICE_NAME}"
echo "リージョン: ${REGION}"
echo "URL: ${PUBLIC_URL}"
echo "イメージ: ${IMAGE_URI}"
echo "コミット: $(git rev-parse HEAD)"
echo "ブランチ: $(git branch --show-current || true)"
echo ""

require_clean_main

# 1. プロジェクトIDを設定
echo "📝 GCP プロジェクトを設定中..."
gcloud config set project ${PROJECT_ID}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌ ${ENV_FILE} が見つかりません"
  exit 1
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

SUPABASE_URL="$(read_env NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_KEY="$(read_env NEXT_PUBLIC_SUPABASE_ANON_KEY)"

RUNTIME_ENV_FILE="$(mktemp)"
trap 'rm -f "${RUNTIME_ENV_FILE}"' EXIT

node - "${ENV_FILE}" "${PUBLIC_URL}" "${RUNTIME_ENV_FILE}" <<'NODE'
const fs = require('fs');

const [, , envFile, publicUrl, outputFile] = process.argv;
const env = {};

for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || /^\s*#/.test(line)) continue;
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;

  const key = match[1];
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (key === 'NEXTAUTH_URL' || key === 'GOOGLE_REDIRECT_URI') continue;
  if ([
    'EXTERNAL_AI_API_KEY',
    'EXTERNAL_AI_API_BASE_URL',
    'EXTERNAL_AI_MODEL',
    'EXTERNAL_AI_DISABLE_THINKING',
    'OPENCODE_GO_API_KEY',
    'MOONSHOT_API_KEY',
  ].includes(key)) continue;
  env[key] = value;
}

env.NEXTAUTH_URL = publicUrl;
env.GOOGLE_REDIRECT_URI = `${publicUrl}/api/calendar/callback`;
env.NEXT_PUBLIC_SITE_URL = publicUrl;

fs.writeFileSync(outputFile, JSON.stringify(env, null, 2));
NODE

# 2. Cloud Build で Docker イメージをビルドして Artifact Registry に保存
echo "🔨 Cloud Build で Docker イメージをビルド中..."
gcloud builds submit \
  --config=cloudbuild.yaml \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --substitutions="_IMAGE=${IMAGE_URI},_NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_KEY},_NEXT_PUBLIC_SITE_URL=${PUBLIC_URL}"

# 3. Cloud Run にデプロイ
echo "🚢 Cloud Run にデプロイ中..."
gcloud run deploy ${SERVICE_NAME} \
  --image "${IMAGE_URI}" \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --cpu-throttling \
  --no-cpu-boost \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 20 \
  --timeout 300s \
  --port 3000 \
  --env-vars-file "${RUNTIME_ENV_FILE}"

echo ""
echo "✅ デプロイが完了しました！"
echo ""
echo "📋 次のステップ:"
echo "1. デプロイされた URL を確認:"
echo "   gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)'"
echo ""
echo "2. 独自ドメインのマッピングを確認:"
echo "   gcloud beta run domain-mappings describe --domain focusmap-official.com --region ${REGION}"
echo ""
echo "3. ログを確認:"
echo "   gcloud run logs read ${SERVICE_NAME} --region ${REGION}"
