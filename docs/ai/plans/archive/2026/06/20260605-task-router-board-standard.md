# task-router 進捗ボード標準

- Task ID: TASK-20260605-002
- Status: completed
- Created: 2026-06-05
- Completed: 2026-06-05
- Board: `docs/ai/task-board.md`

## Goal

task-router がどのリポジトリでも同じ名前で進捗を管理できるようにする。チャットセッションに閉じず、企画・実装・確認待ち・完了の状態、計画ファイル、過去完了分を見える場所に残す。

## Scope

- グローバル `task-router` に `workflows/task-board.md` を追加する。
- task-router の `SKILL.md` / `heavy-flow.md` / `telemetry-and-mistakes.md` にボード更新タイミングを組み込む。
- Focusmap の `AGENTS.md` / `CLAUDE.md` / `docs/CONTEXT.md` に入口だけ追加する。
- Focusmap に標準ボードと 2026/06 の月別アーカイブを作る。

## Non-goals

- 既存の `docs/plans/*` / `docs/requirements/*` を移行しない。
- 過去タスクを完全に棚卸ししない。
- UIやアプリ機能は変更しない。

## Plan

1. 標準名を `docs/ai/task-board.md`、`docs/ai/plans/active/`、`docs/ai/plans/archive/YYYY/MM/`、`docs/ai/task-archive/YYYY/MM.md` に決める。
2. task-router workflow に導入・更新・完了時アーカイブ手順を追加する。
3. Focusmap の入口を最小限更新する。
4. 今回分のボードと月別アーカイブを作る。

## Result

標準パスを task-router に組み込み、Focusmap 側にも同じ名前でボードと月別アーカイブを追加した。既存の要件管理・プラン体系は壊さず、task-router が作る新規計画だけ標準パスを使う。

## Verification

- `git diff --check`
- `rg` による標準パス参照確認

## Links

- `docs/ai/task-board.md`
- `docs/ai/task-archive/2026/06.md`
- `/Users/kitamuranaohiro/.claude/skills/task-router/workflows/task-board.md`
