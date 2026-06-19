# Codex Rally Work Duration

- Task ID: TASK-20260619-002
- Status: completed
- Created: 2026-06-19
- Completed: 2026-06-19
- Board: `docs/ai/task-board.md`

## Goal

Codexチャット履歴の `27s作業しました` 表示を、`ai_tasks` 全体の開始時刻ではなく、ユーザーが追加プロンプトを送ってからそのラリーのCodex回答が終わるまでの時間で表示する。

## Scope

- Codex rollout解析で、Codex回答activityへラリー開始/終了/経過msのmetadataを付ける。
- Web側の `sync-node` とMac agent側の両方で同じmetadata契約を使う。
- AI履歴詳細UIは、完了行の秒数をactivity metadataからだけ読む。
- 実行中表示は、直近ラリーの開始時刻があればそれを優先する。
- `docs/CONTEXT.md` にデータ契約を残す。

## Non-goals

- DB schema追加。
- 既存activityのbackfill。
- task全体の履歴カード/ノード詳細の作業時間仕様変更。
- 本番push/deploy。

## Plan

1. rollout visible messageにturn timingを持たせる。
2. activity metadataへ `turn_started_at` / `turn_completed_at` / `work_elapsed_ms` を保存する。
3. AI履歴UIでmetadataの `work_elapsed_ms` を使う。
4. current resultへ直近turn開始/終了も保存し、running時の表示開始点に使えるようにする。
5. 回帰テストを追加し、docsを更新する。

## Parallelization

Decision: `SINGLE_CHAT`

Reason: rollout解析、activity metadata、UI表示、docsが1つの契約でつながっており、分割するとpayload名やfallback挙動がずれやすい。

## Verification

- Not run. AGENTS.mdの方針に従い、ユーザーが明示した検証コマンドだけ実行する。
- 回帰テストは追加済み:
  - `scripts/focusmap-agent/codex-thread-monitor.test.ts`
  - `src/lib/codex-run-state.test.ts`

## Result

Codex rolloutの可視assistant回答activityに、該当ラリーの `turn_started_at` / `turn_completed_at` / `work_elapsed_ms` metadataを付与するようにした。Web側 `sync-node` とMac agent側の両方で同じmetadata契約を使い、AI履歴詳細の完了行はactivity metadataだけを参照する。実行中表示は直近ユーザー発話からのラリー経過を表示し、metadataが無い古いactivityではtask全体の累計時間へfallbackしない。

## Links

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `src/lib/codex-run-state.ts`
- `src/app/api/codex/sync-node/route.ts`
- `src/components/dashboard/codex-chat-import-sidebar.tsx`
