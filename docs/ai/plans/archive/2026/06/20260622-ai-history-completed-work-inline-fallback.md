# AI履歴詳細の作業しました時間fallback

- Task ID: TASK-20260622-003
- Status: completed
- Created: 2026-06-22
- Completed: 2026-06-22
- Board: `docs/ai/task-board.md`

## Goal

AI履歴が実行後に確認待ちへ変わった時、詳細本文の `作業しました` 行が、activity metadata欠落だけで表示されない状態を減らす。右上/一覧と同じ1ラリー時間がある場合は本文にも同じ時間を表示し、metadataがある場合は従来通りmetadataを正にする。

## Scope

- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `src/components/dashboard/codex-chat-import-sidebar.test.tsx`
- task-router記録ファイル

## Non-goals

- DB schema / migrationは増やさない。
- Mac agent / Turso detail hydrate / ai_tasks activity同期の保存仕様は変えない。
- 実行中の `作業中` 表示、履歴一覧の並び順、アーカイブ操作は変えない。

## Plan

1. 完了後のinline status挿入位置を、最新ユーザー発話後の最初の非status assistant/codexメッセージへfallbackできるようにする。
2. 表示秒数は `activity.metadata.work_elapsed_ms` / `turn_started_at` + `turn_completed_at` を最優先し、無ければ選択中履歴カードの `workDurationSeconds` / `codex_turn_*` 由来の1ラリー時間を使う。
3. fallback表示とmetadata優先の回帰テストを追加する。

## Parallelization

`SINGLE_CHAT`。UIコンポーネント1つと同一テストファイルだけの変更で、分割すると統合コストが上がる。

## Verification

- `npm run test:run -- src/components/dashboard/codex-chat-import-sidebar.test.tsx --test-timeout=30000`（10 tests passed）

## Result

- `completedWorkMessageIndex` が、metadataがない完了activityでも同期済み1ラリー時間がある時だけ完了行の挿入先を返すようにした。
- 完了行の秒数はactivity metadataを最優先し、無い場合だけ選択中履歴の `workDurationSeconds` / `codex_turn_*` / ローカル観測時間にfallbackする。
- 実行中の `作業中` 行、履歴カードの並び順、DB/Turso保存仕様は変更していない。

## Links

- `docs/CONTEXT.md` のAI履歴詳細仕様
