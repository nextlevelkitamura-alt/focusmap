# Codex Thread Close Completes Node

Date: 2026-06-07
Task: TASK-20260607-006
Mode: SINGLE_CHAT
Branch: main

## Goal

Codex.app側でFocusmap連携中のthreadをアーカイブまたは削除したら、対応する `ai_tasks` を完了扱いにし、元のマインドマップノードも `done` にする。

## Scope

- `/api/codex/sync-node` の `archived` / `thread_deleted` 判定後の完了処理
- `ai_tasks.result` への完了理由記録
- `source_task_id` がある場合の `tasks.status='done'` / `stage='done'` 同期
- Turso snapshot への `completed` 反映
- Codex連携仕様ドキュメントとテスト更新

## Acceptance

- Codex threadがアーカイブされた時、次の同期で `ai_tasks.status='completed'` になり、`completed_at` が入る。
- Codex threadが削除されてsqliteから読めない時も、同様に `ai_tasks.status='completed'` になる。
- `source_task_id` がある時は元ノードが `done` になり、チェックボックスが付く。
- `completed` にする理由は `codex_review_reason='archived' | 'thread_deleted'` と `codex_source_task_completed=true` で追跡できる。
- 通常の実行完了 `completed` や承認待ちは、勝手に元ノード完了にしない。

## Routing

単一APIの状態遷移とUI/DB契約の修正で、編集範囲が強く結合しているため単一チャットで直列実装する。readonlyサブエージェントや別worktreeは使わない。

## Result

- `/api/codex/sync-node` で `thread_deleted` / `archived` を検知した時、`ai_tasks.status='completed'` と `completed_at` を保存するようにした。
- `source_task_id` がある場合は、同じ同期で元マインドマップノードを `status='done'` / `stage='done'` に更新する。
- 完了理由を `codex_review_reason` と `codex_source_task_completed` に残し、通常のCodex実行完了や承認待ちでは元ノードを自動完了しない。
- 元ノード完了済みの閉鎖済みCodex taskは、ノード上の「確認待ち」Codexバッジを出さない。
