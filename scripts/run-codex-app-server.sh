#!/bin/bash
# launchd から呼ばれる codex app-server 起動スクリプト
# - PATH に npm-global を含めて最新 codex を使う
# - localhost のみバインド（外部公開しない）
# - features.remote_control = true を強制

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

# ANTHROPIC 系の env が混ざらないように
unset ANTHROPIC_API_KEY
unset CLAUDECODE

# remote_control 機能を有効化（既に config.toml にあるが冗長で）
exec codex app-server \
  --listen "ws://127.0.0.1:7878" \
  --enable remote_control
