# Codex node check archive request

- ID: TASK-20260610-002
- Started: 2026-06-10
- Completed: 2026-06-10
- Mode: SINGLE_CHAT
- Branch: main

## Goal

ノードのチェックが10秒以上維持された時だけ、FocusmapからMac agentへCodex threadアーカイブ要求を送り、Mac側のCodex app-serverで対象チャットをアーカイブする。

## Implemented

- マップのチェック操作から10秒遅延でアーカイブ要求を保存する。
- チェック解除時は未送信タイマーと保存済み要求をキャンセル扱いにする。
- `/api/agents/codex-monitor/tasks` は、completed taskでも pending archive request かつ元ノードがdoneの場合だけMac agentへ返す。
- Mac agentのCodex監視ループが pending request を検出し、`thread/archive` を実行する。
- 互換 `scripts/task-runner.ts` も pending request の時だけアーカイブ対象にする。
- `docs/CONTEXT.md` に同期方式を追記した。

## Verification

- `npm run test:run -- src/lib/codex-source-completion.test.ts src/app/api/agents/codex-monitor/tasks/route.test.ts`
- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `npm --prefix scripts/focusmap-agent run build`
- `npx eslint src/lib/codex-source-completion.ts src/lib/codex-source-completion.test.ts src/components/dashboard/mind-map.tsx src/components/mobile/mobile-mind-map.tsx src/app/api/agents/codex-monitor/tasks/route.ts src/app/api/agents/codex-monitor/tasks/route.test.ts scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/src/executors/codex-app.ts scripts/focusmap-agent/src/types.ts scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `curl -I --max-time 5 http://localhost:3001/dashboard`
- `open -a Arc http://localhost:3001/dashboard`

## Notes

チェック解除とMac側archive実行が完全に同時になった場合、すでに発火済みのRPCは取り消せない。今回の安全策は、10秒遅延、解除時のtimer cancel、pending requestのcancel保存、Mac agent API側の元ノードdone再確認で誤アーカイブを減らす設計にしている。
