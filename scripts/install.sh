#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Focusmap Agent インストーラ (強化版)
#
# Usage:
#   curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>
#
# 自動セットアップ内容:
#   1. Node.js (Homebrew経由でインストール、無ければ Homebrew も自動導入)
#   2. @focusmap/agent npm パッケージ (or focusmap-official.com から同梱版)
#   3. Google Workspace CLI (gws)
#   4. Playwright + Chromium ブラウザ (失敗時は最大3回リトライ)
#   5. launchd 設定 (Mac mini 起動時に自動起動、 冪等性確保)
#   6. ~/.focusmap/config.json 生成 (agent_token のみ。service role key はMacへ置かない)
# ─────────────────────────────────────────────────────────────

set -e

AGENT_TOKEN="${1:-}"
INSTALL_DIR="$HOME/.focusmap"
PLIST_LABEL="com.focusmap-official.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$INSTALL_DIR/logs"
CONFIG_PATH="$INSTALL_DIR/config.json"
APP_ORIGIN="${FOCUSMAP_APP_ORIGIN:-https://focusmap-official.com}"
AGENT_ARCHIVE_URL="${FOCUSMAP_AGENT_ARCHIVE_URL:-${APP_ORIGIN}/focusmap-agent.tar.gz}"
AGENT_BIN=""
AGENT_NODE_SCRIPT=""

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
mkdir -p "$INSTALL_DIR/browser-profile"
chmod 700 "$INSTALL_DIR/auth"
chmod 700 "$INSTALL_DIR/browser-profile"
log_ok "ディレクトリ $INSTALL_DIR を準備"

# 3. focusmap-agent パッケージ
echo ""
echo "[3/5] @focusmap/agent をインストール..."
if npm install -g @focusmap/agent 2>/dev/null; then
  log_ok "npm package から導入"
  AGENT_BIN="$(command -v focusmap-agent || true)"
else
  log_warn "npm publish 前のため、Webアプリ同梱版をダウンロードします..."
  rm -rf "$INSTALL_DIR/agent"
  mkdir -p "$INSTALL_DIR/agent"
  if curl -fsSL "$AGENT_ARCHIVE_URL" -o "$INSTALL_DIR/focusmap-agent.tar.gz"; then
    tar -xzf "$INSTALL_DIR/focusmap-agent.tar.gz" -C "$INSTALL_DIR/agent" --strip-components=1
    (cd "$INSTALL_DIR/agent" && npm install && npm run build)
    AGENT_BIN="/usr/bin/env"
    AGENT_NODE_SCRIPT="$INSTALL_DIR/agent/dist/cli.js"
    log_ok "同梱版エージェントを $INSTALL_DIR/agent に導入"
  else
    log_err "エージェント同梱版をダウンロードできませんでした: $AGENT_ARCHIVE_URL"
    exit 1
  fi
fi

if [ -z "$AGENT_BIN" ]; then
  AGENT_BIN="$(command -v focusmap-agent || true)"
fi

if [ -z "$AGENT_BIN" ] && [ -f "$INSTALL_DIR/agent/dist/cli.js" ]; then
  AGENT_BIN="/usr/bin/env"
  AGENT_NODE_SCRIPT="$INSTALL_DIR/agent/dist/cli.js"
fi

if [ -z "$AGENT_BIN" ]; then
  log_err "focusmap-agent の実行ファイルが見つかりませんでした"
  exit 1
fi

# 4. Google Workspace CLI (gws)
echo ""
echo "[4/6] Google Workspace CLI (gws) を確認..."
if command -v gws >/dev/null 2>&1; then
  log_ok "gws $(gws --version 2>/dev/null | head -1) を検出"
elif npm install -g @googleworkspace/cli 2>/dev/null; then
  log_ok "Google Workspace CLI を導入"
else
  log_warn "gws を自動導入できませんでした。後で `npm install -g @googleworkspace/cli` を実行してください。"
fi

# 5. Playwright + Chromium (失敗時リトライ)
echo ""
echo "[5/6] Playwright + Chromium をインストール..."
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

# 6. 設定ファイル + launchd
echo ""
echo "[6/6] 設定ファイル生成 + launchd 登録..."

# config.json 生成
cat > "$CONFIG_PATH" <<EOF
{
  "agent_token": "$AGENT_TOKEN",
  "hostname": "$(hostname)",
  "display_name": "$(hostname) (focusmap-agent)",
  "api_url": "https://focusmap-official.com/api",
  "shell_enabled": true,
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 600 "$CONFIG_PATH"
log_ok "config.json を $CONFIG_PATH に生成"

# launchd plist (冪等: 既存があれば unload してから上書き)
mkdir -p "$HOME/Library/LaunchAgents"
if launchctl list 2>/dev/null | grep -q "${PLIST_LABEL}"; then
  log_info "既存の launchd エージェントを停止..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

if [ -n "$AGENT_NODE_SCRIPT" ]; then
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${AGENT_BIN}</string>
    <string>node</string>
    <string>${AGENT_NODE_SCRIPT}</string>
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
else
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${AGENT_BIN}</string>
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
fi

launchctl load "$PLIST_PATH"
log_ok "launchd 登録完了 (起動時に自動実行)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Focusmap Agent インストール完了"
echo ""
echo "  次のステップ:"
echo "    1. Web画面 (https://focusmap-official.com/dashboard/settings/automation) で「オンライン」表示を確認"
echo "    2. Google Workspace / ブラウザ認証が必要な場合はWeb画面の案内に従ってください"
echo "    3. shell_enabled を false にするとターミナル実行を無効化できます"
echo ""
echo "  ログファイル: ${LOG_DIR}/agent.log"
echo "  停止: launchctl unload $PLIST_PATH"
echo "  起動: launchctl load   $PLIST_PATH"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
