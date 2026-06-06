# Task Board

Last updated: 2026-06-07

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260607-001 | 2026-06-07 | Codex返答activity fallback表示の修正 | - | activity保存先が無いローカルdevでも、詳細open時の短い可視会話を `ai_tasks.result.codex_visible_messages` へfallback保存し、チャットAPIで返答を表示 |
| TASK-20260606-007 | 2026-06-06 | Codex promptコピーと未送信中再コピー導線の修正 | [plan](plans/archive/2026/06/20260606-codex-prompt-copy-handoff.md) | `codex://` からprompt本文を外し、Clipboard API失敗時はローカル `pbcopy` へfallback。未送信/非実行中の詳細UIに再コピー導線を追加 |
| TASK-20260606-006 | 2026-06-06 | Codex prompt簡素化と開いている時だけの返信ログ回収 | [plan](plans/archive/2026/06/20260606-codex-prompt-and-log-capture.md) | Codex.appへ渡すpromptから連携文言を削除し、詳細open時だけ3秒syncで可視返信をactivity化、Turso/Supabase重複書き込みを抑制 |
| TASK-20260606-002 | 2026-06-06 | Codex返信チャット同期とマップノード状態更新の調査・修正 | [plan](plans/archive/2026/06/20260606-codex-chat-node-status-sync.md) | detail/Codex panelの3秒ローカル同期、マップノード軽量status 3秒更新、activity role復元、通信量見積もりを実装 |
| TASK-20260606-001 | 2026-06-06 | Codex進捗サイドパネルをチャット閲覧UIへ変更 | - | 確認待ち/実行中タスクの詳細panelから操作ボタン・進捗履歴を外し、送信内容とCodex返答を読むチャット表示へ変更 |
