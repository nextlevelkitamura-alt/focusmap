# Task Board

Last updated: 2026-06-07

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | Planned | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | 実装前に契約確認し、Mac supervisor・agent monitor・API/DB・UI・legacy runner cleanupへ分割 | 2026-06-07 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260607-006 | 2026-06-07 | Codex thread削除/アーカイブ時のノード完了同期 | [plan](plans/archive/2026/06/20260607-codex-thread-close-completes-node.md) | Codex側でthreadをアーカイブ/削除した時に `ai_tasks` を完了し、`source_task_id` のマップノードを `done` に同期。通常完了や承認待ちは自動完了しない |
| TASK-20260607-002 | 2026-06-07 | マップノードCodex軽量状態の3秒反映修正 | - | Turso未設定時も `ai_tasks` 軽量状態を正にし、表示中ノードのCodexローカル同期上限を8件から40件へ拡大。古いtask/snapshotでノード状態を上書きしないよう修正 |
| TASK-20260607-005 | 2026-06-07 | Codex同期のSupabase書き込み削減 | - | `/api/codex/sync-node` の無変化poll/`codex_last_checked_at` 書き込みを停止し、activityはTurso primaryを既定化。保存境界を `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` と `docs/CONTEXT.md` に記録 |
| TASK-20260607-001 | 2026-06-07 | Codex返答activity fallback表示の修正 | - | activity保存先が無いローカルdevでも、詳細open時の短い可視会話を `ai_tasks.result.codex_visible_messages` へfallback保存し、チャットAPIで返答を表示 |
| TASK-20260606-007 | 2026-06-06 | Codex promptコピーと未送信中再コピー導線の修正 | [plan](plans/archive/2026/06/20260606-codex-prompt-copy-handoff.md) | `codex://` からprompt本文を外し、Clipboard API失敗時はローカル `pbcopy` へfallback。未送信/非実行中の詳細UIに再コピー導線を追加 |
