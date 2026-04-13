#!/bin/bash
# launchd から呼ばれるラッパー（PATH を確保）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "/Users/kitamuranaohiro/Private/P dev/focusmap"
exec /usr/local/bin/npx ts-node --esm scripts/task-runner.ts
