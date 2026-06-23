# 予定完了保存の安定化

- Task ID: TASK-20260623-004
- Status: completed
- Created: 2026-06-23
- Completed: 2026-06-23
- Board: `docs/ai/task-board.md`

## Goal

Todo/3daysカレンダーの予定完了チェックで「予定の完了状態を保存できませんでした」が出る状態を避け、完了状態をDBへ確実に残す。

## Scope

- `/api/calendar/events/complete`
- `event_completions` 型定義
- 対象API単体テスト
- カレンダー完了仕様の `docs/CONTEXT.md`

## Non-goals

- 本番DBへ直接DDLを当てる
- Google Calendar API側の予定ステータスを変更する
- UIレイアウトを変更する

## Plan

1. `event_completions` の複合 `ON CONFLICT` 失敗時にlegacy DB向けfallbackを入れる。
2. 完了/未完了を同じ `calendar_id + google_event_id` の自動取り込みtaskへ同期する。
3. `event_completions` を型定義に追加し、対象テストを更新する。
4. 仕様変更を `docs/CONTEXT.md` とtask-router記録へ反映する。

## Parallelization

単一チャット。API保存、task同期、テスト、仕様更新が同じ契約に依存するため分割しない。

## Verification

- `npm run test:run -- src/app/api/calendar/events/complete/route.test.ts src/lib/calendar-event-completion.test.ts`（8 tests passed）
- `npx tsc --noEmit --pretty false` は数分出力なしで完了しなかったため停止（code 130）

## Result

`event_completions` の複合index未適用DBでも、`ON CONFLICT` エラー時にlegacy keyで削除してからinsertし、完了状態保存を継続する。保存成功後は `source='google_event'` の自動取り込みtaskだけを同じ複合キーで `done/todo` に同期する。
