# AIタスク作業時間表示

- Task ID: TASK-20260618-007
- Status: completed
- Created: 2026-06-18
- Completed: 2026-06-18
- Board: `docs/ai/task-board.md`

## Goal

Codex/AI実行中の経過秒数を画面に表示し、実行終了後は実行開始から確認待ちに入るまでの作業時間を確認できるようにする。

## Scope

- `ai_tasks.started_at` と `result.awaiting_approval_at` / `completed_at` / `last_activity_at` から作業時間をクライアント側で算出する
- AI実行タイムライン、Codex履歴サイドバー、Codexノード詳細の表示を揃える
- TursoやDBスキーマへの送信・保存は追加しない
- 仕様メモを `docs/CONTEXT.md` へ反映する

## Non-goals

- runner / focusmap-agent / Turso mirror のデータ送信変更
- 新しいDBカラム追加
- 検証コマンドやブラウザ確認の自動実行

## Plan

1. 作業時間計算と表示フォーマットを共通ヘルパーへ切り出す。
2. 実行中は1秒ごとにクライアント再描画して `3s` 形式を表示する。
3. 確認待ち以降は `result.awaiting_approval_at` を優先して固定の作業時間を表示する。
4. AI実行タイムラインとCodex履歴カード/詳細へ状態横の丸い稼働マークと秒数を追加する。
5. `docs/CONTEXT.md`、task-router記録を更新する。

## Parallelization

SINGLE_CHAT。UI表示と時間算出の契約が同じ `ai_tasks` 状態に依存しており、分割すると表示差分が出やすい。

## Verification

ユーザーが明示していないため、テスト・lint・build・ブラウザ確認は自動実行しない。差分確認のみ行う。

## Result

- `src/lib/ai-task-work-elapsed.ts` に `ai_tasks` の作業時間算出と `3s` / `1m 5s` 形式の共通表示を追加した。
- AI実行タイムライン、Codex履歴サイドバー、スマホCodexシート、`CodexNodePanel` で実行中は丸い稼働マークと秒数を表示し、確認待ち以降は `作業時間 X` を表示するようにした。
- 作業時間は `started_at` / `created_at` から `result.awaiting_approval_at` を優先して算出し、Turso/DBへの新規送信やschema変更は行っていない。
