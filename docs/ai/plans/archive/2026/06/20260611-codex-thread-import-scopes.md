# Codex thread repo scope import

- Task ID: `TASK-20260611-003`
- Status: `completed`
- Created: `2026-06-11`
- Completed: `2026-06-11`
- Branch: `codex/codex-import-scopes`
- Worktree: `/private/tmp/focusmap-codex-import-scopes`

## 目的

Codex.app側で直接始めたthreadを、Focusmapの全プロジェクトへ無差別に入れず、repo_pathが明示されたprojectだけへ取り込む。マップ上のCodexボタンで取り込みをON/OFFし、ONにした時刻以降、そのprojectのrepoで発生したthreadだけを `Codex Inbox` ノードと `ai_tasks` に変換する。

## 契約

- `projects.repo_path` が取り込み先repoの正。
- `projects.codex_thread_import_enabled=true` のprojectだけをscopeとして返す。
- `projects.codex_thread_import_enabled_since` より前のthreadは取り込まない。
- `threads.cwd` と `projects.repo_path` は完全一致で判定する。
- 既存manual handoff taskの監視・同期は維持し、直接開始threadの取り込みだけscopeで制限する。
- ノードtitleは短い `threads.title` を優先し、長いraw prompt風titleは `first_user_message` の先頭行へfallbackする。
- ノードmemoと `ai_tasks.prompt` は `first_user_message` を優先する。

## 実装範囲

- DB migration / Supabase型
- project PATCHで取り込みON/OFFとrepo必須ガード
- agent向け `/api/agents/codex-monitor/import-scopes`
- `/api/agents/codex-monitor/import-thread` のscope再確認
- `focusmap-agent` のscope取得、候補判定、`has_user_event` 依存削除
- desktop/mobileマインドマップ左上のCodex取り込みトグル
- `docs/CONTEXT.md` と focused tests

## 検証

- `npm run test:run -- src/app/api/agents/codex-monitor/import-thread/route.test.ts scripts/focusmap-agent/codex-thread-monitor.test.ts src/components/mindmap/custom-mind-map-view.test.tsx`
- `npm run test:run -- src/app/api/agents/codex-monitor/import-scopes/route.test.ts`
- `npm run test:run -- 'src/app/api/projects/[id]/route.test.ts'`
- `npm run build` in `scripts/focusmap-agent`
- touched-file ESLint: error 0、既存warningのみ
- `npx tsc --noEmit --pretty false`: 既存 `mcp/` / `mobile/` 依存不足と既存Timeout型で失敗
- `git diff --check`
