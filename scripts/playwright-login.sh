#!/bin/bash
# Playwright自動ログインスクリプト
# 使い方: ./scripts/playwright-login.sh
# ログインURLを標準出力に出力します。そのURLにPlaywrightでアクセスするとセッション設定→ダッシュボードへ遷移します。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env.local not found" >&2
  exit 1
fi

SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL "$ENV_FILE" | cut -d= -f2 | tr -d '"')
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY "$ENV_FILE" | cut -d= -f2 | tr -d '"')
EMAIL="nextlevel.kitamura@gmail.com"

# 1. マジックリンク生成（redirect_to=localhost）
RESULT=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/admin/generate_link" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"${EMAIL}\",\"redirect_to\":\"http://localhost:3001/login\"}")

ACTION_LINK=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('action_link',''))" 2>/dev/null)

if [ -z "$ACTION_LINK" ]; then
  echo "Error: Failed to generate magic link: $RESULT" >&2
  exit 1
fi

# 2. action_linkをGETしてリダイレクト先のLocation headerを取得（リダイレクト追わない）
LOCATION=$(curl -s --max-redirs 0 -D - -o /dev/null "$ACTION_LINK" 2>/dev/null \
  | grep -i "^[Ll]ocation:" | head -1 | tr -d '\r\n')

LOCATION_URL=$(echo "$LOCATION" | sed 's/^[Ll]ocation: *//')

if [ -z "$LOCATION_URL" ]; then
  echo "Error: No Location header from verify endpoint" >&2
  exit 1
fi

# 3. URLフラグメントからaccess_token, refresh_tokenを抽出
FRAGMENT=$(echo "$LOCATION_URL" | sed 's/.*#//')

ACCESS_TOKEN=$(python3 -c "
import urllib.parse
params = urllib.parse.parse_qs('${FRAGMENT}')
print(params.get('access_token', [''])[0])
" 2>/dev/null)

REFRESH_TOKEN=$(python3 -c "
import urllib.parse
params = urllib.parse.parse_qs('${FRAGMENT}')
print(params.get('refresh_token', [''])[0])
" 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Error: access_token not found in redirect fragment" >&2
  echo "Location: $LOCATION_URL" >&2
  exit 1
fi

# 4. dev-auth経由のログインURLを出力
echo "http://localhost:3001/api/dev-auth?access_token=${ACCESS_TOKEN}&refresh_token=${REFRESH_TOKEN}"
