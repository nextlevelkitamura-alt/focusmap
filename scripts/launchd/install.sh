#!/bin/bash
# 現在のrepo位置に合わせて launchd plist を再生成・インストールする。
#
# 使い方:
#   bash scripts/launchd/install.sh --dry-run   # 生成確認だけ
#   bash scripts/launchd/install.sh core        # Codex app-serverだけ再インストール
#   bash scripts/launchd/install.sh all         # repo内のFocusmap launchdを再インストール
#   bash scripts/launchd/install.sh --unload core

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_VALUE="$(id -u)"
LEGACY_ROOT="${LEGACY_ROOT:-/Users/kitamuranaohiro/Private/focusmap}"

MODE="install"
GROUP="core"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --unload)
      MODE="unload"
      shift
      ;;
    core|all)
      GROUP="$1"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

core_jobs=(
  "com.focusmap.codex-app-server|scripts/com.focusmap.codex-app-server.plist"
)

all_jobs=(
  "${core_jobs[@]}"
  "com.focusmap.task-runner|scripts/com.focusmap.task-runner.plist"
)

if [[ "$GROUP" == "all" ]]; then
  jobs=("${all_jobs[@]}")
else
  jobs=("${core_jobs[@]}")
fi

render_plist() {
  local src="$1"
  local dst="$2"
  sed "s|$LEGACY_ROOT|$REPO_ROOT|g" "$src" > "$dst"
}

lint_plist() {
  local plist="$1"
  plutil -lint "$plist" >/dev/null
}

unload_label() {
  local label="$1"
  launchctl bootout "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
}

install_label() {
  local label="$1"
  local src="$2"
  local dst="$LAUNCH_AGENTS/$label.plist"

  mkdir -p "$LAUNCH_AGENTS"
  mkdir -p "$HOME/.focusmap/logs"
  render_plist "$src" "$dst"
  lint_plist "$dst"

  unload_label "$label"
  launchctl bootstrap "gui/$UID_VALUE" "$dst"
  launchctl enable "gui/$UID_VALUE/$label"
}

echo "repo root: $REPO_ROOT"
echo "mode: $MODE"
echo "group: $GROUP"
echo ""

for entry in "${jobs[@]}"; do
  IFS='|' read -r label rel_path <<< "$entry"
  src="$REPO_ROOT/$rel_path"
  dst="$LAUNCH_AGENTS/$label.plist"

  if [[ ! -f "$src" ]]; then
    echo "skip: $label (source not found: $rel_path)"
    continue
  fi

  case "$MODE" in
    dry-run)
      tmp="$(mktemp)"
      render_plist "$src" "$tmp"
      lint_plist "$tmp"
      rm -f "$tmp"
      echo "ok: $label -> $dst"
      ;;
    unload)
      unload_label "$label"
      echo "unloaded: $label"
      ;;
    install)
      install_label "$label" "$src"
      echo "installed: $label -> $dst"
      ;;
  esac
done
