#!/bin/bash
# Focusmap launchd のロード状態とplist参照pathを確認する。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_VALUE="$(id -u)"
LEGACY_ROOT="${LEGACY_ROOT:-/Users/kitamuranaohiro/Private/focusmap}"

labels=(
  "com.focusmap.codex-app-server"
  "com.focusmap.task-runner"
)

path_status() {
  local plist="$1"

  if [[ ! -f "$plist" ]]; then
    echo "-"
  elif grep -q "$REPO_ROOT" "$plist"; then
    echo "current-root"
  elif grep -q "$LEGACY_ROOT" "$plist"; then
    echo "legacy-root"
  elif grep -q "/Users/kitamuranaohiro/Private" "$plist"; then
    echo "other-root"
  else
    echo "no-root"
  fi
}

loaded_status() {
  local label="$1"

  if launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then
    echo "yes"
  else
    echo "no"
  fi
}

echo "repo root: $REPO_ROOT"
echo ""
printf "%-34s %-10s %-10s %s\n" "label" "loaded" "plist" "path"
printf "%-34s %-10s %-10s %s\n" "-----" "------" "-----" "----"

for label in "${labels[@]}"; do
  plist="$LAUNCH_AGENTS/$label.plist"
  if [[ -f "$plist" ]]; then
    plist_exists="yes"
  else
    plist_exists="no"
  fi

  printf "%-34s %-10s %-10s %s\n" \
    "$label" \
    "$(loaded_status "$label")" \
    "$plist_exists" \
    "$(path_status "$plist")"
done
