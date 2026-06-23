# Codex stale running and app bundle fix

- Task ID: TASK-20260623-003
- Status: completed
- Created: 2026-06-23
- Completed: 2026-06-23
- Board: `docs/ai/task-board.md`

## Goal

Codexセッションが実質停止済みなのにFocusmapで緑の `実行中` として残る状態を、agent判定・UI表示・Macアプリ同梱dist更新の3点で解消する。

## Scope

- Codex rolloutのstale running判定
- `ai_tasks.result.codex_run_state='stale_no_terminal_event'` のUI丸め
- Macアプリinstall時の同梱agent resolver version検査
- 対象回帰テスト
- `docs/CONTEXT.md` の仕様更新

## Non-goals

- Codex.app本体の状態DB形式変更
- 本番DBの手動修正
- Cloud Run手動デプロイ

## Plan

1. `thread.updated_at_ms` だけでstale runningが延命されないようにする。
2. stale化した `ai_tasks` は `codex_run_state='stale_no_terminal_event'` を保存し、UIも確認待ち表示へ倒す。
3. `npm run mac:install` が古い同梱agentを配置しないよう、sourceの resolver version と packaged dist の一致を検査する。
4. 回帰テスト、agent build、Mac build/installを実行する。
5. local mainへcommitし、明示依頼に従ってorigin/mainへpushする。

## Parallelization

SINGLE_CHAT。Codex状態契約、agent、UI、Mac bundle検査、docsが同じ不変条件を共有するため、分割しない。

## Verification

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/lib/codex-run-state.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx src/lib/task-progress-ui.test.ts`（88 tests passed）
- `npm --prefix scripts/focusmap-agent run build`（passed）
- `npm run mac:build:install`（Next build / Electron package / `/Applications/Focusmap.app` install passed）
- `open -a Focusmap && sleep 4 && ps -ax -o pid=,command= | rg 'Focusmap|focusmap-agent'`（Focusmap本体起動を確認）
- `sleep 8 && ps -ax -o pid=,command= | rg 'Focusmap|focusmap-agent|codex-thread-monitor'`（同梱agent起動を確認）
- `git diff --check`（passed）

## Result

stale running判定でCodex thread metadata更新だけにより実行中が延命されないよう、明示activity時刻を正にした。stale化した `ai_tasks` は `codex_run_state='stale_no_terminal_event'` として保存し、UIも同状態を確認待ちへ丸める。Mac install時はsourceの `CODEX_THREAD_STATUS_RESOLVER_VERSION` と同梱distの一致を検査し、`/Applications/Focusmap.app` へ再インストール後に resolver version `2026-06-23-stale-running-v3` とagent起動を確認した。

## Links

- `docs/CONTEXT.md`
