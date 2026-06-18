# Codex実行中進捗の回収復旧

## Goal

前回の再開検知高速化後に、実行中なのに状況更新が拾われにくくなった退行と、AI履歴取り込みが遅く見える問題を直す。

## Cause

- 確認待ちcheckpoint後に `reasoning` / `function_call` / tool output だけが続く場合、Codex.app上は実行中でもFocusmap側は `task_complete` 後の `awaiting_approval` へ残ることがあった。
- 実行中taskを優先するために孤立thread取り込みを止めすぎ、AI履歴の新規カードが表示されるまで遅くなった。
- Codexチャット取り込みサイドバーを開いていても、詳細panel未表示だとtask-progress snapshotが通常周期へ戻り、表示更新が最大45秒待ちになり得た。

## Fix

- rollout JSONLの `reasoning` / `function_call` / `custom_tool_call` / tool output / `patch_apply_end` を軽い実行中activityとして扱い、`latestRunningActivityAt` と `current_step` を更新する。
- 確認待ちcheckpoint後に新しい実行中activityがある場合は、アプリ再起動後でも `running` へ復帰させる。`task_complete` が最新なら従来通り `awaiting_approval` へ戻す。
- fast laneは `running` / `awaiting_approval` / `needs_input` / pending archive taskに限定し、古いlinked taskを毎tick先頭で読み続けない。
- `running` taskがある間も孤立thread hot importを最大3件だけ継続し、広いreconcileと低優先度post-import同期だけ後ろへ回す。
- Codexチャット取り込みサイドバーを開いている間は `useTaskProgressSnapshot` の `detailOpen` 相当として扱い、表示更新を短周期pollにする。

## Verification

- `npm run test:run -- scripts/focusmap-agent/codex-thread-monitor.test.ts src/components/dashboard/mind-map.test.tsx --test-timeout=30000`
- `npx eslint scripts/focusmap-agent/src/codex-thread-monitor.ts scripts/focusmap-agent/codex-thread-monitor.test.ts src/components/dashboard/mind-map.tsx src/components/dashboard/mind-map.test.tsx`
- `git diff --check`
- Macアプリ同梱agentを再ビルド・再インストールし、同梱distと起動ログで新しい監視コードを確認する。
