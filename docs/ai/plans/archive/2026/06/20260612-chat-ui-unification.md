# チャット画面UI統合

- Task ID: TASK-20260612-007
- Status: completed
- Created: 2026-06-12
- Completed: 2026-06-12
- Board: `docs/ai/task-board.md`

## Goal

モバイルのチャット画面をChatGPT風の全画面体験へ寄せ、片手で履歴表示・新規チャット作成・送信を扱えるようにする。自動化専用チャットは通常導線から外し、1つのチャットへ統合する。Mac online/offline はチャット画面内で常に確認できるようにする。

## Scope

- `src/components/chat/unified-chat.tsx`
- `src/app/dashboard/dashboard-client.tsx`
- `docs/CONTEXT.md`
- `docs/ai/task-board.md`
- `docs/ai/task-archive/2026/06.md`
- `docs/ai/task-runs.jsonl`

## Non-goals

- AI agent / `ai_tasks` / Mac runner の実行ロジック変更
- DB schema 変更
- ChatGPT/Codex外部アプリ起動導線の変更

## Plan

1. `UnifiedChat` から `チャット` / `自動化` セグメントを外し、単一チャット画面へ統合する。
2. モバイルは左端スワイプと左端ハンドルで履歴シートを開けるようにする。
3. モバイル右下に新規チャット作成FABを置き、入力欄と下部ナビの安全域を避ける。
4. Mac online/offline/未接続/確認中をヘッダーと入力欄近くで確認できるようにする。
5. Dashboard の古い `automation` view は同じ `UnifiedChat` へ寄せる。
6. docs/CONTEXT と task-router 記録を更新し、lint/typecheck/画面確認後にコミットする。

## Parallelization

`SINGLE_CHAT`。チャット画面のUX、古い導線統合、仕様ドキュメントが同じUI契約に依存するため、分割せず同じチャットで実装・検証・記録する。

## Verification

- `npm run lint -- src/components/chat/unified-chat.tsx src/app/dashboard/dashboard-client.tsx src/contexts/ViewContext.tsx src/lib/dashboard-preload.ts`（既存warningのみ、error 0）
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- Browser/iAB `http://127.0.0.1:3001/dashboard?view=ai&desktop=0&v=chat-ui-mobile` 390x844相当でDOM確認。単一チャット、Mac状態、左端履歴取っ手、右下新規チャットFAB、入力欄、下部ナビの非横スクロールを確認。console は Service Worker on 127.0.0.1 と realtime fallback warning のみ。

## Result

- `UnifiedChat` から `チャット` / `自動化` セグメントを削除し、1つのチャット画面へ統合した。
- モバイル左端スワイプ/取っ手で履歴シートを開き、シート右下と通常画面右下から新規チャットを作れるようにした。
- Mac online/offline/未接続/確認中をヘッダーと入力欄上で表示し、online以外の送信説明を予約送信へ寄せた。
- Dashboard の古い `automation` view とプリロードを同じ `UnifiedChat` 系へ寄せ、`view=automation` は `ai` へ正規化するようにした。
- `docs/CONTEXT.md` と既存統合チャット計画を単一チャット方針へ更新した。

## Links

- User screenshots: ChatGPT-style history list and current Focusmap chat screen
