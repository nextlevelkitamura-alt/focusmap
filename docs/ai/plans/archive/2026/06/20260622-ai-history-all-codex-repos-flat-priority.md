# AI履歴 全Codexリポ1本化と優先表示

## 背景

AI履歴サイドバーの `全体` は、Focusmap内の現在project repoではなく、Codex.app sidebarに存在する全cwd/repoの履歴を見たい用途で使われている。agentのmetadata同期が有効repo scope寄りだと、`Private` や `side-business` のようなCodex.app側に存在するcwdが未同期になり得る。またrepo picker選択がproject repo設定変更へつながると、表示フィルタと設定変更の責務が混ざる。

## 実装結果

- AI履歴サイドバーの初期表示を `scope=global` / `repo=all` に変更し、全Codex履歴を1本のフラットリストで表示するようにした。
- repo pickerは表示フィルタだけにし、projectの `repo_path` 変更は右上の設定ボタンから設定画面で行う境界へ戻した。
- 一覧は `running` を最優先、その次に最新の確認待ち/返信待ち、それ以外を最新順にした。
- `completed` / `done` は通常一覧から非表示にし、未配置/マインドマップのタブ構造と未配置の既配置非表示は維持した。
- 一覧の時刻表示は従来通り `lastActivityAt` の相対表示（例: `3分前`）を使い、同期/保存時刻を主表示にしない。
- `focusmap-agent` のAI履歴metadata hot-syncはCodex SQLiteの全cwdを対象にし、Focusmapの有効repo scope外のcwdは `project_id=null` の履歴としてTursoへ保存するようにした。

## 検証

- `npm run test:run -- src/components/dashboard/codex-chat-import-sidebar.test.tsx scripts/focusmap-agent/codex-thread-monitor.test.ts --test-timeout=30000`
- `npx eslint src/components/dashboard/codex-chat-import-sidebar.tsx src/components/dashboard/codex-chat-import-sidebar.test.tsx scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `git diff --check`
- Macアプリはfocusmap-agent同梱変更のため `npm run mac:build:install` 対象。
