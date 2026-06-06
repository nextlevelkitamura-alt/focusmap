# Codex Chat And Node Status Sync

- Task ID: TASK-20260606-002
- Status: completed
- Created: 2026-06-06
- Completed: 2026-06-06
- Board: `docs/ai/task-board.md`

## Goal

Codex.appへ送った内容に対するCodex側の返信が右側チャット/detailに表示されない原因を調べ、マップノード上の軽量状態も短周期で更新されるようにする。

## Scope

- Codex activity/detail表示の取得経路と既存poll間隔を確認する。
- マップ全体のノードに `未送信` / `実行中` / `確認待ち` / `接続失敗` の軽量状態が反映されるようにする。
- 3秒poll時の通信量を見積もり、無料枠運用上の前提を `docs/CONTEXT.md` へ反映する。

## Non-goals

- Codex.appのprompt送信そのものを完全自動化しない。
- Codexの全文ログやfull thread historyをDBへ保存しない。
- 本番デプロイやpushは行わない。

## Plan

1. `useMemoAiTasks` / `useTaskProgressSnapshot` / `TaskProgressDetailPanel` / `/api/ai-tasks/[id]/activity` / `/api/codex/sync-node` を調査する。
2. Codex返信がactivityへ入らない、またはdetailが別IDでactivityを引いている可能性を検証する。
3. マップ表示用snapshot/ai_tasks fallbackのpollを3秒へ寄せ、詳細表示中のactivity更新も短周期にする。
4. 仕様と通信量見積もりを `docs/CONTEXT.md` に更新する。
5. 関連テスト・型チェックを実行し、自分の変更だけコミットする。

## Parallelization

単一チャットで進める。対象が同じ同期契約とUIにまたがり、write scopeが重なるため複数実装へ分けるより統合リスクが低い。

## Verification

- `npm run test:run -- src/lib/codex-run-state.test.ts`
- `npm run lint -- src/app/api/ai-tasks/route.ts 'src/app/api/ai-tasks/[id]/activity/route.ts' src/hooks/useMemoAiTasks.ts src/hooks/useTaskProgressSnapshot.ts src/components/task-progress/task-progress-detail-panel.tsx src/components/task-progress/task-progress-kanban.tsx src/components/codex/codex-node-panel.tsx src/components/dashboard/mind-map.tsx src/components/mobile/mobile-mind-map.tsx src/lib/codex-run-state.ts src/lib/codex-run-state.test.ts`
- `git diff --check`
- `npx tsc --noEmit --pretty false` は既存の `src/app/login/page.tsx` `focusmapDesktop` 型衝突で失敗
- Playwright: `http://localhost:3001/dashboard?taskProgressFixture=1` でマップバッジ、3秒更新表示、detailチャット表示を確認

## Result

- 右側detail/Codex panelのローカルCodexログ同期を3秒周期へ寄せ、表示前に `/api/codex/sync-node` を実行するようにした。
- マップ全体のノード状態は `view=status` と `source_task_ids` で軽量取得し、`pending` / `running` / `awaiting_approval` / `needs_input` を3秒周期で更新するようにした。
- Turso由来activityでも mirrored activity の `role` / `kind` / `importance` を復元し、Codex返答がチャット表示で失われないようにした。
- Codex rollout の `task_complete.last_agent_message` を最終返答として拾うようにした。
- 3秒pollの通信量見積もりと運用前提を `docs/CONTEXT.md` に反映した。

## Links

- `docs/CONTEXT.md`
