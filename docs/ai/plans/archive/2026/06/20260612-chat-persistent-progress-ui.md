# 永続チャットの進行ログ復活

- Task ID: TASK-20260612-010
- Status: completed
- Created: 2026-06-12
- Completed: 2026-06-12
- Board: `docs/ai/task-board.md`

## Goal

`agent_chat_sessions` による裏側の永続実行を維持しつつ、チャット画面にも「何をしているか」が見える進行ログを戻す。送信後に画面を開いたままでも、閉じて戻ってきても、DB上の `running` / `completed` / `failed` とツール進行が表へ反映される状態にする。

## Scope

- `UnifiedChat` の実行中表示を点滅する `考えています` にする。
- `/api/ai/agent/runs` の背景実行中にツール開始/完了/失敗を `agent_chat_sessions.messages` へ軽量progressメッセージとして保存する。
- UIはprogressメッセージを通常assistant本文ではなくログ行として表示する。
- `useAgentChatSessions` はRealtimeを購読し、pollをfallbackとして維持する。
- モデルへ渡す会話履歴からprogressメッセージを除外する。
- `docs/CONTEXT.md` と統合チャット計画を更新する。

## Non-goals

- 新しいDBテーブルやカラムは追加しない。
- ツール出力の全文や秘密情報になり得る入力値をprogressログへ保存しない。
- キャンセル機能や承認UIの新規実装は含めない。

## Plan

1. progressメッセージ用の共有helperを追加する。
2. 背景runのAI SDK tool lifecycle callbackでprogressをDB保存する。
3. セッションhookにRealtime購読とprogress除外/正規化を追加する。
4. `UnifiedChat` にprogressログ行と点滅thinking表示を追加する。
5. docsとtask-router記録を更新し、lint/typecheck/test/画面確認を行う。

## Parallelization

`SINGLE_CHAT`。`UnifiedChat`、背景run、セッション復元、docsが同じ永続チャット契約を共有するため、分割すると状態表現がずれる。

## Verification

- `npm run test:run -- src/lib/ai/agent-chat-progress.test.ts src/lib/ai/agent-chat-db.test.ts`
- `npx eslint src/lib/ai/agent-chat-progress.ts src/lib/ai/agent-chat-progress.test.ts src/lib/ai/agent-chat-db.ts src/lib/ai/agent-chat-db.test.ts src/lib/ai/agent-chat-background.ts src/app/api/ai/agent/runs/route.ts src/app/api/ai/agent/sessions/route.ts src/hooks/useAgentChatSessions.ts src/components/chat/unified-chat.tsx`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `curl -I --max-time 10 http://localhost:3001/dashboard`
- `curl -sS --max-time 10 'http://localhost:3001/api/ai/agent/sessions?scope_key=general'` -> `{"sessions":[],"dbReady":false}`
- Playwright `http://localhost:3001/dashboard?view=ai&desktop=0&v=chat-progress-ui-final`: title `ダッシュボード | Focusmap`, console error 0
- Playwright 390x844 mobileで下部ナビから `チャット` を開き、チャットヘッダー/入力欄/下部ナビ表示、console error 0

## Result

永続チャット実行中のツール開始/完了/失敗を `agent_chat_sessions.messages` へ軽量progressメッセージとして保存し、`UnifiedChat` では通常本文と分けてログ行表示するようにした。DB更新はRealtimeで即時反映し、3秒pollをfallbackとして維持する。モデルへ再投入する履歴からprogressメッセージは除外するため、ログ表示が次回回答文脈を汚さない。実行中の `考えています` 表示は点滅とドットpulseに変更した。

現ローカル環境では `agent_chat_sessions` がSupabase側schema cacheに未反映で `dbReady:false` だったため、一覧APIは500にせず空履歴で画面表示を維持し、送信開始APIは503の明示エラーを返すようにした。これによりDB未準備時でも「考えています」が固着しない。

## Links

- `docs/CONTEXT.md`
- `docs/plans/active/unified-agent-chat.md`
