#!/bin/bash
# Start Focusmap locally and expose it through a temporary phone preview URL.

set -euo pipefail

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${FOCUSMAP_PHONE_PORT:-3001}"
TUNNEL="${FOCUSMAP_PHONE_TUNNEL:-cloudflare}"
DEV_PID=""

cleanup() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

is_port_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

check_tunnel_command() {
  case "$TUNNEL" in
    cloudflare)
      if ! command -v cloudflared >/dev/null 2>&1; then
        cat >&2 <<'EOF'
cloudflared is not installed.

Install it once:
  brew install cloudflared

Then run:
  npm run dev:phone
EOF
        exit 127
      fi
      ;;
    ngrok)
      if ! command -v ngrok >/dev/null 2>&1; then
        cat >&2 <<'EOF'
ngrok is not installed.

Install and authenticate ngrok first, then run:
  FOCUSMAP_PHONE_TUNNEL=ngrok npm run dev:phone
EOF
        exit 127
      fi
      ;;
    *)
      echo "Unsupported FOCUSMAP_PHONE_TUNNEL: $TUNNEL" >&2
      echo "Supported values: cloudflare, ngrok" >&2
      exit 2
      ;;
  esac
}

wait_for_dev_server() {
  local attempts=60
  until curl -fsS "http://localhost:$PORT" >/dev/null 2>&1; do
    attempts=$((attempts - 1))
    if [ "$attempts" -le 0 ]; then
      echo "Focusmap dev server did not start on port $PORT." >&2
      exit 1
    fi
    sleep 1
  done
}

check_tunnel_command

if is_port_listening; then
  echo "Using existing Focusmap dev server on http://localhost:$PORT"
else
  echo "Starting Focusmap dev server on http://localhost:$PORT"
  if [ ! -x "./node_modules/.bin/next" ]; then
    echo "Next.js is not installed locally. Run npm install first." >&2
    exit 1
  fi

  if [ -n "${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="$NODE_OPTIONS --max-http-header-size=65536"
  else
    export NODE_OPTIONS="--max-http-header-size=65536"
  fi

  ./node_modules/.bin/next dev -H 0.0.0.0 -p "$PORT" &
  DEV_PID="$!"
  wait_for_dev_server
fi

case "$TUNNEL" in
  cloudflare)
    echo ""
    echo "Opening a temporary phone preview URL."
    echo "Open the https://*.trycloudflare.com/dashboard?desktop=1&view=map URL on your phone for the PC dashboard."
    exec cloudflared tunnel --url "http://localhost:$PORT"
    ;;
  ngrok)
    echo ""
    echo "Opening a temporary ngrok phone preview URL."
    exec ngrok http "$PORT"
    ;;
  *)
    echo "Unsupported FOCUSMAP_PHONE_TUNNEL: $TUNNEL" >&2
    echo "Supported values: cloudflare, ngrok" >&2
    exit 2
    ;;
esac
