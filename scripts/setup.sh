#!/bin/bash
#
# Focusmap ワンクリックセットアップ
#
# 使い方:
#   ターミナルを開いて以下を貼り付けてください:
#   cd path/to/focusmap && bash scripts/setup.sh
#

set -e

# ─── 色 ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}\n"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BOLD}→${NC} $1"; }

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║     Focusmap セットアップ          ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# ─── Step 1: 前提チェック ─────────────────────────────────────────
step "Step 1/5: 前提ソフトのチェック"

MISSING=0

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  ok "Node.js: $NODE_VER"
else
  fail "Node.js が見つかりません"
  echo ""
  echo "  インストール方法:"
  echo "    1. https://nodejs.org を開く"
  echo "    2. 「LTS」の緑のボタンをクリックしてダウンロード"
  echo "    3. ダウンロードしたファイルを開いてインストール"
  echo "    4. ターミナルを閉じて開き直す"
  echo "    5. もう一度このスクリプトを実行"
  echo ""
  MISSING=1
fi

# Git
if command -v git &>/dev/null; then
  ok "Git: $(git --version | cut -d' ' -f3)"
else
  fail "Git が見つかりません"
  echo "  Xcode Command Line Tools をインストールしてください:"
  echo "    xcode-select --install"
  MISSING=1
fi

# Claude Code
if command -v claude &>/dev/null; then
  ok "Claude Code: インストール済み"
  CLAUDE_INSTALLED=1
else
  warn "Claude Code: 未インストール（推奨）"
  CLAUDE_INSTALLED=0
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  fail "必要なソフトが不足しています。上の手順でインストールしてからもう一度実行してください。"
  exit 1
fi

# ─── Step 2: 依存パッケージ ───────────────────────────────────────
step "Step 2/5: パッケージのインストール"

if [ -d "node_modules" ]; then
  ok "node_modules は既に存在します"
else
  info "npm install を実行中..."
  npm install
  ok "パッケージのインストール完了"
fi

# ─── Step 3: 環境変数 ─────────────────────────────────────────────
step "Step 3/5: 設定ファイル (.env.local)"

if [ -f ".env.local" ]; then
  ok ".env.local は既に存在します"
else
  if [ -f ".env.example" ]; then
    cp .env.example .env.local
    warn ".env.example をコピーして .env.local を作成しました"
  else
    touch .env.local
    warn ".env.local を新規作成しました"
  fi
  echo ""
  echo "  ${YELLOW}設定が必要です:${NC}"
  echo "    1. https://supabase.com/dashboard を開く"
  echo "    2. プロジェクトを選択 → Settings → API"
  echo "    3. 以下の値を .env.local に追記:"
  echo ""
  echo '    NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"'
  echo '    NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."'
  echo '    SUPABASE_SERVICE_ROLE_KEY="eyJ..."'
  echo ""
  echo "  設定後にもう一度このスクリプトを実行してください。"
  echo ""

  read -p "  .env.local を今すぐ編集しますか？ (y/n): " EDIT_ENV
  if [ "$EDIT_ENV" = "y" ]; then
    if command -v code &>/dev/null; then
      code .env.local
    elif command -v nano &>/dev/null; then
      nano .env.local
    else
      open -e .env.local
    fi
    echo ""
    read -p "  編集が完了したら Enter を押してください..."
  fi
fi

# .env.local の必須キーを確認
if grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local 2>/dev/null; then
  ok "Supabase URL: 設定済み"
else
  warn "NEXT_PUBLIC_SUPABASE_URL が未設定です"
fi

# ─── Step 4: AIスケジュール実行 ───────────────────────────────────
step "Step 4/5: AIスケジュール自動実行（task-runner）"

PLIST_NAME="com.focusmap.task-runner.plist"
PLIST_SRC="scripts/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$PLIST_DST" ]; then
  ok "task-runner は既にインストール済みです"
else
  if [ -f "$PLIST_SRC" ]; then
    # plist 内のパスを現在のプロジェクトディレクトリに合わせる
    sed "s|/Users/kitamuranaohiro/Private/P dev/focusmap|$PROJECT_DIR|g" "$PLIST_SRC" > /tmp/$PLIST_NAME

    # ユーザー名も更新
    CURRENT_USER=$(whoami)
    sed -i '' "s|/Users/kitamuranaohiro|/Users/$CURRENT_USER|g" /tmp/$PLIST_NAME

    cp /tmp/$PLIST_NAME "$PLIST_DST"
    launchctl load "$PLIST_DST" 2>/dev/null || true
    ok "task-runner をインストールしました（毎分実行）"
    info "ログ: tail -f $PROJECT_DIR/scripts/task-runner.log"
  else
    warn "plist ファイルが見つかりません: $PLIST_SRC"
  fi
fi

# ─── Step 5: Claude Code のセットアップ案内 ────────────────────────
step "Step 5/5: Claude Code"

if [ "$CLAUDE_INSTALLED" -eq 1 ]; then
  ok "Claude Code はインストール済みです"
  echo ""
  info "このフォルダで 'claude' と打つと AI アシスタントが使えます"
  info "「/setup」と言うとセットアップを対話的に確認できます"
else
  echo "  Claude Code をインストールすると、AIによるタスク自動実行が使えます。"
  echo ""
  echo "  ${BOLD}インストール手順:${NC}"
  echo ""
  echo "    1. https://claude.ai にアクセスしてアカウント作成"
  echo "    2. Max プランに登録（月額 \$100）"
  echo "    3. ターミナルで以下を実行:"
  echo ""
  echo "       ${GREEN}npm install -g @anthropic-ai/claude-code${NC}"
  echo ""
  echo "    4. インストール後、このフォルダで以下を実行:"
  echo ""
  echo "       ${GREEN}claude${NC}"
  echo ""
  echo "    5. ブラウザが開くのでログイン → 認証完了"
  echo ""

  read -p "  今すぐ Claude Code をインストールしますか？ (y/n): " INSTALL_CLAUDE
  if [ "$INSTALL_CLAUDE" = "y" ]; then
    echo ""
    info "Claude Code をインストール中..."
    npm install -g @anthropic-ai/claude-code
    ok "Claude Code のインストール完了"
    echo ""
    info "初回認証のため 'claude' を実行してください"
    info "ブラウザが開いてログイン画面が表示されます"
  fi
fi

# ─── 完了 ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║     セットアップ完了！             ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"
echo "  使い方:"
echo "    npm run dev          → 開発サーバー起動"
echo "    claude               → AI アシスタント起動"
echo "    claude -p '/claim'   → スキルを直接実行"
echo ""
echo "  ダッシュボード: http://localhost:3000"
echo ""
