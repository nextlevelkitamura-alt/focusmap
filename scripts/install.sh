#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Focusmap Agent インストーラ (強化版)
#
# Usage:
#   curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>
#
# 自動セットアップ内容:
#   1. Node.js (Homebrew経由でインストール、無ければ Homebrew も自動導入)
#   2. @focusmap/agent npm パッケージ (or git clone から開発版)
#   3. Playwright + Chromium ブラウザ (失敗時は最大3回リトライ)
#   4. launchd 設定 (Mac mini 起動時に自動起動、 冪等性確保)
#   5. ~/.focusmap/config.json テンプレ生成 (空項目に取得手順URLコメント付き)
# ─────────────────────────────────────────────────────────────

set -e

AGENT_TOKEN="${1:-}"
INSTALL_DIR="$HOME/.focusmap"
PLIST_LABEL="com.focusmap-official.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$INSTALL_DIR/logs"
CONFIG_PATH="$INSTALL_DIR/config.json"

# 色付きログ
log_info() { echo "  → $1"; }
log_ok()   { echo "  ✓ $1"; }
log_warn() { echo "  ⚠ $1"; }
log_err()  { echo "  ✗ $1" >&2; }

if [ -z "$AGENT_TOKEN" ]; then
  log_err "Usage: curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>"
  exit 1
fi

echo ""
echo "🚀 Focusmap Agent をインストールします"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Node.js 確認
echo "[1/5] Node.js を確認..."
if ! command -v node >/dev/null 2>&1; then
  log_warn "Node.js が見つかりません。Homebrew経由でインストールします..."
  if ! command -v brew >/dev/null 2>&1; then
    log_info "Homebrew をインストール..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew install node
  log_ok "Node.js インストール完了"
else
  log_ok "Node.js $(node --version) を検出"
fi

# 2. インストールディレクトリ
echo ""
echo "[2/5] インストールディレクトリ準備..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$INSTALL_DIR/auth"
chmod 700 "$INSTALL_DIR/auth"
log_ok "ディレクトリ $INSTALL_DIR を準備"

# 3. focusmap-agent パッケージ
echo ""
echo "[3/5] @focusmap/agent をインストール..."
if npm install -g @focusmap/agent 2>/dev/null; then
  log_ok "npm package から導入"
else
  log_warn "npm publish 前のため、開発版を git clone します..."
  if [ ! -d "$INSTALL_DIR/agent" ]; then
    if git clone --depth=1 https://github.com/focusmap-official/focusmap-agent "$INSTALL_DIR/agent" 2>/dev/null; then
      log_ok "git clone 完了"
      (cd "$INSTALL_DIR/agent" && npm install)
    else
      log_warn "npm / git どちらでも導入できませんでした。 開発中のスクリプトを ~/.focusmap/agent に手動配置してください。"
    fi
  fi
fi

# 4. Playwright + Chromium (失敗時リトライ)
echo ""
echo "[4/5] Playwright + Chromium をインストール..."
ATTEMPT=0
MAX_ATTEMPTS=3
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  log_info "試行 $ATTEMPT/$MAX_ATTEMPTS: Chromium ダウンロード中..."
  if npx --yes playwright install chromium 2>&1 | tail -5; then
    log_ok "Playwright + Chromium インストール完了"
    break
  fi
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    log_warn "失敗。 5秒後にリトライ..."
    sleep 5
  else
    log_warn "Chromium インストール失敗 (リトライ上限到達)。 後で `npx playwright install chromium` を手動実行してください。"
  fi
done

# 5. 設定ファイル + launchd
echo ""
echo "[5/5] 設定ファイル生成 + launchd 登録..."

# config.json テンプレ生成 (空項目には取得手順URLをコメント代わりに値で書く)
cat > "$CONFIG_PATH" <<EOF
{
  "_comment": "Focusmap Agent 設定ファイル — 必須項目は Web の Workspace > エージェント画面で確認してください",
  "agent_token": "$AGENT_TOKEN",
  "user_id": "<取得: https://focusmap-official.com/dashboard/workspace/agents>",
  "hostname": "$(hostname)",
  "display_name": "$(hostname) (focusmap-agent)",
  "supabase_url": "<取得: 北村に問い合わせ or .env.local の NEXT_PUBLIC_SUPABASE_URL>",
  "supabase_service_role_key": "<取得: 同上、 SUPABASE_SERVICE_ROLE_KEY>",
  "gemini_api_key": "<取得: https://aistudio.google.com/apikey>",
  "deepseek_api_key": "<取得 (オプション): https://platform.deepseek.com/>",
  "api_url": "https://focusmap-official.com/api",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 600 "$CONFIG_PATH"
log_ok "config.json テンプレを $CONFIG_PATH に生成"

# launchd plist (冪等: 既存があれば unload してから上書き)
mkdir -p "$HOME/Library/LaunchAgents"
if launchctl list 2>/dev/null | grep -q "${PLIST_LABEL}"; then
  log_info "既存の launchd エージェントを停止..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/focusmap-agent</string>
    <string>start</string>
    <string>--config</string>
    <string>${CONFIG_PATH}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/agent.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/agent.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"
log_ok "launchd 登録完了 (起動時に自動実行)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Focusmap Agent インストール完了"
echo ""
echo "  次のステップ:"
echo "    1. $CONFIG_PATH を開いて空項目 (user_id / supabase_url / API keys) を埋める"
echo "    2. 設定後、 launchctl unload \$PLIST_PATH && launchctl load \$PLIST_PATH で再起動"
echo "    3. Web画面 (https://focusmap-official.com/dashboard/workspace/agents) で「オンライン」表示を確認"
echo ""
echo "  ログファイル: ${LOG_DIR}/agent.log"
echo "  停止: launchctl unload $PLIST_PATH"
echo "  起動: launchctl load   $PLIST_PATH"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
