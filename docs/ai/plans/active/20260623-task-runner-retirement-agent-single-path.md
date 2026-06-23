# task-runner退役 / focusmap-agent一本化フェーズ

- Task ID: `TASK-20260607-004`
- Status: `in_progress`（Planner完了、実装前）
- Created: `2026-06-23`
- Parent plan: [20260607-codex-mac-agent-unification.md](20260607-codex-mac-agent-unification.md)
- Board: `docs/ai/task-board.md`

## 目的

旧 `scripts/task-runner.ts` を通常運用から退役させ、Mac側の通常実行・Codex監視・状態同期の正本を `scripts/focusmap-agent` に一本化する。Cloud RunはWeb/APIのNext.js serverであり、ローカル常駐runnerではないことを前提にする。

このフェーズでは実装前に、残務、削除条件、3秒同期の受け入れ条件、worker分割、Integration条件を固定する。Plannerチャットでは `src/**`、`scripts/**`、`desktop/**` は変更しない。

## 非対象

- このPlannerフェーズでは実装、テスト実行、launchd停止、Mac実機操作、Cloud Run確認をしない。
- `task-runner` の即削除はしない。repo scan、staff-status、scheduled/package実行などの残務が移管または明示廃止されるまで、互換/debugとして残す。
- `docs/CONTEXT.md` は実装方針や同期方式が実際に変わる実装worker/Integrationで更新する。このPlannerでは更新対象だけを明記する。

## 現状メモ

- `focusmap-agent` は `startClaimLoop` で3秒claim poll、`startCodexThreadMonitorLoop` で1秒Codex thread monitor、3秒target refreshを持つ。
- `focusmap-agent` の `executeTask()` は `executor='codex_app'` を `runCodexAppTask()` へ渡し、Codex app-serverへ `thread/start` / `turn/start` できる。
- `src/app/api/ai-tasks/schedule/route.ts` は、即時 `codex_app` auto taskで `scripts/task-runner.ts --task-id ... --fast` をspawnしている。通常経路から外す候補の中心。
- `desktop/focusmap-mac/main.cjs` は旧runnerを `FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` 明示時だけkickする設計に寄せている。ただし `ensureAutomationServices()` の結果にrunnerを含めるため、Integrationで「通常接続成功条件に旧runnerが混ざらない」ことを再確認する。
- `scripts/install.sh` は現行 `focusmap-agent` / `codex-app-server` launchd登録前に旧 `com.focusmap.task-runner` を停止する。一方、`scripts/setup.sh` と `scripts/com.focusmap.task-runner.plist` は旧task-runnerを毎分インストールする導線のまま。

## task-runner責務棚卸し

| 責務 | 現在の主な実装 | 分類 | 残務 / 方針 |
|---|---|---|---|
| Codex送信 | `task-runner.ts` の `launchCodexRemote()`、`schedule/route.ts` の `requestImmediateCodexAppDispatch()` | `focusmap-agentへ移管済み` / `不要なので削除候補` | `focusmap-agent` に `runCodexAppTask()` があるため通常送信は移管済み。API workerは `task-runner.ts --fast` spawnを廃止し、`requestImmediateCodexAppDispatch()` と旧 `live_log` 文言を削除候補にする。 |
| Codex監視 | 旧runnerの `syncCodexLiveLogs()` / `syncCodexAppThreads()` / `syncActiveCodexFollowUps()`、agentの `codex-thread-monitor.ts` | `focusmap-agentへ移管済み` + `legacy/debugとして残す` | 通常writerはagent。旧runner監視は `FOCUSMAP_LEGACY_CODEX_MONITOR=1` 明示時だけ。削除前に同一taskへの二重writerが無いことをIntegrationで確認する。 |
| repo scan | `task-runner.ts` の `scanAndSync()`、`user_scan_settings`、`available_repos`、`scan-settings/trigger` | `focusmap-agentへ移管が必要` | 設定UI/APIはまだ「task-runnerがスキャン」と説明している。Agent workerまたはAPI workerでagent command/claim経由へ移すか、Codex SQLite由来repo候補へ統合して旧scanを廃止する判断が必要。 |
| staff-status | `task-runner.ts` の `STAFF_STATUS_SCHEDULE_SKILL_ID`、`runStaffStatusScheduleTarget()`、stale復旧 | `未確認` / `focusmap-agentへ移管が必要` | `/Users/kitamuranaohiro/Private/仕事/scripts/staff-status` 依存の個別運用。通常Focusmap本体から切り離すか、focusmap-agentのscheduled/package executorへ移すまで `task-runner` ファイル削除は不可。 |
| scheduled task | `task-runner.ts` の due task取得、cron再計算、Claude/Terminal/package/staff実行 | `focusmap-agentへ移管が必要` | `codex_app` autoはagent claimで代替可能。Claude/Terminal/package/recurrence再スケジュールは移管状況が混在するため、削除前に対象skill/executorを棚卸しする。 |
| archive request | `task-runner.ts` の `syncCompletedFocusmapNodesToCodexArchive()`、agentの `hasPendingArchiveRequest()` + `archiveCodexThreadViaAppServer()` | `focusmap-agentへ移管済み` | Codex thread archiveはagent側に実装済み。旧runnerのarchive scanは互換/debugとして残し、通常では起動しない。 |
| live log / activity書き込み | 旧runnerの `result.live_log`、`pushCodexStep()`、agentの `activity_messages` / Turso snapshot | `focusmap-agentへ移管済み` + `legacy/debugとして残す` | 通常UIは `ai_task_activity_messages` / Turso activityを正にする。`result.live_log` は互換/debug表示のみ。API文言とテストで旧runner前提を外す。 |
| setup/install/launchd | `scripts/install.sh`、`scripts/setup.sh`、`com.focusmap.task-runner.plist`、Mac app supervisor | `focusmap-agentへ移管が必要` / `不要なので削除候補` | `install.sh` は旧launchd停止済み。`setup.sh` と旧plistはDesktop/Installer workerが通常導線から外す。旧plistはlegacy/debug資料として残すか削除するかをIntegrationで決める。 |

削除候補は、API内の即時旧runner spawn helper、通常UI/APIの旧runner文言、新規setupで旧plistを入れる処理、旧plist自体。`scripts/task-runner.ts` 本体は、repo scan / staff-status / scheduled taskの扱いが確定するまで削除候補ではなく `legacy/debugとして残す` に分類する。

## task-runnerを通常運用から外す削除条件

### 外してよい条件

- `src/app/api/ai-tasks/schedule/route.ts` と `src/app/api/ai-tasks/route.ts` が、通常の `codex_app` auto task作成時に `task-runner.ts --fast` をspawnしない。
- `focusmap-agent` が `codex_app` auto taskを3秒claim以内に `running` へ進め、Codex app-server送信失敗時は `failed` または `awaiting_approval` へ理由付きで遷移させる。
- `focusmap-agent` がCodex監視、追加prompt再開検知、`awaiting_approval` / `failed` / archive request反映、AI履歴metadata hot-syncを通常writerとして担当し、旧runnerを起動しなくても既存UIが読めるsnapshot/activityを作る。
- repo scanについて、`available_repos` / `user_scan_settings` を維持するならagent側移管が完了している。廃止するなら設定UI/API文言と代替repo候補の正本が決まっている。
- staff-status / Claude / package / recurrence taskについて、agentへ移管済み、別運用へ切り出し済み、または本体通常運用から廃止する判断が記録されている。
- `scripts/setup.sh` が新規に `com.focusmap.task-runner` をインストールしない。現行install導線は `focusmap-agent` とCodex app-serverを登録し、旧task-runner launchdを停止する。
- `docs/CONTEXT.md` と必要なら `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` が、runner間隔、writer所有者、データフロー、fallback条件を実装後の状態へ更新済み。

### 外してはいけない条件

- API routeがまだ `requestImmediateCodexAppDispatch()` で旧runnerをspawnしている。
- `setup.sh` が旧plistを通常インストールしている。
- repo scan UI/APIが「task-runnerが最大1分後にスキャン」と案内しており、代替agent scanが未実装。
- staff-statusの定期実行やstale復旧が実運用で必要だが、agent/別jobへ移っていない。
- package taskやClaude/Terminal scheduled taskが `task-runner` だけで動く状態のまま。
- `FOCUSMAP_LEGACY_CODEX_MONITOR=1` なしでも旧runner監視が通常起動しうる。

### fallbackとして残す条件

- `scripts/task-runner.ts` は最初の実装フェーズでは `legacy/debug` として残す。通常のMac app supervisor、install、API routeからは呼ばない。
- fallback起動はローカルMacで明示的に `FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` または `FOCUSMAP_LEGACY_CODEX_MONITOR=1` を設定した場合だけにする。
- fallbackを使う時は、`focusmap-agent` の同一task監視を止めるか、旧runner側のCodex監視を `FOCUSMAP_LEGACY_CODEX_MONITOR=1` のdebug用途に限定し、二重writerを避ける。
- Cloud Run、本番Web API、通常install導線はfallbackを起動しない。

## 3秒以内同期の受け入れ条件

対象はwarm path（Focusmap Mac app、`focusmap-agent`、Codex app-serverが起動済み、ページがvisible）とする。cold startや初回ログイン、Codex Desktop未導入、Full Disk Access不足は別枠で理由表示を合格条件にする。

このフェーズのSLOは2層に分ける。

- System sync: agent/DB/Turso snapshotの状態が、観測可能な入力またはCodex eventから3秒以内に更新されること。
- Visible sync: 画面表示中のactive taskは、ユーザー操作直後の楽観表示または即時refreshを含めて3秒以内に状態が変わって見えること。

単純に「agent claim 3秒 + UI poll 3秒」へすると、最悪6秒になり、今回の目的に合わない。UI workerは、送信直後・詳細open直後・active task検出直後に即時snapshot refreshを行い、その後のactive pollを3秒以内にする。外部Codex.appで直接開始したthreadのようにユーザー操作起点がFocusmap外にあるものは、System sync 3秒を優先し、Visible syncは次回active pollまたはAI履歴hot-sync表示までを測る。

| ケース | 受け入れ条件 | 測定方法 |
|---|---|---|
| タスク作成直後 | API response時点でUIは楽観表示または `pending` / `needs_input` を表示する。auto `codex_app` はagent claimまで最大3秒、manual handoffは即 `prompt_waiting`。 | browser `performance.now()`、API response `created_at`、`ai_tasks.status`、Turso snapshot `updated_at` を記録。 |
| `pending -> running` | `focusmap-agent` がclaimしてから3秒以内、またはtask作成から3秒以内に `started_at` とTurso snapshotが `running` になる。Focusmap画面から作ったtaskは、送信直後refreshを含めてvisible UIも3秒以内に `running` または理由付き待機状態へ進む。 | `~/.focusmap/logs/agent.log` の `claimed task`、`ai_tasks.started_at`、`/api/task-progress/snapshot` のserver_time、画面表示時刻を比較。 |
| `running -> awaiting_approval / completed / failed` | Codex rollout/app-serverのterminal signal検出から3秒以内にagentが状態変化をforce送信し、UIが3秒poll以内に表示する。archive requestによる `completed` も同じ。 | rollout `task_complete` / failure event時刻、agent `last_activity_at` / `awaiting_approval_at`、snapshot更新、画面表示を5試行で測る。 |
| `prompt_waiting` | manual handoff作成後、API responseまたは同一画面の状態更新で即表示。Codex.appで人間が送信した後、scope既知ならthread検出から3秒以内に `running` または `awaiting_approval` へ進む。 | API response status、handoff token、Codex SQLite `updated_at_ms`、agent初回thread保存時刻、UI状態を比較。 |
| Codex.app直接開始thread取り込み | 監視scope取得済みのrepo/worktreeでは、Codex thread更新から3秒以内にAI履歴metadataまたは既存task状態へ反映し、AI履歴UIの2秒poll/active UIの3秒pollで表示する。scope変更直後は、target refresh 3秒を含めて「監視反映待ち」を表示し、scope heartbeat後のthread更新から3秒以内を合格にする。 | Codex SQLite `threads.updated_at_ms`、agent heartbeat `codex_last_scope_refresh_at`、`ai_history_items.indexed_at`、UI表示時刻を比較。 |
| UI表示反映 | activeなCodex状態表示は3秒以内。idle/heartbeatだけの接続表示は30秒pollまたは復帰時即時取得の既存仕様を維持してよい。 | Network panelで `/api/task-progress/snapshot`、`/api/ai-history`、`/api/task-progress/runner-heartbeats` を分けて測る。 |

測定はIntegration workerが5回連続で行い、各ケースの最大値、平均、失敗時の該当ログを報告する。Planner時点では測定を実行しない。

## worker分割

Decision: `HYBRID_PLAN_THEN_PARALLEL`

API spawn廃止、agent残務移管、UI polling統一、Desktop/Installer整理は編集範囲が分かれるためworker分割できる。ただしrepo scan / scheduled taskの契約は共通なので、API workerとAgent workerはIntegrationが順に取り込む。

### API worker

- Allowed files: `src/app/api/ai-tasks/schedule/route.ts`, `src/app/api/ai-tasks/route.ts`, 必要なAPI tests、必要最小限の型/ヘルパー。
- 禁止ファイル: `scripts/**`, `desktop/**`, `docs/ai/task-board.md`, `docs/ai/task-runs.jsonl`, secrets, lockfile。
- 完了条件: 通常 `codex_app` auto作成で `task-runner.ts --fast` をspawnしない。`FOCUSMAP_DISABLE_LOCAL_CODEX_DISPATCH` / `FOCUSMAP_ENABLE_LOCAL_CODEX_DISPATCH` の扱いを整理し、文言を `focusmap-agent` に変更。manual handoffは `prompt_waiting` のまま。
- テスト観点: schedule APIのmanual/auto分岐、既存manual task promote、Turso mirror、Cloud Run上でローカルscript spawnが発生しないこと。
- Integrationへの報告: changed files、spawn廃止方式、残したenv flag、API response差分、追加/更新テスト、未移管リスク。

### Agent worker

- Allowed files: `scripts/focusmap-agent/**`, agent tests、必要なら agent API client/capabilities。
- 禁止ファイル: `src/components/**`, `desktop/**`, setup/install、task-board/run log/archive、lockfile。
- 完了条件: `codex_app` auto task claim、Codex monitor、archive request、AI履歴hot-syncが旧runnerなしで通常運用を満たす。repo scan / scheduled task / package / staff-statusを移す場合は契約を明示し、移さない場合は「legacy blocker」として報告。
- テスト観点: `codex-thread-monitor` のrunning/awaiting/failed/archive、AI履歴top20+scope別top20、claim後の`runCodexAppTask`、重複writer抑制。
- Integrationへの報告: 移管した責務、未移管責務、interval/flush変更、3秒測定に必要なログ、fallback条件、commit hash。

### UI worker

- Allowed files: `src/hooks/useTaskProgressSnapshot.ts`, `src/hooks/useMemoAiTasks.ts`, `src/hooks/useNoteAiTasks.ts`, `src/hooks/useAiTasks.ts`, `src/hooks/useAiHistory.ts`, Codex/AI履歴関連components/tests。
- 禁止ファイル: `src/app/api/**`, `scripts/**`, `desktop/**`, setup/install、task-board/run log/archive、lockfile。
- 完了条件: active Codex状態の表示pollを3秒以内へ揃え、表示中という理由で `/api/codex/sync-node` writeを起こさない。local `sync-node` は明示debug/manual fallbackだけに縮小。idle/heartbeat系は30秒/1時間など用途別に残してよい。
- テスト観点: running/awaiting/prompt_waiting/detail open/AI履歴open/visibility hiddenでpoll間隔とwrite API呼び出し有無を検証。
- Integrationへの報告: 変更したpoll interval、削除/残存したlocal sync、3秒表示の対象外にしたidleケース、UI risk。

### Desktop/Installer worker

- Allowed files: `desktop/focusmap-mac/**`, `scripts/install.sh`, `scripts/setup.sh`, `scripts/com.focusmap.task-runner.plist`, package scripts if required.
- 禁止ファイル: `src/app/api/**`, `scripts/focusmap-agent/**` の実行ロジック、secrets、lockfile、task-board/run log/archive。
- 完了条件: 通常のMac app supervisorとinstall/setupが旧task-runnerを起動・インストールしない。旧launchd停止/案内は維持。legacy/debugで残すなら明示envと手順だけにする。
- テスト観点: `node --check desktop/focusmap-mac/main.cjs`、plist lint、install/setupのdry-run観点、Mac app statusで旧runnerが接続必須条件に入らないこと。
- Integrationへの報告: 通常導線から外した箇所、旧plistを残す/削除する判断、既存ユーザーのunload案内、Mac実機確認手順。

### Docs/Test worker

- Allowed files: 対象テスト、`docs/CONTEXT.md` 更新案、必要なら関連spec。実装変更はしない。
- 禁止ファイル: 実装コード、secrets、task-runs/mistakes/analysis/archive。
- 完了条件: 実装workerの変更に対応するテスト計画とCONTEXT更新対象が具体化され、3秒測定手順が実行可能。
- テスト観点: unit/integration/manual/Cloud Run/3秒測定の抜け漏れ確認。
- Integrationへの報告: 更新すべきCONTEXTセクション、実行すべき検証コマンド、未確認リスク。

### Integration worker

- Allowed files: 各worker成果の統合に必要な最小範囲、`docs/CONTEXT.md`, `docs/ai/task-board.md`, 必要ならこの計画のResult追記。
- 禁止ファイル: unrelated refactor、force push/reset/clean、secrets、本番DB/GCP操作、lockfileの不要更新。
- 完了条件: 全workerのcommit/差分をlocal mainへ取り込み、通常運用から旧runnerが外れ、残すlegacy/debug条件がdocsに固定され、3秒同期測定結果を報告する。
- テスト観点: 下のテスト計画を、ユーザー明示に従って実行。Mac実機/Cloud Run確認はIntegrationで一括。
- 報告項目: merged commits、changed files、検証結果、3秒測定表、CONTEXT更新、残したlegacy/debug、未解決リスク、local main/origin/main/本番の反映状況。

## 推奨実装順

0. Preflight / Contract gate: API worker着手前に、`schedule/route.ts` が作る `ai_tasks` が `claim_ai_task_for_runner` の条件を満たすことを確認する。最低条件は `status='pending'`、`scheduled_at <= now()`、`executor='codex_app'`、`dispatch_mode='auto'`、runner heartbeat/executors/space権限一致。ここが曖昧なままspawnを外すと、旧runnerだけが拾っていたtaskが無反応になる。
1. API worker: `schedule/route.ts` の `task-runner.ts --fast` spawnを通常経路から外す。Cloud Runでは絶対にローカルscriptをspawnしないこと、ローカルでも通常はagent claimへ寄せることをテストで固定する。
2. Agent worker: Codex送信/監視/archiveのparityを固め、repo scan / scheduled / staff-status / packageの移管可否を実装または明確に残務化する。staff-statusのような個人運用は、プロダクト要件が確認できるまでfocusmap-agentへ安易に移植しない。
3. UI worker: active表示を3秒以内へ揃え、送信直後・詳細open直後・active task検出直後の即時refreshを入れる。`sync-node` write fallbackは通常UIから縮小する。
4. Desktop/Installer worker: `setup.sh` の旧launchd導線を外し、Mac app status/installerで旧runnerを通常接続条件にしない。
5. Docs/Test worker: 実装後のCONTEXT更新案、テスト観点、3秒測定表を整える。
6. Integration worker: local mainへ統合し、必要な検証をまとめて実行し、旧launchd停止タイミングを最終判断する。

## 2026-06-23 Integration進捗

- local mainへAPI worker commit `cca30fe1`、heartbeat follow-up commit `8925398e`、compile fix commit `b831bf42` を取り込み済み。
- API worker範囲では、`/api/ai-tasks/schedule` の通常 `task-runner.ts --fast` spawnを削除し、Cloud Run/API requestがローカルscript起動を前提にしない形へ寄せた。
- `/api/ai-tasks` は `executor='codex_app'` / `dispatch_mode='auto'` / `scheduled_at` 未指定なら作成時刻を保存し、manual handoffは `needs_input` / `prompt_waiting` / `scheduled_at=null` を維持する。
- `/api/task-progress/runner-heartbeats` はSupabase `ai_runners.last_heartbeat_at` を先に更新してからTursoへdual-writeする。Supabase更新に失敗した場合はTursoだけfreshに見せないため、agent claim条件とUI heartbeatのズレを避ける。
- 次の最短効果はUI worker。送信直後、詳細open直後、active task検出直後にsnapshot/statusを即時refreshし、visible syncを3秒以内へ揃える。削除判断に必要な残務はAgent workerでrepo scan / staff-status / scheduled/packageを移管またはlegacy blockerとして固定する。
- 追加されたroute testsは未実行。AGENTS.mdの検証ポリシーに従い、テスト/lint/buildはユーザー明示時にIntegrationでまとめて行う。

旧launchdを止めるタイミングは、API spawn廃止、agent parity、repo scan/scheduled/staff-statusの扱い確定、setup導線修正がすべて入った後。`install.sh` は既に旧launchd停止を行うため、新規installでは停止方向。既存Macの `com.focusmap.task-runner` unloadはIntegrationのMac実機確認フェーズで、未移管scheduled taskが無いことを確認してから行う。

## worker起動前の共通ルール

- 各workerは `main` の最新commitをbaseにする。現時点ではPlanner commit `b7023df3` 以降を前提にする。
- 既存worktreeに近い作業がある場合は、新しいworktreeを増やす前に `git worktree list` で状態を確認し、`active` / `integrated候補` / `abandoned候補` を親チャットへ報告する。特に `focusmap-ai-history-fast-watch-agent` はagent領域と重なる可能性があるため、Agent worker開始前に差分を確認する。
- Frontend/API/Agent/Desktop workerは、`docs/ai/task-board.md`、`docs/ai/task-runs.jsonl`、`docs/ai/mistakes.md`、`docs/ai/task-router-analysis.md`、archive系を編集しない。進捗記録はIntegrationへ報告する。
- 旧runner fallbackを残す場合も、本番Cloud Runや通常installから自動起動されないことを不変条件にする。rollbackは原則として対象worker commitのrevertまたは明示legacy envで行い、暗黙fallbackで失敗を隠さない。

## テスト計画

### Unit test

- API: schedule routeのmanual/auto、promote、Turso mirror、spawnしないことをモックで確認。
- Agent: `codex-thread-monitor` のrunning/awaiting/failed/archive/prompt resume、AI履歴hot-sync scope、`runCodexAppTask` のapp-server failure path。
- UI: poll interval、visibility hidden時の停止、`sync-node` 非呼び出し、AI履歴detail watch。
- Desktop/Installer: `main.cjs` syntax、legacy runner env flag、plist/setupの文言と生成内容。

### Integration test

- local Next 3001 + focusmap-agent + Codex app-serverで、`codex_app` auto taskが旧runnerなしにclaimされる。
- manual handoffは `prompt_waiting` のまま、Codex.app送信後にthread検出される。
- archive requestがagent経由でCodex app-serverへ届き、`completed` または `awaiting_approval` へ正しく遷移する。
- repo scan / available reposを維持する場合は、agent移管後に `scan-settings/trigger` から結果が更新される。

### Manual Mac実機確認

- `/Applications/Focusmap.app` 起動後、Mac App ControlでWeb/agent/Codex app-serverがready、旧runnerは通常停止。
- `launchctl list | grep focusmap` で `com.focusmap-official.agent` とCodex app-serverは存在してよいが、`com.focusmap.task-runner` は通常不要。
- `~/.focusmap/logs/agent.log` にclaim/monitor heartbeatが出て、`task-runner.log` が増えない。
- Codex.app直接開始thread、Focusmap manual handoff、auto Codex task、archive requestを1回ずつ確認。

### Cloud Runで壊れていないこと

- Cloud RunはWeb/APIのみで、ローカル `task-runner` spawnを前提にしない。
- 本番APIで `schedule/route.ts` がローカルファイルや `npx tsx scripts/task-runner.ts` を起動しない。
- Agent token API、`/api/agents/claim`、`/api/agents/tasks/[id]/state`、AI履歴agent APIが本番runtime envで動く。

### 3秒同期の測定方法

1. warm状態にする: Focusmap Mac app、agent、Codex app-server、対象UIをvisibleにする。
2. 5回ずつ実行: auto Codex task作成、manual handoff送信、Codex.app直接開始、archive request。
3. 記録する: client action時刻、API response時刻、`ai_tasks.created_at/started_at/completed_at`、`result.last_activity_at/awaiting_approval_at`、Turso snapshot `updated_at`、agent log時刻、UI表示時刻。
4. 合格判定: warm pathで各状態変化が3秒以内。scope変更直後だけは `codex_last_scope_refresh_at` を起点にする。
5. 失敗時: writerがAPI/agent/UIのどこで遅れているかを分け、旧runner fallbackで隠さない。

## docs/CONTEXT.md更新対象

実装workerまたはIntegrationは、実際に変更した内容に応じて以下を更新する。

- `Codex/Macローカル連携 一本化方針`: 通常writer、runner間隔、fallback条件、旧runnerの位置づけ。
- `Codexログ表示方針`: `live_log` / activity / Turso snapshotの正本関係が変わる場合。
- `関連ファイル`: `scripts/task-runner.ts` がlegacy/debug化または削除された場合。
- repo scanを移管/廃止した場合は、設定画面・repo picker・scan APIの正本説明。
- 必要なら `docs/specs/codex-app-handoff-monitoring/03-backyard-sync-and-turso.md` の保存境界。

## 未確認リスク

- staff-statusは個人運用色が強く、Focusmap本体の通常runnerから外してよいか未確認。
- package task / Claude / Terminal scheduled taskの現役利用状況が未確認。
- repo scanを完全廃止すると、`available_repos` 依存の設定UIや旧候補表示が壊れる可能性がある。
- `focusmap-agent` claimは3秒だが、Cloud Run/API latencyやMac sleepで3秒を超える。warm pathとcold/sleep復帰を分けて表示する必要がある。
- `setup.sh` は古いローカル開発者向け導線のため、削除ではなく「非推奨/agent installへ誘導」にする方が安全な可能性がある。

## 親チャットへの報告テンプレート

```md
## task-runner退役 / focusmap-agent一本化 報告

- changed files:
- 計画書:
- task-board更新:
- task-runner残務分類:
  - focusmap-agentへ移管済み:
  - focusmap-agentへ移管が必要:
  - 不要なので削除候補:
  - legacy/debugとして残す:
  - 未確認:
- 推奨実装順:
- worker分割:
- テスト計画:
- 未確認リスク:
- 次に起動すべきworker:
- commit hash:
- staged changes:
- unstaged changes:
- 反映状況:
  - local main:
  - origin/main:
  - 本番:
```
