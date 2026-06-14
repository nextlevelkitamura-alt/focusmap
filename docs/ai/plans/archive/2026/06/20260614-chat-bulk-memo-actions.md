# チャットAIのメモ一括追加導線

- Task ID: TASK-20260614-001
- Status: completed
- Created: 2026-06-14
- Completed: 2026-06-14
- Board: `docs/ai/task-board.md`

## Goal

チャット内の壁打ち・マインドマップ/ノート確認から出た複数の提案を、見出し・内容・所要時間などを持つメモとして一括追加できるようにする。

## Scope

- `UnifiedChat` の `+` メニューにメモ一括追加の依頼導線を追加する。
- 統合AIエージェントのツールに、複数メモを `ideal_goals` へ保存する `bulkAddMemos` を追加する。
- ツール完了後、メモ画面/今日メモボードがキャッシュ再取得できるようにする。
- `docs/CONTEXT.md` のチャット/メモ連携仕様を更新する。

## Non-goals

- DBマイグレーションは行わない。
- 大量削除・既存メモの自動統合は行わない。
- 専用の確認モーダルや新しいメモ画面UIは作らない。

## Plan

1. agent toolsへ `bulkAddMemos` を追加し、タイトル/本文/所要時間/タグ/プロジェクト紐づきを保存する。
2. agent system promptへ「候補提示→承認→一括保存」の運用を追加する。
3. `UnifiedChat` のショートカットと進捗ラベル、メモキャッシュ更新を追加する。
4. focused tests/lint/typecheckを実行し、ドキュメントとtask-router記録を完了させる。

## Parallelization

Decision: `SEQUENTIAL`

理由: チャットプロンプト、ツール契約、UIキャッシュ更新が同じ `UnifiedChat` / agent tools の契約に依存するため、実装並列化すると挙動がずれやすい。現在の作業ブランチを汚さないため、`origin/main` 起点の専用worktree `/Users/kitamuranaohiro/Private/focusmap-chat-bulk-memo-actions` で進める。

## Verification

- `npm run test:run -- src/lib/ai/agent-chat-progress.test.ts`
- `npx eslint` focused files
- `npx tsc --noEmit --pretty false`
- `git diff --check`

## Result

`bulkAddMemos` を統合AIエージェントへ追加し、チャット内の壁打ち・マップ/ノート確認から出た複数候補を `ideal_goals` のメモとして一括追加できるようにした。`UnifiedChat` の `+` メニューに `メモ一括追加` を追加し、完了progressを検知して `invalidateWishlistItemsCache()` と `WISHLIST_REFRESH_EVENT` でメモ画面/今日メモボードの再取得を促す。AI指示文には、AI発案の複数メモは原則候補確認後に保存し、ユーザーが追加まで明示した時だけ自律追加できるルールを追加した。

## Links
