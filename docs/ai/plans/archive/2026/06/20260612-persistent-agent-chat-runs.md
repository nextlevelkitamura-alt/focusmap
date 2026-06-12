# Persistent Agent Chat Runs

Date: 2026-06-12
Task: TASK-20260612-008
Status: completed

## Goal

チャット送信後にユーザーが別画面へ移動、アプリ終了、再起動しても、会話履歴と実行状態を復元できるようにする。通常の統合チャットは、フロントのストリーミング接続ではなく、DB上のセッション状態を正として扱う。

## Scope

- `UnifiedChat` の通常送信を、DB永続化された非同期runへ切り替える。
- Supabaseに統合チャット用セッションテーブルを追加する。
- サーバー側で `running` を保存して即時応答し、Next `after()` でAI実行を続けて結果を保存する。
- UIは履歴・実行中・完了・失敗をDBから復元し、実行中セッションはpollする。
- 既存の `/api/ai/agent` ストリーミングAPIは互換のため残す。

## Non-goals

- Codex.appやローカルファイル操作を完全クラウド化しない。Mac依存ツールは既存のMac agent接続状態に従う。
- ツール実行の細かなストリーミング表示やキャンセル機能は今回の対象外。
- 既存localStorage履歴の完全な一括移行は対象外。DBが使えない場合の表示キャッシュとして残す。

## Acceptance

- 送信直後にセッションが `running` としてDBへ保存される。
- 画面を離れて戻っても、同じ履歴に `考え中` 相当の実行中状態が復元される。
- サーバー側run完了後、同じセッションにアシスタント返信が保存され、画面復帰時に表示される。
- 失敗時は `failed` とエラー文を保存し、UIで再送可能な状態にする。
- `docs/CONTEXT.md` に新しいチャット永続実行仕様を追記する。

## Verification

- `npx eslint src/components/chat/unified-chat.tsx src/hooks/useAgentChatSessions.ts src/app/api/ai/agent/runs/route.ts src/app/api/ai/agent/sessions/route.ts 'src/app/api/ai/agent/sessions/[id]/route.ts' src/lib/ai/agent-chat-background.ts`（既存 `<img>` warningのみ、error 0）
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `curl -I --max-time 10 http://localhost:3001/dashboard` 200
- Browser `http://localhost:3001/dashboard?view=ai&desktop=0&v=persistent-chat-runs` でチャット画面DOM、履歴サイドバー、入力欄placeholderを確認
- `/api/ai/agent/sessions` / `/api/ai/agent/runs` は接続先DBに `agent_chat_sessions` migration未適用のため PGRST205 で停止することを確認。migration適用後に実送信のE2E確認が必要。
