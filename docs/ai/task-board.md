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
| TASK-20260607-008 | 2026-06-07 | スマホCodexアプリ起動とプロンプトコピー修正 | - | スマホ手動handoffでタップ直後に端末クリップボードコピーとChatGPT Codex入口起動を開始し、`.local` / CloudflareでもMacローカルAPIへ逃がさないよう修正 |
| TASK-20260607-007 | 2026-06-07 | Codexチャット返信受信と`.local`同期修正 | - | `*.local` のMacローカルプレビューでも `/api/codex/sync-node` を許可し、`task_started` なしで短く完了するCodex返信を質問/返答activityとして取り込むよう修正 |
| TASK-20260607-003 | 2026-06-07 | 実行中ノード外周アニメーション修正 | - | 実行中ノードは枠を回転させず、CSS custom propertyで外周の光だけを流す表示へ修正 |
| TASK-20260607-006 | 2026-06-07 | Codex thread削除/アーカイブ時のノード完了同期 | [plan](plans/archive/2026/06/20260607-codex-thread-close-completes-node.md) | Codex側でthreadをアーカイブ/削除した時に `ai_tasks` を完了し、`source_task_id` のマップノードを `done` に同期。通常完了や承認待ちは自動完了しない |
| TASK-20260607-002 | 2026-06-07 | マップノードCodex軽量状態の3秒反映修正 | - | Turso未設定時も `ai_tasks` 軽量状態を正にし、表示中ノードのCodexローカル同期上限を8件から40件へ拡大。古いtask/snapshotでノード状態を上書きしないよう修正 |
