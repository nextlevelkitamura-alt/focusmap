# Agent Chat Parent Answer Only

- Task ID: TASK-20260620-003
- Status: completed
- Created: 2026-06-20
- Completed: 2026-06-20
- Board: `docs/ai/task-board.md`

## Goal

通常チャットではサブエージェント/内部ツールの細かい作業ログをカードや会話として見せず、親チャット1つの全体ステータスと最終回答だけをユーザーへ表示する。

## Scope

- `src/components/chat/unified-chat.tsx`
- `src/lib/ai/agent-chat-background.ts`
- 必要に応じて `src/hooks/useAgentChatSessions.ts`
- `docs/CONTEXT.md`
- task-router 記録ファイル

## Non-goals

- `ai_tasks` / Codex履歴取り込みカードのDB構造変更
- サブエージェント単位の新規テーブル追加
- 個別子作業のリアルタイム進捗UI追加
- テスト/lint/build/browser確認の自動実行

## Plan

1. 通常チャット表示で `metadata.focusmapAgentProgress=true` の内部progressメッセージを描画対象から外す。
2. 実行中は親チャットの1行ステータスだけを出し、細かいツール名/子作業名は出さない。
3. agent system promptへ、内部作業ログを最終回答へ羅列しない方針を明記する。
4. 履歴・空状態判定もユーザー/assistantの可視メッセージ基準に寄せる。
5. `docs/CONTEXT.md` に仕様として固定する。

## Parallelization

SINGLE_CHAT。

理由: 通常チャットの表示・保存・プロンプト方針が同じUI契約に閉じており、複数worktreeへ分けるとprogress metadataの扱いがズレやすい。

## Verification

- ユーザー明示がないため `npm run test:run` / lint / build / Browser確認は実行しない。
- 差分確認のみ行う。

## Result

- `UnifiedChat` は `metadata.focusmapAgentProgress=true` の内部progressメッセージを保存したまま、通常会話の描画・履歴の空判定から除外する。
- 完了済み/実行中のツールpartは通常チャットに個別カードとして出さず、承認が必要なtool approvalだけを表示対象に残す。
- 実行中表示は親チャットの `作業中` + 経過秒数へ丸め、最終assistant回答と必要な明示アクションだけをユーザーへ見せる。
- agent system promptへ、内部ツール/サブ作業ログを最終回答へ羅列しない方針を追加した。

## Links
