# Codex Timer Alignment

- Task ID: TASK-20260624-004
- Status: completed
- Created: 2026-06-24
- Completed: 2026-06-24
- Board: `docs/ai/task-board.md`

## Goal

FocusmapのCodex作業時間表示をCodex app本体の実行開始カウントへ寄せる。running表示の即時反映は維持し、timer開始だけrollout JSONLの `task_started` を優先する。

## Scope

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/src/types.ts`
- `src/lib/codex-thread-import-display.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
- 関連テスト
- `docs/CONTEXT.md`

## Non-goals

- DB migration
- 毎秒Turso write / 毎秒Codex app参照
- detail hydrate hot pathやAI履歴2秒snapshot poll設計の変更
- push / deploy

## Plan

1. `running`検知時刻とtimer開始時刻をrollout summaryで分離する。
2. `task_started` がある場合は `codex_timer_started_at` と表示用 `startedAt` をそこへ寄せる。
3. `user_message` 先行時はrunningだけ即時反映し、timerは `task_started` 到着までnullにする。
4. 対象threadだけ10秒後/1分後に再評価するcap付きwatch mapを追加する。
5. UIはサーバー由来timerを優先し、早いローカルfallbackを維持し続けない。
6. docsと回帰テストを更新する。

## Parallelization

SINGLE_CHAT。Codex監視、AI履歴upsert、UI timer表示、テストが同じtimer契約に依存するため、分割すると意味のずれが出やすい。

## Verification

ユーザー明示許可済みの以下を実行済み。

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/components/dashboard/codex-chat-import-sidebar.test.tsx src/lib/codex-thread-import-display.test.ts --test-timeout=30000`
- `npm --prefix scripts/focusmap-agent run build`
- `npx eslint scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/src/types.ts src/lib/codex-thread-import-display.ts src/components/dashboard/codex-chat-import-sidebar.tsx`
- `git diff --check`

## Result

Codex rolloutのrunning検知と作業時間timer開始を分離した。`user_message` / `message role=user` は `codex_running_detected_at` として即running反映に使い、timer開始は `task_started` 由来の `codex_timer_started_at` を優先する。`task_started` 未到着のrunningではUIがローカルtimerを前倒しせず、10秒後/1分後の対象thread限定recheckで後追い補正する。AI履歴metadata/result.metaへ `codex_running_detected_at` / `codex_timer_started_at` / `codex_timer_source` / `codex_timer_offset_ms` を保存し、UIは `codex_timer_started_at` を優先して表示する。

検証は対象テスト90件、focusmap-agent build、対象eslint、diff checkを通過。

## Links

- `docs/CONTEXT.md`
