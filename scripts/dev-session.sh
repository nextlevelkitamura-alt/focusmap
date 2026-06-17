#!/bin/bash
# Manage a detached local Focusmap dev server on port 3001.

set -euo pipefail

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${FOCUSMAP_DEV_SESSION:-focusmap-dev}"
LOG_FILE="${FOCUSMAP_DEV_LOG:-/tmp/focusmap-dev.log}"
PORT="${FOCUSMAP_DEV_PORT:-3001}"
URL="http://localhost:${PORT}/dashboard"

is_port_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

print_port_owner() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

start_session() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is required for detached dev sessions." >&2
    exit 127
  fi

  if is_port_listening; then
    echo "Focusmap dev server is already listening on http://localhost:$PORT"
    print_port_owner
    echo "$URL"
    exit 0
  fi

  if [ ! -x "$ROOT_DIR/node_modules/.bin/next" ]; then
    echo "Next.js is not installed locally. Run npm install first." >&2
    exit 1
  fi

  tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
  : > "$LOG_FILE"

  tmux new-session -d -s "$SESSION" -c "$ROOT_DIR" \
    "export NODE_OPTIONS=\"\${NODE_OPTIONS:-} --max-http-header-size=65536\"; ./node_modules/.bin/next dev -p $PORT 2>&1 | tee -a \"$LOG_FILE\""

  for _ in $(seq 1 60); do
    if is_port_listening; then
      echo "Focusmap dev server started in tmux session: $SESSION"
      echo "$URL"
      exit 0
    fi
    if ! tmux has-session -t "$SESSION" >/dev/null 2>&1; then
      echo "Focusmap dev server exited before port $PORT started." >&2
      tail -n 80 "$LOG_FILE" >&2 || true
      exit 1
    fi
    sleep 1
  done

  echo "Focusmap dev server did not start on port $PORT." >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
}

case "${1:-start}" in
  start)
    start_session
    ;;
  restart)
    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
    start_session
    ;;
  status)
    if tmux has-session -t "$SESSION" >/dev/null 2>&1; then
      echo "Focusmap dev tmux session is running: $SESSION"
    else
      echo "Focusmap dev tmux session is not running: $SESSION"
    fi

    if is_port_listening; then
      echo "Port $PORT is listening."
      print_port_owner
      echo "$URL"
    else
      echo "Port $PORT is not listening."
    fi
    ;;
  stop)
    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
    echo "Stopped Focusmap dev session: $SESSION"
    ;;
  logs)
    tail -n 120 "$LOG_FILE"
    ;;
  *)
    echo "Usage: $0 [start|restart|status|stop|logs]" >&2
    exit 2
    ;;
esac
