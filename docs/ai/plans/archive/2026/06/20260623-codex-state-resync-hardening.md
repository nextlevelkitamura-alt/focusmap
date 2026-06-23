# Codex現在状態の復帰後同期強化

- Task ID: TASK-20260623-002
- Status: completed
- Created: 2026-06-23
- Completed: 2026-06-23
- Board: `docs/ai/task-board.md`

## Goal

Focusmapアプリを閉じている間にCodexセッションが終了・停止・再開しても、復帰後に `ai_tasks` とAI履歴の状態を同じ基準で復元する。

## Scope

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/src/api-client.ts`
- `scripts/focusmap-agent/src/heartbeat.ts`
- `src/app/api/agents/ai-history/*`
- `scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `docs/CONTEXT.md`

## Non-goals

- Codex.app自体のDBやrolloutを直接書き換えない。
- 本番DBの手動補正はしない。
- UIの大規模リデザインはしない。

## Plan

1. Codex rolloutから状態を解釈する関数を `ai_tasks` / `ai_history` 共通に寄せる。
2. 終了イベントなしの古い `running` をAI履歴でも30分基準で `awaiting_approval` へ倒す。
3. Focusmap側でactiveなAI履歴をagentへ返し、最新上位から漏れた古いrunning履歴もthread id直読みに含める。
4. heartbeat metadataへagentのbuild/source情報と状態resolver versionを載せ、古い同梱agentを見分けやすくする。
5. 仕様とテストを更新する。

## Parallelization

`SEQUENTIAL`。状態判定・agent API・テスト・docsが同じ契約に依存するため、単一チャットで直列実装する。

## Verification

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/app/api/agents/ai-history/active-monitor-targets/route.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx src/lib/task-progress-ui.test.ts`（68 tests passed）
- `npm --prefix scripts/focusmap-agent run build`
- `git diff --check`

## Result

`ai_tasks` とAI履歴のstale running判定を30分基準へ揃えた。Focusmap側でactiveなAI履歴targetを返すagent APIを追加し、agent hot-syncが最新上位から漏れた古いrunning/確認待ち履歴もthread idで直接再評価するようにした。UIは `runState='stale_no_terminal_event'` を `要確認` と表示する。
