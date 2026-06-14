# マップ右上チャット導線と中央スターター

- Task ID: TASK-20260614-001
- Status: completed
- Created: 2026-06-14
- Completed: 2026-06-14
- Board: `docs/ai/task-board.md`

## Goal

モバイルのマップ右上から、選択中プロジェクトのチャットを新規開始できるようにする。チャット開始前の中央に `マインドマップを整理` / `AI実行を整理` / `メモから作成` / `リポジトリを読む` のスターターを置き、各スターターはプロジェクト概要・蓄積コンテキスト・マップ概要を読んだ前提で会話を始める。

## Scope

- `src/components/ai/mobile-ai-map-view.tsx`
- `src/components/ai/mobile-ai-execution-view.tsx`
- `src/app/dashboard/dashboard-client.tsx`
- `src/components/chat/unified-chat.tsx`
- `docs/CONTEXT.md`

## Non-goals

- マインドマップDBの自動変更フロー追加
- 新規DBテーブル・マイグレーション
- Codex取り込み/看板の仕様変更
- 本番デプロイ

## Plan

1. モバイルマップ右上の `メモからマップを作成` Sparkles ボタンを、プロジェクトチャットを開く MessageCircle ボタンへ置き換える。
2. Dashboard側で「マップからチャットを開いた」起動要求を保持し、`UnifiedChat` が該当プロジェクトスコープで新規空セッションを作る。
3. `UnifiedChat` の空状態に中央スターターを追加し、入力欄の `+` メニューから常設テンプレを外す。
4. 各スターターのプロンプトを、概要・マップ・AI実行・メモ・リポジトリを読む順番と承認前提の会話フローに合わせる。
5. 仕様変更を `docs/CONTEXT.md` に追記し、lint/test/build範囲で検証する。

## Parallelization

SINGLE_CHAT。UI起点、チャットスコープ、スタータープロンプト、仕様記録が同じ契約に依存するため分割しない。

## Verification

- `npm run test:run -- src/components/ai/mobile-ai-map-view.test.ts`
- `npx eslint src/app/dashboard/dashboard-client.tsx src/components/ai/mobile-ai-execution-view.tsx src/components/ai/mobile-ai-map-view.tsx src/components/chat/unified-chat.tsx src/hooks/useAgentChatSessions.ts`（既存warningのみ、error 0）
- `npm run lint` は既存の全体lintエラーで失敗（今回差分外の `mobile/` require import、既存 `any`、React hooks purity 等）
- `curl -I http://localhost:3001/dashboard` / `curl -I http://localhost:3001/dashboard?view=map` が 200
- dev server `http://localhost:3001` は今回worktreeで起動済み。in-app browser は unavailable、Playwright MCP は既存セッション競合のため視覚スクリーンショットは未取得

## Result

- モバイルマップ右上のSparkles直接生成ボタンをプロジェクトチャットを開く `MessageCircle` ボタンへ置換した。
- マップから開いた時は選択中プロジェクトの `project:<id>` スコープへ切り替え、`chatMode='project'` / `projectId` / `spaceId` 付きの新規空セッションを作る。
- `UnifiedChat` の空状態中央に `マインドマップを整理` / `AI実行を整理` / `メモから作成` / `リポジトリを読む` のスターターを追加し、入力欄左の `+` メニューから常設テンプレを外した。
- 各スターターのプロンプトは、プロジェクト概要・蓄積コンテキスト・マップ見出しを読み、DB変更前に会話で整理案を返し、追加したい項目や移動候補を聞ける流れにした。
- `docs/CONTEXT.md` に新しいUI/フロー契約を追記した。

## Links
