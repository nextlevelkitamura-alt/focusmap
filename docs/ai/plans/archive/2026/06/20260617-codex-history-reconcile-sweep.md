# Codex履歴取りこぼし照合

## 目的

Codex.appをFocusmap画面が開いていない間に使った場合や、短い実行・worktree実行で取り込みが遅れた場合でも、Mac常駐agentがローカルCodex履歴を定期照合して未取り込みthreadを補完する。

## 方針

- 通常監視は1秒間隔のまま、直近履歴を軽く見る。
- 起動時、監視scope初回取得時、監視scope変更時は広めのreconcileを即時実行する。
- 以後は60秒ごとにreconcileを実行し、`enabled_since` 以降または直近windowの未取り込みthreadを探す。
- import対象は監視ONのproject repoと同一Git repoのworktreeに限定する。
- 重複防止は既存の `codex_thread_id` とimport APIの冪等性を正にする。
- promptがCodex state DBへ保存される前は検知できないため、保存後にagentが拾う設計にする。

## 受け入れ条件

- agent起動直後に未取り込みCodex threadの照合が走る。
- 監視ON/OFFやrepo scope変更後に次回tickでreconcileが走る。
- 通常稼働中は60秒ごとにreconcileが走る。
- 通常1秒監視は過去全量を毎回読まず、直近window中心にする。
- `docs/CONTEXT.md` にタイミングと責務を反映する。

## 実装範囲

- `scripts/focusmap-agent/src/codex-thread-monitor.ts`
- `scripts/focusmap-agent/src/cli.ts`
- `scripts/focusmap-agent/codex-thread-monitor.test.ts`
- `docs/CONTEXT.md`
- `docs/ai/task-board.md`
- `docs/ai/task-runs.jsonl`
