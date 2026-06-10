# Codex Orphan Thread Inbox

- Task ID: TASK-20260610-011
- Status: completed
- Created: 2026-06-10
- Completed: 2026-06-10
- Board: `docs/ai/task-board.md`

## Goal

Codex.app で直接開始された Focusmap 未紐付け thread を Mac agent が検出し、既存の Focusmap から Codex へ送る manual handoff を壊さずに、Focusmap 側へ追跡 task とマップノードとして取り込む。

## Scope

- Mac agent の Codex thread monitor に未紐付け thread 検出を追加する。
- agent 認証付き API で未紐付け thread を冪等に import する。
- import 先は repo path が一致する project を優先し、無ければ対象 space/user の既存 project に置く。
- 取り込みノードは `Codex Inbox` グループ配下に作り、`ai_tasks.source_task_id` と `codex_thread_id` を紐付ける。
- 既存 manual handoff task の thread 検出・同期挙動は維持する。

## Non-goals

- Codex.app の公式 webhook 化。
- 既存 Focusmap 送信導線の自動実行化。
- 未分類 thread をユーザーの意図する親ノードへ完全自動分類すること。

## Plan

1. API contract: `POST /api/agents/codex-monitor/import-thread` を追加する。
2. Monitor: `state_5.sqlite` から未登録/未アーカイブ/ユーザー入力ありの thread を拾って API へ送る。
3. Dedupe: `codex_thread_id` 既存なら何もしない。`tasks.codex_thread_id` も確認する。
4. Tests: server helper と monitor helper の focused tests を追加する。
5. Docs: `docs/CONTEXT.md` に逆方向取り込み仕様を追記する。

## Parallelization

SINGLE_CHAT。agent監視、API冪等性、ノード作成、状態表示の契約が密結合なので分割しない。

## Verification

- `npm run test:run -- src/app/api/agents/codex-monitor/import-thread/route.test.ts src/app/api/agents/codex-monitor/tasks/route.test.ts`
- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `npm --prefix scripts/focusmap-agent run build`
- `npx eslint src/app/api/agents/codex-monitor/import-thread/route.ts src/app/api/agents/codex-monitor/import-thread/route.test.ts scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/codex-thread-monitor.test.ts scripts/focusmap-agent/src/api-client.ts scripts/focusmap-agent/src/types.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`

## Result

完了。Focusmap未紐付けのCodex.app threadをMac agentが取り込み、`Codex Inbox` グループ配下のマップノードと `ai_tasks` に紐付けるAPI/monitorを追加した。既存manual handoff taskの同期を先に試してからorphan importを走らせるため、Focusmapから送る既存導線は維持される。
