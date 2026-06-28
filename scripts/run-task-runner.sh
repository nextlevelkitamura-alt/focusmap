#!/bin/bash
# launchd から呼ばれるラッパー（PATH を確保）
# 注: $HOME/.npm-global/bin を先頭に置く。brew の古い claude (2.1.70) より新しい
# npm global の claude (2.1.142+) を優先するため。Remote Control 機能は 2.1.51+。
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
if [ -x "./node_modules/.bin/tsx" ]; then
  exec ./node_modules/.bin/tsx scripts/task-runner.ts
fi
exec /usr/local/bin/npx --yes tsx scripts/task-runner.ts
