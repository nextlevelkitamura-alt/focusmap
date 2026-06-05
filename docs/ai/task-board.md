# Task Board

Last updated: 2026-06-05

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
| TASK-20260605-004 | 2026-06-05 | Codex.app handoff/monitoring穴埋め修正 | [plan](../plans/active/codex-monitoring-data-architecture.md) | handoff登録順、watch cleanup、runner scope、Turso防波堤、docs矛盾を修正 |
| TASK-20260605-003 | 2026-06-05 | Codex.app手動handoff + Turso節約monitoring実装 | [plan](../plans/active/codex-monitoring-data-architecture.md) | watch API、5秒snapshot、10秒heartbeat、manual handoff標準化を実装 |
| TASK-20260605-001 | 2026-06-05 | 並列判断を task-router へ統合 | なし | `parallel-work-planner` を削除し、`task-router` workflows へ統合 |
| TASK-20260605-002 | 2026-06-05 | task-router 進捗ボード標準を追加 | [plan](plans/archive/2026/06/20260605-task-router-board-standard.md) | 標準ボード名・計画置き場・月別アーカイブ運用を追加 |
