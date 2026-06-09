# Codex完了チェックと完了済み表示

- Task ID: TASK-20260609-012
- Status: completed
- Created: 2026-06-09
- Completed: 2026-06-10
- Board: `docs/ai/task-board.md`

## Goal

Codexチャットが完了・アーカイブ・削除された後に、対象ノードを人間がチェック済みにでき、Codex看板や詳細UIでは `確認待ち` ではなく `完了済み` と表示する。チェックを外した場合は、Codex表示を `確認待ち` に戻す。

## Scope

- Codex task UI stateの丸め
- マップノード/詳細/看板のチェック操作
- 必要なAPIまたはhook更新
- 現行仕様を `docs/CONTEXT.md` へ反映

## Non-goals

- Codex.app側のthread archive/delete操作そのものの自動化
- DBマイグレーション
- React Flow版の置き換え
- 本番デプロイ

## Plan

1. 既存のCodex状態UIとノード完了操作の実装箇所を調べる。
2. チェック状態をCodex表示の `完了済み` / `確認待ち` に反映する。
3. 詳細UIと看板カードの表示を揃える。
4. テストまたは型チェックで検証する。
5. docs/board/archive/run logを更新してcommitする。

## Parallelization

SINGLE_CHAT。`ai_tasks` の表示丸め、マップノード、詳細panelが同じ状態契約を共有するため、実装分割は統合コストが高い。

## Verification

- `npm run test:run -- src/lib/codex-run-state.test.ts src/lib/task-progress-ui.test.ts src/app/api/codex/sync-node/route.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src/lib/codex-run-state.ts src/lib/task-progress-ui.ts src/lib/codex-source-completion.ts src/components/dashboard/mind-map.tsx src/components/mobile/mobile-mind-map.tsx src/components/mindmap/custom-mind-map-view.tsx src/components/codex/codex-node-panel.tsx src/components/task-progress/task-progress-kanban.tsx src/components/task-progress/task-progress-detail-panel.tsx src/app/api/codex/sync-node/route.ts src/lib/codex-run-state.test.ts src/lib/task-progress-ui.test.ts src/app/api/codex/sync-node/route.test.ts`
- in-app Browserで `http://localhost:3001/dashboard` を開き、Page Title `ダッシュボード | Focusmap`、console error 0を確認
- Arcで `http://localhost:3001/dashboard` を開いた

## Result

- `completed` / `codex_source_task_completed=true` のCodex状態を `完了済み` と表示するよう、ノード右上バッジ、Codex看板、進捗詳細、ノード詳細の表示丸めを更新した。
- マップノード/ノード詳細のチェック操作から、紐づく最新Codex taskを `completed` / `awaiting_approval` へ同期するクライアントヘルパーを追加した。
- チェック解除時は `codex_source_task_completion_suppressed=true` を保存し、アーカイブ/削除済みthreadの再同期でノードが自動再チェックされないようにした。
- `docs/CONTEXT.md` と関連spec/active planの状態表示仕様を更新した。

## Links

- `docs/CONTEXT.md`
