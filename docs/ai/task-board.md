# Task Board

Last updated: 2026-06-06

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
| TASK-20260606-001 | 2026-06-06 | Codex進捗サイドパネルをチャット閲覧UIへ変更 | - | 確認待ち/実行中タスクの詳細panelから操作ボタン・進捗履歴を外し、送信内容とCodex返答を読むチャット表示へ変更 |
| TASK-20260605-007 | 2026-06-06 | Codex監視を5秒軽量pulseへ統一 | [plan](../plans/active/codex-monitoring-data-architecture.md) | 本文ログ同期をやめ、runner heartbeat/current_task_id と ai_tasks activity時刻で5秒pulse表示へ変更 |
| TASK-20260605-006 | 2026-06-05 | Codex manual handoff状態遷移の補正 | [plan](plans/active/codex-monitoring-data-architecture.md) | Codex出力preview取得後に未送信へ残さず、動作中は実行中、停止後は確認待ちへ丸める。Turso mirrorは変化時だけに抑制 |
| TASK-20260605-005 | 2026-06-05 | Codex監視UIの実利用診断と小修正 | [plan](plans/active/codex-monitoring-data-architecture.md) | 未送信/実行中/確認待ちの表示分離、snapshot失敗時のai_tasks暫定表示、看板/詳細の密度調整 |
| TASK-20260605-004 | 2026-06-05 | Codex.app handoff/monitoring穴埋め修正 | [plan](../plans/active/codex-monitoring-data-architecture.md) | handoff登録順、watch cleanup、runner scope、Turso防波堤、docs矛盾を修正 |
| TASK-20260605-003 | 2026-06-05 | Codex.app手動handoff + Turso節約monitoring実装 | [plan](../plans/active/codex-monitoring-data-architecture.md) | watch API、5秒snapshot、10秒heartbeat、manual handoff標準化を実装 |
