# Codex手動/自動dispatch境界の仕様ずれ修正

- Task ID: `TASK-20260607-021`
- Status: `completed`
- Created: `2026-06-07`
- Completed: `2026-06-07`
- Board: `docs/ai/task-board.md`

## Goal

ユーザーが意図した「Focusmap Macがオンラインなら、FocusmapからMac側へタスクを投げて監視できる」機能と、「Codexアプリへ人間が手動でプロンプトを渡す」導線を混同しない。メモやマップの通常操作が、意図せずCodexへ裏側でプロンプト送信する状態を修正する。

## Scope

- `ai_tasks.dispatch_mode` / `executor='codex_app'` の作成分岐
- メモ詳細・マップノード詳細のCodex送信UI
- Mac runner / Codex app-server送信の起動条件
- `docs/CONTEXT.md` の仕様更新

## Non-goals

- Codex app-server自体の仕様変更
- 本番DBスキーマ変更
- push / deploy

## Plan

1. 仕様文書と直近アーカイブから、手動ハンドオフとMac経由auto実行の意図を確認する。
2. UI/API/runnerで `dispatch_mode` と `manual_handoff` がどの条件で選ばれるか確認する。
3. 意図せず裏側送信している分岐を止め、明示的なMac実行だけがautoになるよう修正する。
4. ステータス表示とdocsを実装に合わせる。
5. 型検査/関連テスト/差分確認後にコミットする。

## Parallelization

Decision: `SINGLE_CHAT`

Codex状態契約、API作成分岐、UI表示、runnerが同じ意味論を共有しているため、分割すると再び仕様ずれが起きやすい。単一チャットで調査・実装・検証する。

## Verification

- `npm run lint -- <touched files>` またはプロジェクトの実行可能な検証
- 関連ユニットテスト
- `git diff --check`

## Result

完了。

調査結果:

- 仕様正本として読むべき `docs/specs/codex-app-handoff-monitoring/01-overview-and-flow.md` と `docs/CONTEXT.md` の旧記述では、通常のCodex導線は manual handoff で、人間がCodex.app側で送信する前提だった。
- 直近の `TASK-20260607-017` / `018` / `019` / Mac統合planで、Mac local supervisor ready時に `dispatch_mode='auto'` を優先する方向へ仕様が上書きされ、メモ詳細・マップノード詳細・リンクメモ詳細の通常操作が自動dispatchへ寄っていた。
- `scripts/focusmap-agent/src/executors/codex-app.ts` は実際にCodex app-serverへ `thread/start` / `turn/start` を呼ぶため、これは単なる表示文言ではなく、裏側でプロンプトを送る実装になっていた。
- 目的の「Macが起きていればFocusmapアプリ/スマホからMac側状態を監視できる」土台はある。MacアプリSupervisor、focusmap-agent heartbeat/claim loop、Codex app-server起動、watch API、Turso/Supabase snapshotは実装済み。ただし、single monitorへの完全一本化とUI read-only polling整理は親タスク `TASK-20260607-004` の残作業。

修正:

- メモ詳細、マップノード詳細、リンクメモ詳細、マップクイックメニューの通常Codex導線を `executor='codex_app'` / `dispatch_mode='manual'` に戻した。
- Focusmapの通常操作は、追跡task作成、promptコピー、Codex.app/ChatGPT Codex入口を開くところまでに限定した。最終送信はCodex側で人間が行う。
- 既存manual handoffの通常UIから `Macへ再送` で `dispatch_mode='auto'` へ昇格する導線を削除した。
- `docs/CONTEXT.md` とMac統合planを、manual handoff標準、自動 `thread/start` / `turn/start` は明示的auto導線だけ、という仕様へ更新した。

検証:

- `npx eslint src/components/wishlist/wishlist-view.tsx src/components/wishlist/wishlist-card-detail.tsx src/components/wishlist/wishlist-card-detail.test.tsx src/components/codex/codex-node-panel.tsx src/components/mindmap/mindmap-linked-memos-dialog.tsx src/components/mindmap/custom-mind-map-view.tsx src/components/mindmap/custom-mind-map-view.test.tsx`
- `npm run test:run -- src/components/wishlist/wishlist-card-detail.test.tsx src/components/mindmap/custom-mind-map-view.test.tsx src/lib/codex-app-launch.test.ts src/lib/codex-run-state.test.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- Browser `http://localhost:3001/dashboard` でdashboard表示・console error 0、マップクイックメニューに `Codexを開く` が表示され、`Codexに送る` / `Macへ再送` / `Codex実行をキューに追加しました` が出ないことを確認。
