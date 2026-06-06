# Codex prompt copy handoff

Task ID: TASK-20260606-007
Started: 2026-06-06
Mode: SINGLE_CHAT
Completed: 2026-06-06

## Goal

Codex.app manual handoffで、日本語プロンプトが文字化けする経路を避け、送信後にまだ実行中へ進んでいない間はユーザーが確実にプロンプトを再コピーできるようにする。

## Scope

- `codex://` URLへprompt本文を載せない
- ブラウザ/ローカルAPIのコピー処理を共有化する
- ノード詳細、リンクメモ詳細、メモ詳細、Codex看板詳細で未送信中のコピー導線を維持する
- `docs/CONTEXT.md` のCodex.app連携仕様を更新する

## Verification

- `npm run test:run -- src/lib/codex-app-launch.test.ts`
- `npm run test:run -- src/components/wishlist/wishlist-card-detail.test.tsx`
- `npm run lint -- src/lib/codex-app-launch.ts src/components/codex/codex-node-panel.tsx src/components/wishlist/wishlist-view.tsx src/components/wishlist/wishlist-card-detail.tsx src/components/mindmap/mindmap-linked-memos-dialog.tsx src/components/task-progress/task-progress-detail-panel.tsx src/app/api/codex/open-repo/route.ts`
- `git diff --check`
- Browser `http://localhost:3001/dashboard` console error 0
- Browser fixture `http://localhost:3001/dashboard?taskProgressFixture=1` でCodex看板詳細の `プロンプトをコピー` 表示と `コピー済み` feedbackを確認
- `npx tsc --noEmit --pretty false` は既存 `src/app/login/page.tsx` の `focusmapDesktop` 型衝突だけで失敗
