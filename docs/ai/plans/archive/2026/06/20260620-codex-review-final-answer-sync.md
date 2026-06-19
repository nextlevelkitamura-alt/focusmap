# Codex確認待ち検出と最終回答activity同期の安定化

- Task ID: TASK-20260620-001
- Status: completed
- Created: 2026-06-20
- Completed: 2026-06-20
- Board: `docs/ai/task-board.md`

## Goal

マインドマップ発のCodex handoffで、ローカルCodex state DBの取り違えによる確認待ち反映遅延を避け、Codexの最終回答が既存のactivity/report viewに確実に乗るようにする。

## Scope

- `/api/codex/sync-node` のCodex state DB選択を `focusmap-agent` と同じ鮮度優先に揃える。
- 互換/デバッグ用 `scripts/task-runner.ts` のCodex state DB選択も同じ方針に揃える。
- 確認待ち遷移時の可視activity保存が最終回答を落とさないことを既存テストで固定する。
- 仕様変更点を `docs/CONTEXT.md` に反映する。

## Non-goals

- UI poll間隔を一律で増やさない。
- manual handoffを自動実行へ昇格しない。
- raw rollout全文、command log、thread全文をクラウド保存しない。
- Codexの `task_complete` だけでFocusmapノードを完了扱いにしない。
- 新しい履歴UI部品は作らない。

## Plan

1. `sync-node` のDB resolverを、env指定優先 + 既定候補の最新thread更新時刻比較 + mtime fallbackにする。
2. `task-runner` の互換resolverも同じ選択方針にする。
3. `sync-node` の確認待ちactivity testで、`task_complete.last_agent_message` が `completed` activityとして保存されることを固定する。
4. DB resolver testで、古い `~/.codex/sqlite/state_5.sqlite` より新しい `~/.codex/state_5.sqlite` を選ぶことを固定する。
5. 対象テストを実行し、必要なら失敗箇所だけ修正する。

## Parallelization

Decision: `SEQUENTIAL`

Codex監視はDB選択、状態判定、activity保存、表示が同じ契約に依存するため、単一チャットで順次進める。worktreeや実装並列は使わない。

## Verification

- `npm run test:run -- src/app/api/codex/sync-node/route.test.ts`
- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `npm run test:run -- src/lib/codex-report-view.test.ts`
- `npm run test:run -- src/app/api/codex/sync-node/route.test.ts scripts/focusmap-agent/codex-thread-monitor.test.ts src/lib/codex-report-view.test.ts src/lib/codex-run-state.test.ts`
- `npm run test:run` は実行したが、今回変更外のUIテスト群で失敗し、その後出力停止したため中断した。

## Result

`/api/codex/sync-node` と互換用 `scripts/task-runner.ts` のCodex state DB選択を、env指定優先、既定候補は `threads.updated_at_ms` / `updated_at` の最新値比較、読めない時だけmtime fallbackへ揃えた。これにより、古い `~/.codex/sqlite/state_5.sqlite` が先に存在していても、新しい `~/.codex/state_5.sqlite` のthread更新を読める。

確認待ち遷移では、`task_complete.last_agent_message` を可視assistant activityとして保存することをテストで固定した。同じrole/bodyのactivityがrollout解析とfallbackの両方から来る場合は重複を作らず、`task_complete` 由来のmetadataを優先する。あわせてfocusmap-agentの再起動時判定は、完了後のtool activityだけrunning復帰を許可し、reasoning単体では確認待ちを戻さないようにして既存契約を満たした。

対象テストは通過した。フル `npm run test:run` は、`useCalendars`、`wishlist-view`、`codex-node-panel`、`wishlist-card-detail`、`desktop-today-panel`、`today-memo-board` など今回触っていないUIテストで失敗し、最後に出力が止まったため停止した。

## Links

- `src/app/api/codex/sync-node/route.ts`
- `src/app/api/codex/sync-node/route.test.ts`
- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/task-runner.ts`
- `docs/CONTEXT.md`
