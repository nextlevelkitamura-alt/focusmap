# task-runner retirement inventory

Focusmap の通常実行責務は `focusmap-agent` を正とし、`scripts/task-runner.ts` は legacy/debug の比較対象へ縮退する。

## focusmap-agent へ移管済み

- Runner registration / claim: `/api/agents/heartbeat` と `/api/agents/claim` を agent token で使う。service role key は Mac に置かない。
- 通常 task execution: `playwright`, `browser`, `terminal`, `simple` と `codex_app` を `scripts/focusmap-agent/src/executor.ts` で扱う。
- Codex.app auto start: `scripts/focusmap-agent/src/executors/codex-app.ts` が Codex.app WebSocket に送信する。
- Codex monitoring: `scripts/focusmap-agent/src/codex-thread-monitor.ts` が running / awaiting_approval / completed / archive を監視する。
- Codex thread import: `import-thread` / `import-scopes` API と Codex state DB の freshest path selection を使う。
- AI history hot-sync: focusmap-agent が active task / import scope / global Codex head を `batch-upsert` する。
- Detail hydrate: `detail-hydrate-requests` API の要求を agent が Codex rollout から復元する。

## 今回移管

- Repo availability: 旧 `available_repos` table sync ではなく、agent heartbeat の `available_repo_keys` / `repo_paths` へ `.git` 発見結果を載せる。
- Recurrence for synchronous local tasks: `browser` / `terminal` / `playwright` / `simple` は完了後に `status=pending`, `scheduled_at=next`, `completed_at=last_run` へ戻す。

## 移管しない / 廃止候補

- `staff-status-schedule`: `/Users/kitamuranaohiro/Private/仕事/scripts/staff-status` 固定の個人用実行責務。汎用 agent へは混ぜない。
- Claude `claude -p` / Remote Control / Terminal.app interactive launch: Claude 系は通常 executor として advertise しない。必要なら別 adapter として再設計する。
- Package cache / package execution: `~/.focusmap/ai-packages` と `ai_runner_package_cache` の同期は未移管。package executor は legacy blocker。
- `available_repos` table scanner: Webの古い補助経路用。通常 runner eligibility は `ai_runners.available_repo_keys` / `repo_paths` を使う。
- Legacy Codex monitor: `FOCUSMAP_LEGACY_CODEX_MONITOR` / `FOCUSMAP_ENABLE_LEGACY_CODEX_MONITOR` を立てた時だけ旧runnerで使う debug 経路。

## Interval / flush

- claim loop: 3秒。
- Codex monitor loop: 1秒。
- Codex monitor target refresh: 3秒。
- heartbeat: active 5秒 / idle 30秒。full registration は active 60秒 / idle 10分。
- repo scan cache: 5分。scan自体は8秒でfallbackする。
- AI history detail hydrate: 5秒。
- AI history reconcile: デフォルト60分。hot-sync は active/import scope/global head で短周期に差分同期する。

## 3秒測定に必要なログ / metadata

- agent起動ログ: `focusmap-agent ready. runner_id=...`
- task claim / completion / rescheduleログ: `task <id> completed` または `task <id> rescheduled -> <iso>`
- Codex monitor target refresh: heartbeat metadata の `codex_thread_monitor=true`, `codex_thread_import_scopes_api_path`, `codex_thread_import_api_path`
- AI history反映確認: heartbeat metadata の `codex_orphan_thread_import=true` と API側の `batch-upsert` / detail hydrate レスポンス
- repo scan: heartbeat metadata の `repo_availability_source=focusmap-agent-heartbeat`, `repo_scan_found_count`, `repo_scan_truncated`

## Fallback 条件

- repo scan が8秒以内に終わらない、または対象パスが読めない場合は直近cache、初回だけ repo候補なしで heartbeat を継続する。
- recurrence cron の計算に失敗した場合は翌日同時刻へ fallback し、`result.meta.recurrence_fallback_reason` に理由を残す。
- Codex.app recurring task の「承認/完了後の再投入」は今回未移管。Codex監視の terminal state 側へ別途入れるまで、recurrence は同期完了できる executor に限定する。
- staff-status / Claude / package が現役で必要な場合は旧runnerを legacy/debug として残すか、別 adapter の要件を切る。
