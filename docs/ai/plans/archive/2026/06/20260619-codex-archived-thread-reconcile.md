# Codex Archived Thread Reconcile

- Task ID: TASK-20260619-006
- Status: completed
- Created: 2026-06-19
- Completed: 2026-06-19
- Board: `docs/ai/task-board.md`

## Goal

Codex.app の未アーカイブ最新チャット一覧と Focusmap の `AI実行` / Codexチャット履歴一覧を揃える。Codex側でアーカイブ済みのthreadはFocusmapの未配置/詳細一覧に出さず、表示順はFocusmapへの取り込み時刻ではなくCodex側の実活動時刻に固定する。

## Scope

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/src/api-client.ts`
- `scripts/focusmap-agent/src/types.ts`
- `src/app/api/agents/codex-monitor/import-thread/route.ts`
- `src/app/api/agents/codex-monitor/tasks/route.ts`
- `src/app/api/agents/tasks/[id]/state/route.ts`
- `src/lib/codex-thread-import-display.ts`
- `src/components/dashboard/mind-map.tsx`
- `src/components/mobile/mobile-mind-map.tsx`
- 関連テスト
- `docs/CONTEXT.md`

## Non-goals

- 新しいDB migrationは作らない。
- Codexチャット本文の全量同期や要約生成は増やさない。
- 本番DB、Turso本体、ローカルCodex DBへの直接操作はしない。
- dev server / lint / build / test の自動実行はしない。AGENTS.mdの自動検証ポリシーに従い、必要な確認コマンドだけ明示する。

## Plan

1. agentのCodex thread payloadに `archived` を追加し、未取り込みorphan import候補からarchived threadを除外する。
2. 既存監視対象threadがarchivedになった時、`ai_tasks.result` に `codex_thread_archived` / `meta.thread_archived` を残す。
3. API側のimport helperもarchived payloadを保持し、万一payloadが来ても状態を表現できるようにする。
4. `codex_review_reason='archived'` 保存後のtaskはmonitor APIから再配信しない。
5. archived保存時は元の `tasks.codex_status='archived'` も反映し、`ai_tasks.result` 未読込の瞬間でもUI除外できるようにする。
6. PC/モバイルのCodex履歴一覧生成で `codexThreadArchivedForDisplay` を使い、archived threadを未配置/詳細一覧から除外する。
7. 表示順の正は既存の `codexThreadImportActivityAt` を維持し、`last_activity_at` / sync時刻へfallbackしないことをテストで固定する。
8. `docs/CONTEXT.md` に、未取り込みarchived threadを履歴候補に含めない新方針を反映する。

## Parallelization

`SINGLE_CHAT`。agent/API/UIの状態契約が密に結合しており、既存のtask-router分析でもCodex監視変更は単一チャットが安全とされているため。

## Verification

作成・更新するテスト内容:

- agent: archived Codex threadはorphan import候補にならない。
- agent: archived状態を既存task resultへ保存し、同期時刻で `last_activity_at` を更新しない。
- monitor API: `codex_review_reason='archived'` のtaskを再スキャン対象に戻さない。
- state API: archived保存時にsource taskへ `codex_status='archived'` を反映する判定を固定する。
- API helper: imported/linked resultへarchived状態が反映される。
- display helper: `codex_review_reason='archived'` / `meta.thread_archived=true` / `task.codex_status='archived'` を表示除外判定する。
- UI: PCのCodex履歴一覧でarchived itemを渡さない。モバイルは同じshared helperを使うコード変更で追従する。

推奨実行コマンド（ユーザー明示がある場合のみ）:

```bash
npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/app/api/agents/codex-monitor/import-thread/route.test.ts src/lib/codex-thread-import-display.test.ts src/components/dashboard/mind-map.test.tsx --test-timeout=30000
npm run test:run -- src/app/api/agents/codex-monitor/tasks/route.test.ts 'src/app/api/agents/tasks/[id]/state/route.test.ts' --test-timeout=30000
```

## Result

実装済み。Codex側でarchivedのthreadは新規orphan import候補から除外し、import APIへ届いても `reason='archived'` で作成しない。既に取り込み済みのthreadがarchivedになった場合は `ai_tasks.result.codex_thread_archived` / `meta.thread_archived` と `tasks.codex_status='archived'` を保存し、同期時刻を `last_activity_at` に上書きしない。PC/モバイルの履歴一覧はshared helperでarchivedを除外し、monitor APIもarchived記録済みtaskを再配信しない。

テストは追加・更新したが、AGENTS.mdの自動検証ポリシーに従い未実行。

## Links
