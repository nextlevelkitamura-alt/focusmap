# Codex実行時間の開始時刻表示を正確化

- Task ID: TASK-20260619-008
- Status: completed
- Created: 2026-06-19
- Completed: 2026-06-19
- Board: `docs/ai/task-board.md`

## Goal

Codex.app本体の作業中秒数とFocusmapの `AI実行` 履歴秒数が大きくズレないよう、Focusmap表示はCodex rolloutの `task_started` 由来で保存済みの `ai_tasks.result.codex_turn_started_at` を開始時刻の正にする。

## Scope

- `/api/ai-tasks` の軽量selectに `result.codex_turn_started_at` / `result.codex_turn_completed_at` を追加する。
- Codexチャット取り込みサイドバーの一覧・詳細は、サーバー由来の1ラリー時間をローカル `sessionStorage` 計測より優先する。
- 既存の `ai_tasks.started_at`、runner heartbeat、Turso schema、polling間隔、DB write頻度は変えない。
- 回帰テストで、サーバー時刻がある場合はローカル計測に上書きされないこと、サーバー時刻が無い場合だけローカルfallbackが残ることを確認する。

## Non-goals

- DB migrationやTurso snapshot schemaの追加。
- `ai_tasks.started_at` の意味変更。
- Codex monitor / focusmap-agent の巡回間隔変更。
- Codex履歴sanitize、archive、D&D、AI要約UIの変更。

## Plan

1. `AI_TASK_LIST_SELECT` / `AI_TASK_STATUS_SELECT` / compact result mapへ既存JSONB fieldを追加する。
2. `CodexChatImportSidebar` の経過時間優先順位を `codex_turn_*` / activity metadata / local fallback に変更する。
3. 仕様メモを「`codex_turn_started_at` が正、local timerは暫定fallback」へ更新する。
4. Codex履歴表示のunit/component testsを追加・更新する。
5. 対象テスト、必要に応じて関連lint/typeの軽い確認を実行する。

## Parallelization

SINGLE_CHAT。

API返却、UI優先順位、仕様メモ、回帰テストが同じ時間契約を共有するため、並列実装に分けると `started_at` と `codex_turn_started_at` の扱いがズレるリスクが高い。既存main worktreeで小さく順次実装する。

## Verification

- `npm run test:run -- src/app/api/ai-tasks/route.test.ts src/lib/codex-thread-import-display.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx src/components/task-progress/task-progress-kanban.test.tsx --test-timeout=30000`
- `npx eslint src/app/api/ai-tasks/route.ts src/app/api/ai-tasks/route.test.ts src/components/dashboard/codex-chat-import-sidebar.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx`
- `git diff --check`

## Result

`/api/ai-tasks` のlist/status viewへ `result.codex_turn_started_at` / `result.codex_turn_completed_at` を追加し、compact後の `result` に残すようにした。Codexチャット取り込みサイドバーは、running一覧・running詳細・確認待ち後の作業時間で、Codex rollout由来の1ラリー時間をローカル `sessionStorage` 計測より優先する。サーバー時刻が無い古い/過渡状態ではローカルfallbackを維持する。`ai_tasks.started_at`、Turso schema、polling/write頻度、runner監視は変更していない。

## Links

- `src/app/api/ai-tasks/route.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `src/lib/codex-thread-import-display.ts`
- `docs/CONTEXT.md`
