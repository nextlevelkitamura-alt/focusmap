#!/bin/bash
# Manage a detached phone preview session for Codex/remote operation.

set -euo pipefail

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${FOCUSMAP_PHONE_SESSION:-focusmap-phone}"
LOG_FILE="${FOCUSMAP_PHONE_LOG:-/tmp/focusmap-phone-preview.log}"

extract_url() {
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com|https://[^[:space:]]*ngrok[^[:space:]]*' "$LOG_FILE" 2>/dev/null | tail -n 1 || true
}

desktop_dashboard_url() {
  local url="${1%/}"
  echo "$url/dashboard?desktop=1&view=map"
}

case "${1:-start}" in
  start)
    if ! command -v tmux >/dev/null 2>&1; then
      echo "tmux is required for detached phone preview sessions." >&2
      exit 127
    fi

    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
    : > "$LOG_FILE"
    tmux new-session -d -s "$SESSION" -c "$ROOT_DIR" "scripts/phone-preview.sh 2>&1 | tee $LOG_FILE"

    for _ in $(seq 1 45); do
      url="$(extract_url)"
      if [ -n "$url" ]; then
        desktop_dashboard_url "$url"
        exit 0
      fi
      sleep 1
    done

    echo "Phone preview session started, but no URL appeared yet." >&2
    echo "Check status with: npm run dev:phone:status" >&2
    exit 1
    ;;
  status)
    if tmux has-session -t "$SESSION" >/dev/null 2>&1; then
      echo "Phone preview session is running: $SESSION"
    else
      echo "Phone preview session is not running: $SESSION"
    fi

    url="$(extract_url)"
    if [ -n "$url" ]; then
      desktop_dashboard_url "$url"
    fi
    ;;
  stop)
    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
    echo "Stopped phone preview session: $SESSION"
    ;;
  logs)
    tail -n 80 "$LOG_FILE"
    ;;
  *)
    echo "Usage: $0 [start|status|stop|logs]" >&2
    exit 2
    ;;
esac
