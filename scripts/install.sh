#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Focusmap Agent インストーラ
#
# Usage:
#   curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>
#
# このスクリプトは:
#   1. Node.js (なければHomebrewでインストール)
#   2. @focusmap/agent npm パッケージ
#   3. Playwright + Chromium (ブラウザ自動化用)
#   4. launchd 設定 (Mac mini 起動時に自動起動)
#  を順に設定します。
# ─────────────────────────────────────────────────────────────

set -e

AGENT_TOKEN="${1:-}"
INSTALL_DIR="$HOME/.focusmap"
PLIST_LABEL="com.focusmap-official.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$INSTALL_DIR/logs"

if [ -z "$AGENT_TOKEN" ]; then
  echo "❌ Usage: curl -sSL https://focusmap-official.com/install.sh | sh -s -- <agent_token>"
  exit 1
fi

echo ""
echo "🚀 Focusmap Agent をインストールします"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Node.js 確認
if ! command -v node >/dev/null 2>&1; then
  echo "📦 Node.js が見つかりません。Homebrew経由でインストールします..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "  → Homebrew をインストール..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew install node
else
  echo "✅ Node.js $(node --version)"
fi

# 2. インストールディレクトリ作成
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"

# 3. focusmap-agent パッケージインストール
echo "📦 @focusmap/agent をインストール..."
npm install -g @focusmap/agent || {
  echo "  ⚠️  npm publish前のため、開発版を clone します..."
  if [ ! -d "$INSTALL_DIR/agent" ]; then
    git clone --depth=1 https://github.com/focusmap-official/focusmap-agent "$INSTALL_DIR/agent" 2>/dev/null || {
      echo "  ⚠️  npm package も git repo もまだ公開されていません。"
      echo "      開発中のスクリプトを ~/.focusmap/agent に置いてください。"
    }
  fi
}

# 4. Playwright + Chromium
echo "🌐 Playwright + Chromium をインストール..."
npx playwright install chromium || true

# 5. 設定ファイル作成
cat > "$INSTALL_DIR/config.json" <<EOF
{
  "agent_token": "$AGENT_TOKEN",
  "api_url": "https://focusmap-official.com/api",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname)"
}
EOF
chmod 600 "$INSTALL_DIR/config.json"

# 6. launchd plist 作成
mkdir -p "$HOME/Library/LaunchAgents"
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
    <string>${INSTALL_DIR}/config.json</string>
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

# 7. launchd に登録
if launchctl list | grep -q "${PLIST_LABEL}"; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
launchctl load "$PLIST_PATH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ インストール完了"
echo ""
echo "  ログファイル: ${LOG_DIR}/agent.log"
echo "  設定ファイル: ${INSTALL_DIR}/config.json"
echo ""
echo "  停止: launchctl unload $PLIST_PATH"
echo "  起動: launchctl load   $PLIST_PATH"
echo ""
echo "Web画面に戻ると数十秒以内に「オンライン」表示に変わります。"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
