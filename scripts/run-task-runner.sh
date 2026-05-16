#!/bin/bash
# launchd から呼ばれるラッパー（PATH を確保）
# 注: $HOME/.npm-global/bin を先頭に置く。brew の古い claude (2.1.70) より新しい
# npm global の claude (2.1.142+) を優先するため。Remote Control 機能は 2.1.51+。
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "/Users/kitamuranaohiro/Private/P dev/focusmap"
exec /usr/local/bin/npx ts-node --esm scripts/task-runner.ts
