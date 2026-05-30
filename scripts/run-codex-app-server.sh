#!/bin/bash
# launchd から呼ばれる codex app-server 起動スクリプト
# - PATH に npm-global を含めて最新 codex を使う
# - localhost のみバインド（外部公開しない）
# - remote_control は付けない（スマホでホスト重複→スレッド二重表示を防ぐため）

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

# ANTHROPIC 系の env が混ざらないように
unset ANTHROPIC_API_KEY
unset CLAUDECODE

# remote_control は付けない。
#   付けると ChatGPT モバイルに "2台目の naonomac.local ホスト" として登録され、
#   Codex Desktop アプリのホストと同じ state_5.sqlite を合算するため、
#   スマホの「すべて」表示で全スレッドが2回ずつ重複する（2026-05-30 修正）。
#   relay の注入 (initialize/thread/start/turn/start) はこのフラグ無しで動作する。
exec codex app-server \
  --listen "ws://127.0.0.1:7878"
