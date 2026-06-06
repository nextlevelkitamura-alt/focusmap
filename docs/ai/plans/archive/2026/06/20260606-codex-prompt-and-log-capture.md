# Codex Prompt And Log Capture

- Task ID: TASK-20260606-006
- Status: completed
- Created: 2026-06-06
- Completed: 2026-06-06
- Board: `docs/ai/task-board.md`

## Goal

Codex.appへ送る本文からFocusmap連携用の説明文を外し、Codex.app内で出ている実際の返答・進捗ログをFocusmapのチャット/detailへ回収できるようにする。

## Scope

- FocusmapからCodex.appへ渡すprompt生成を確認し、同期IDや「返信では触れない」系の文言をユーザー可視promptから除く。
- Codex.appのthread検出がprompt内同期IDに依存している場合は、別のmetadata/時刻/ai_task_id連携で検出できるようにする。
- rollout JSONL / Codex app-server / sqlite から、稼働シグナルだけでなくユーザー可視のassistantログを抽出し、activityへ表示する。
- 仕様変更を `docs/CONTEXT.md` に反映する。

## Non-goals

- Codex.appの内部UIを変更しない。
- Codexの全文履歴をDBへ保存しない。
- 本番push/deployは行わない。

## Plan

1. prompt生成、thread検出、rollout解析、activity mirrorの既存経路を読む。
2. 実際の最近のrollout JSONLを確認し、Codex.appで見えている細かいログのevent形式を特定する。
3. ユーザー可視promptを簡素化し、同期検出はDB metadataと時刻/ai_task_id側へ寄せる。
4. assistant/progressログ抽出を改善し、detailチャットに実返信が出るようにする。
5. 関連テスト・lint・表示確認を行い、自分の変更だけコミットする。

## Parallelization

単一チャットで進める。prompt生成、thread検出、ログ解析、activity表示が同じCodex同期契約に依存するため、分割すると検出条件と表示条件がずれるリスクが高い。

## Verification

- `npm run test:run -- src/lib/codex-run-state.test.ts src/lib/codex-app-launch.test.ts`
- `npm run lint -- src/lib/ai-task-activity.ts src/lib/codex-run-state.ts src/lib/codex-run-state.test.ts src/lib/codex-app-launch.ts src/lib/codex-app-launch.test.ts src/app/api/codex/sync-node/route.ts src/components/codex/codex-node-panel.tsx src/components/mindmap/mindmap-linked-memos-dialog.tsx src/components/task-progress/task-progress-detail-panel.tsx scripts/task-runner.ts`
- `git diff --check`
- `npx tsc --noEmit --pretty false` は既存 `src/app/login/page.tsx` の `focusmapDesktop` 型衝突で失敗
- Browser: `http://localhost:3001/dashboard` を表示し、コンソールerror 0を確認（Supabase Realtime warningのみ）
- 実Codex rollout `あとドドドド` からユーザー送信とassistant返答本文を抽出できることを `parseCodexRollout` で確認

## Result

- Codex.appへ渡す可視promptからFocusmap同期IDと「返信では触れない」文言を削除した。handoff tokenはDB metadataだけに残す。
- rollout JSONLの複数可視メッセージをactivity化し、generic pulse文はチャット本文に表示しないようにした。
- CodexNodePanel、リンクメモ詳細、progress詳細panelは開いた瞬間にactivityを読み、開いている間だけ3秒syncで `include_visible_activity=true` を渡す。マップ全体の軽量状態同期は返信本文を保存しない。
- 常駐runnerはactive watchがあるtaskだけチャット本文をactivity化する。activity保存はdedupe key、決定的Turso id、プロセス内キャッシュで同一本文の再送/upsertを抑制する。
- `docs/CONTEXT.md` に同期方式、free-tier見積もり、open-onlyチャット取得方針を反映した。

## Links

- `docs/CONTEXT.md`
