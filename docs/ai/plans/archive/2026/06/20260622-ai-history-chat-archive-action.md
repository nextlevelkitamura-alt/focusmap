# AI履歴チャットアーカイブ操作

- Task ID: TASK-20260622-002
- Status: completed
- Created: 2026-06-22
- Completed: 2026-06-22
- Board: `docs/ai/task-board.md`

## Goal

AI履歴カードの削除ボタンを「チャットをアーカイブ」操作へ置き換え、Codex.app側のthread archiveをMac agent経由で確実に依頼できるようにする。

## Scope

- AI履歴カードのアーカイブUI
- AI履歴archive API
- pending archive requestのAI履歴一覧除外
- Mac agentのpending archive request判定
- AI履歴archive仕様のdocs更新

## Non-goals

- 物理削除
- Codex.appをWeb/Cloud Runから直接操作する仕組み
- AI履歴schema migration
- push/deploy

## Plan

1. `POST /api/ai-history/[id]/archive` を追加し、対象history itemのCodex threadに対するpending archive requestを`ai_tasks`へ保存する。
2. `/api/ai-history` の通常一覧は、pending archive request中のthreadを除外する。
3. Mac agentのmonitor task抽出・完了処理を、`ai_history_archived`由来のarchive requestでも動くようにする。
4. サイドバーのカード操作は、右端のarchiveアイコンから展開し、押下時に「チャットをアーカイブ」表示へ変わるUIにする。
5. `docs/CONTEXT.md` とtask-router記録を更新する。

## Parallelization

SINGLE_CHAT。UI/API/agentの契約が強く結合しているため、同じチャットで順次実装する。

## Verification

ユーザー明示がないため、自動テスト/lint/build/browser確認は実行しない。差分確認と自分の変更範囲確認のみ行う。

## Result

- `POST /api/ai-history/[id]/archive` を追加し、AI履歴itemのCodex threadに対するpending archive requestを `ai_tasks` に作成するようにした。
- `/api/ai-history` はpending archive request中の `external_thread_id` を一覧・件数から除外する。
- `focusmap-agent` と互換 `scripts/task-runner.ts` は、`codex_archive_request_reason='ai_history_archived'` をsource task無しのpending archiveとして扱い、Codex thread archive完了時にarchive依頼taskだけを完了化する。
- サイドバーの右端操作は削除ボタンではなくArchiveアイコンに変更し、1回目で `チャットをアーカイブ` へ展開、展開後クリックでAPIを呼び楽観的にカードを非表示にする。
- `docs/CONTEXT.md` にAI履歴アーカイブ操作の正本仕様を追記した。

## Verification Result

- 自動テスト/lint/build/browser確認は未実行（ユーザー明示なし。AGENTS.mdの自動検証ポリシーに従う）。
- `git diff` / `git status` による差分確認のみ。
