# AI履歴 first-seen計測とdetail hydrate安定化

- Task ID: TASK-20260624-003
- Status: completed
- Created: 2026-06-24
- Completed: 2026-06-24
- Board: `docs/ai/task-board.md`

## Goal

AI履歴監視の最終詰めとして、UI first displayedをCDP依存なしで測れるdebug metricへ残し、未リンクAI履歴detail hydrateを実機で3秒以内に寄せる。

## Scope

- `src/hooks/useAiHistory.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- 関連テスト
- `docs/CONTEXT.md`

## Non-goals

- UIリデザイン
- 本番DB操作
- push/deploy
- 常時poll増加や毎秒Turso write追加
- heavy reconcile/detail hydrateの常時1秒化

## Plan

1. snapshot merge/full-list表示時に `window.__focusmapAiHistoryMetrics` へfirst-seen metricを記録する。
2. detail open直後の既存UI burstとagent hydrate要求検出の周期を揃え、detail要求がある間だけ短期1秒へ寄せる。
3. 対象テスト、agent build、対象eslint、`git diff --check` を実行する。
4. `docs/CONTEXT.md`、board、archive、run logを更新してcommitする。

## Parallelization

`SINGLE_CHAT`。同じAI履歴監視契約に関わるhook、UI、agent、docsを小さく揃える修正で、分割すると周期・計測仕様の解釈ズレが出やすい。

## Verification

ユーザー明示許可済み:

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/hooks/useAiHistory.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx --test-timeout=30000`
- `npm --prefix scripts/focusmap-agent run build`
- `npx eslint scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/src/executors/codex-app.ts scripts/focusmap-agent/src/types.ts src/hooks/useAiHistory.ts src/components/dashboard/codex-chat-import-sidebar.tsx`
- `git diff --check`

## Result

- `useAiHistory` が表示対象のAI履歴を初回取得またはsnapshot mergeで初めて受け取った時に、通常UIへ表示を増やさず `window.__focusmapAiHistoryMetrics.firstSeenById` / `events` へfirst-seen metricを記録するようにした。
- detail hydrate requestのagent側確認を、requestがある間とmetadata hot-sync直後10秒だけ1秒へ寄せた。アイドル時5秒、heavy reconcile、通常active watchの設計は維持した。
- detail rollout cacheは1秒後に再検査可能にし、期限到達時に必ずrolloutを読み直すよう修正した。
- 対象テスト、agent build、対象eslint、`git diff --check` はすべて通過した。
