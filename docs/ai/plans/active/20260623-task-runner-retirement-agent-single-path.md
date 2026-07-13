# task-runner退役 / focusmap-agent一本化フェーズ

- Task ID: `TASK-20260607-004`
- Status: `planned`
- Created: `2026-06-23`
- Parent plan: [20260607-codex-mac-agent-unification.md](20260607-codex-mac-agent-unification.md)
- Board: `docs/ai/task-board.md`

## Goal

旧 `scripts/task-runner.ts` を通常運用から外し、Mac側の通常実行・監視・状態同期の正本を `Focusmap.app` 同梱またはLaunchAgent管理下の `scripts/focusmap-agent` に一本化する。

今回のPlannerフェーズでは実装しない。責務棚卸し、削除条件、3秒同期の受け入れ条件、worker分割、Integration条件を固定する。

## Current Facts

- Cloud Run は Web/API の Next.js server であり、常駐 `task-runner` ではない。Cloud Run上の通常API requestからローカルMac用runnerをspawnしない。
- Mac側の通常運用は `Focusmap.app`、`focusmap-agent`、Codex app-server `ws://127.0.0.1:7878` を本体にする。
- `focusmap-agent` は `claim` poll 3秒、Codex thread monitor 1秒、Codex monitor target refresh 3秒を基準にしている。
- `src/app/api/ai-tasks/schedule/route.ts` は `requestImmediateCodexAppDispatch()` で `scripts/task-runner.ts --task-id <id> --fast` をspawnする経路をまだ持つ。
- `desktop/focusmap-mac/main.cjs` は `FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` がない限り旧 `task-runner` を通常起動しない。
- `scripts/install.sh` は現行 `com.focusmap-official.agent` / `com.focusmap-official.codex-app-server` 導入前に旧 `com.focusmap.task-runner` を停止する。
- `scripts/setup.sh` と `scripts/com.focusmap.task-runner.plist` はまだ旧毎分 `task-runner` 導入前提を残している。
- `task-runner.ts` の旧Codex monitorは `FOCUSMAP_LEGACY_CODEX_MONITOR=1` または互換env明示時だけ動く。

## Responsibility Inventory

| Responsibility | Current Owner / Evidence | Classification | Retirement Decision |
|---|---|---|---|
| Codex送信 `executor='codex_app'` | `focusmap-agent/src/executors/codex-app.ts` が app-server `thread/start|resume` と `turn/start` を実行。`task-runner.ts` も旧 `launchCodexRemote()` を持つ。schedule APIの即時spawnは旧runner。 | `focusmap-agentへ移管済み` + `focusmap-agentへ移管が必要` | claim経路は移管済み。通常APIの即時spawnを廃止し、必要ならagent claimを3秒以内に拾わせる。旧runner送信はlegacy/debugへ落とす。 |
| Codex監視 | `focusmap-agent/src/codex-thread-monitor.ts` が1秒tick、3秒target refresh、固定thread監視、直接開始thread metadata同期、archive requestを処理。`task-runner.ts` 側はenv flagでlegacy。 | `focusmap-agentへ移管済み` | 通常writerはagentのみ。旧runner monitorは明示env時だけのdebug fallback。 |
| repo scan / available repos | `task-runner.ts` の `scanAndSync()` が `user_scan_settings` と `available_repos` を更新。`src/app/api/scan-settings/trigger/route.ts` の文言も「次回task-runner」。agent側に同等実装は見当たらない。 | `focusmap-agentへ移管が必要` | 削除前にagentへ移すか、UIをCodex SQLite repo候補/手入力中心へ変えて旧scanを正式廃止する。未決のままtask-runner削除不可。 |
| staff-status | `task-runner.ts` に `STAFF_STATUS_SCHEDULE_SKILL_ID`、外部 `staff-status` script、retry/stale recovery/history作成がある。agent側には同等処理なし。 | `未確認` | 利用中ならagent workerへ移管。使っていないなら対象taskを棚卸しして削除候補。未確認のまま旧runner削除不可。 |
| scheduled task claim / recurrence | `focusmap-agent` は `/api/agents/claim` 経由で3秒claimし、`codex_app`/terminal/browser/playwright/web-researchを実行する。旧runnerはrecurrence再スケジュール、Claude RC、package command、interactive Terminalも処理する。 | `一部focusmap-agentへ移管済み` + `focusmap-agentへ移管が必要` | Codex auto taskはagent claimへ寄せる。recurrence、package、Claude/interactiveの現役有無を確認し、残すならagent/APIへ移す。 |
| archive request | `focusmap-agent` monitorが `hasPendingArchiveRequest()` を処理し、app-server `thread/archive` 後に完了化。旧runnerにも互換処理あり。 | `focusmap-agentへ移管済み` | 通常はagentのみ。legacy runnerはagent不在時の明示debug fallbackに限定。 |
| live log / activity書き込み | agentはcompact snapshot、event、activityを `/task-progress` と `/agents/tasks/[id]/state` 経由で送信。旧runnerはCodex live_log、tmux/Claude/package stdout、staff-status結果をDBへ書く。 | `Codexはfocusmap-agentへ移管済み` + `非Codexは未確認` | Codexの通常activityはagentへ固定。Claude/package/staff-statusを残すならactivity/結果書き込み先をagent/API契約に移す。 |
| setup/install/launchd | `install.sh` はagent LaunchAgent正本。`setup.sh` と `com.focusmap.task-runner.plist` は旧runnerを毎分登録する。Mac appは旧runnerをdefault無効。 | `一部focusmap-agentへ移管済み` + `focusmap-agentへ移管が必要` | `setup.sh` はagent導入またはlegacy案内へ変更。旧plistは通常導線から外し、残すなら `legacy/debug` 明記。 |

## Removal Conditions

`task-runner` を通常運用から外してよい条件:

- `src/app/api/ai-tasks/schedule/route.ts` から通常 `task-runner.ts --fast` spawnが消えている。Cloud Runでもlocal Webでも、API requestはDB作成とTurso mirrorまでに留め、Mac実行はagent claimに任せる。
- 即時 `codex_app` auto taskは、Mac agent online時に `claim poll <= 3s` で `pending -> running` に入る。
- `focusmap-agent` が通常Codex監視、manual handoff thread検出、running再開、awaiting/completed/failed反映、pending archive request、Codex.app直接開始thread metadata同期を担当している。
- repo scanを残す場合、`focusmap-agent` または明示された新APIに移管済みで、`available_repos` / `scan-settings` UIの文言がtask-runner前提ではない。
- staff-status、recurrence、package、Claude RC、interactive Terminalの現役taskがない、または同等処理がagent/APIへ移管済み。
- `setup.sh` は通常 `com.focusmap.task-runner` を登録しない。`install.sh` は旧launchd停止を維持し、Focusmap.appは旧runnerをenv flagなしで起動しない。
- UI/設定/ステータスAPIの通常文言が `focusmap-agent` 正本になっている。
- 既存Macで `launchctl list | grep com.focusmap.task-runner` が残っていても、現行installerまたは明示手順で停止でき、停止しても通常Codex/AI履歴/アーカイブが動く。

`task-runner` をまだ外してはいけない条件:

- `skill_id='staff-status-schedule'`、`package_id is not null`、`executor='claude'`、`executor='codex'`、`recurrence_cron is not null` の現役 `ai_tasks` が旧runner専用挙動に依存している。
- `available_repos` の更新元が旧 `scanAndSync()` だけで、リポ選択/scan settings UIが通常機能として残っている。
- `codex_app` auto taskがagent claimで拾われず、schedule APIの `--fast` spawnを外すと開始レイテンシが大きく悪化する。
- pending archive requestをagentが拾えないケースが残る。
- Mac installer/setupが旧runnerを再導入する。
- fallbackを有効にした旧runnerとagentが同じtaskへ重複writeする可能性が残る。

Fallbackを残す条件:

- 入口はCLIまたは明示envのみ。`FOCUSMAP_LEGACY_CODEX_MONITOR=1` と `FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER=1` のように人間がdebug目的で明示した時だけ使う。
- Cloud Run/API requestからfallback runnerをspawnしない。
- fallback実行時は `metadata.app='legacy-task-runner'` / log prefixで通常agentと区別する。
- focusmap-agent heartbeatがonlineで同じtaskを所有している場合、legacy writerはCodex監視writeをしないか、debug read-onlyに留める。
- fallbackは削除前の互換期間だけにし、残す理由と削除予定を `docs/CONTEXT.md` に固定する。

## 3 Second Sync Acceptance

3秒以内の意味は「active表示でのpoll間隔上限」と「Mac agentが状態変化を検知して軽量snapshotへ反映するSLO」を分けて測る。

| Case | Acceptance | Measurement |
|---|---|---|
| タスク作成直後 | API response後、UI上の対象ノード/看板/詳細に `pending` または `prompt_waiting` が3秒以内に出る。Turso mirrorがあればsnapshotだけで紐づく。 | client click time、API response `created_at`、Turso `ai_tasks.updated_at`、UI render timestampを比較。 |
| `pending -> running` | Mac agent onlineかつclaim loopがidleなら、due taskは作成または `scheduled_at <= now` から3秒以内にclaimされ、`started_at` とrunner heartbeat `current_task_id` が更新される。 | `ai_tasks.created_at/scheduled_at`、`started_at`、`runner_heartbeats.last_seen_at/current_task_id`、first running snapshot時刻。 |
| `running -> awaiting_approval / completed / failed` | 既知threadはmonitor 1秒tickで検知し、状態変化はforce送信する。backend snapshot更新からforeground UI反映まで3秒以内。 | Codex rollout/state DBの変化時刻、`ai_tasks.result.last_activity_at`、Turso event `created_at`、UI render timestamp。 |
| `prompt_waiting` | manual handoff作成時は即 `needs_input` + `result.codex_run_state='prompt_waiting'` として表示し、外部アプリを開いただけでrunningへ進めない。送信後thread検出はagent target refresh 3秒 + monitor tickで追う。 | task作成API response、UI未送信表示、thread ID保存時刻、first running/awaiting snapshot時刻。 |
| Codex.app直接開始thread取り込み | repo scope取得済みなら、ローカル検出は次の1秒tick、scope refreshが必要でも3秒以内に対象scopeへ反映し、UIは次の3秒pollで履歴に出る。 | Codex thread `created_at_ms/updated_at_ms`、agent heartbeat `codex_last_scope_refresh_at`、AI history `indexed_at`、UI表示時刻。 |
| UI表示反映 | active Codex task、詳細panel/drawer表示中、AI履歴watch中はUIのpoll間隔を3秒以内に統一する。非active時は低頻度でよい。 | Network panelまたはテストで対象hooksのintervalを確認し、active中に5秒/30秒/1時間pollへ落ちないことを確認。 |

Implementation workers should add a small manual measurement note to their report:

```md
3s sync measurement:
- task_id:
- action started at:
- API created/responded at:
- agent claimed/running at:
- monitor wrote final state at:
- UI rendered at:
- max active UI poll interval observed:
```

## Parallelization Decision

Decision: `HYBRID_PLAN_THEN_PARALLEL`

First fix the contract in this plan, then split implementation by file ownership. The workers can run in parallel only if their allowed files do not overlap. Integration owns final merge, full verification, `docs/CONTEXT.md`, and task-board completion updates.

## Worker Split

### API Worker

Allowed files:

- `src/app/api/ai-tasks/schedule/route.ts`
- `src/app/api/agents/claim/route.ts`
- `src/app/api/agents/tasks/[id]/state/route.ts`
- narrowly related tests for those routes

Forbidden files:

- `scripts/**`
- `desktop/**`
- UI components/hooks
- `docs/ai/task-board.md`, `docs/ai/task-runs.jsonl`, archives, secrets, lockfiles

Completion conditions:

- Normal schedule API no longer spawns `scripts/task-runner.ts --fast`.
- Auto `codex_app` tasks are created in a state claimable by `focusmap-agent`.
- User-facing `live_log` / message strings no longer say Mac task-runner starts the job.
- Cloud Run behavior does not depend on local filesystem runner logs.

Test viewpoints:

- Unit/API test: creating immediate `codex_app` auto task does not call `spawn`.
- Unit/API test: manual handoff remains `prompt_waiting`.
- Integration test plan: agent claim receives due task within claim TTL.

Report to Integration:

- changed files
- old spawn removal details
- new expected state fields for agent
- route tests and results
- any contract deviation

### Agent Worker

Allowed files:

- `scripts/focusmap-agent/src/**`
- `scripts/focusmap-agent/*.test.ts`
- agent-local docs if needed

Forbidden files:

- `src/app/api/**` except when explicitly coordinated with API worker
- `desktop/**`
- UI files
- `scripts/task-runner.ts` except for read-only comparison
- lockfiles unless dependency change is explicitly approved

Completion conditions:

- `codex_app` auto tasks created by schedule API are claimed and started without oldrunner spawn.
- monitor continues fixed-thread sync, manual handoff detection, direct thread metadata import, detail hydrate, and archive request handling.
- If repo scan is retained, agent owns scan settings and `available_repos` update, or produces a documented decision that repo scan is deprecated and UI will not rely on it.
- If staff-status/package/recurrence remain in scope, either implement support or explicitly report them as `main未移管` blockers.

Test viewpoints:

- Unit tests for monitor state transitions and archive request.
- Agent claim/executor test for immediate `codex_app`.
- Repo scan unit/integration tests if migrated.
- No duplicate writes when legacy monitor env is absent.

Report to Integration:

- changed files
- which legacy responsibilities are now agent-owned
- unsupported legacy responsibilities and blocker status
- test commands/results
- 3秒measurement from agent logs or fake clocks

### UI Worker

Allowed files:

- `src/hooks/useAiTasks.ts`
- `src/hooks/useMemoAiTasks.ts`
- `src/hooks/useNoteAiTasks.ts`
- `src/hooks/useScheduledTasks.ts`
- `src/components/**` related to task progress, settings automation, repo picker, scan settings, Codex panels
- related UI tests

Forbidden files:

- `src/app/api/**`
- `scripts/**`
- `desktop/**`
- docs task-router records

Completion conditions:

- Active Codex states use 3秒以内poll where active: `pending`, `running`, `awaiting_approval`, `needs_input`, `prompt_waiting`, selected AI history detail/watch.
- Non-active states may stay low frequency.
- User-facing task-runner wording in normal UI is replaced with focusmap-agent/Mac agent wording.
- Scan settings UI does not promise `次回task-runner`.

Test viewpoints:

- Hook tests for active interval selection.
- Component tests for `prompt_waiting`/running/awaiting display.
- Manual UI check plan for dashboard and settings. Do not run browser checks unless Integration/user explicitly requests.

Report to Integration:

- changed files
- active poll interval matrix
- remaining legacy wording if any
- UI tests/results

### Desktop / Installer Worker

Allowed files:

- `desktop/focusmap-mac/main.cjs`
- `desktop/focusmap-mac/**` tests/scripts if present
- `scripts/install.sh`
- `scripts/setup.sh`
- `scripts/com.focusmap.task-runner.plist`
- package scripts related to Mac build/install if needed, excluding lockfile unless approved

Forbidden files:

- `src/app/api/**`
- `scripts/focusmap-agent/src/**` unless coordinated with Agent worker
- secrets and env files

Completion conditions:

- Focusmap.app continues to start/supervise `focusmap-agent` and Codex app-server.
- Old `task-runner` is not auto-started unless explicit legacy env is set.
- `setup.sh` no longer installs the old task-runner as normal Step 4.
- Legacy plist is either marked debug-only or removed from normal setup path.
- Installer keeps stopping old LaunchAgents before installing official agent.

Test viewpoints:

- Static review of launchd labels and env gates.
- Manual Mac test plan: no `com.focusmap.task-runner` after reinstall; `com.focusmap-official.agent` online; Codex app-server ready.

Report to Integration:

- changed files
- launchd labels changed/stopped
- manual commands used or planned
- compatibility caveats

### Docs / Test Worker

Allowed files:

- `docs/CONTEXT.md`
- `docs/specs/**` if existing spec is the better home
- focused test files that do not overlap worker implementation tests

Forbidden files:

- implementation source except tests explicitly assigned
- `docs/ai/task-runs.jsonl`
- `docs/ai/mistakes.md`
- `docs/ai/task-router-analysis.md`
- archives unless Integration owns completion

Completion conditions:

- After implementation, `docs/CONTEXT.md` reflects the true normal path: Cloud Run API only, Mac agent claim/monitor, legacy runner fallback boundary, intervals, UI active poll rules.
- Test plan is converted into executable checks or checklist for Integration.
- No future-tense plan text is written into CONTEXT as if already implemented.

Test viewpoints:

- Documentation consistency review against `rg "task-runner|focusmap-agent"` results.
- Test matrix coverage for API/Agent/UI/Desktop.

Report to Integration:

- changed files
- CONTEXT sections updated
- unresolved docs contradictions
- suggested archive/update tasks

### Integration Worker

Allowed files:

- All worker-owned files as needed for minimal conflict resolution
- `docs/CONTEXT.md`
- `docs/ai/task-board.md`
- task-router completion records if user has not forbidden them in that Integration turn

Forbidden files:

- secrets and env files
- destructive git operations without explicit approval
- broad refactors unrelated to retirement

Completion conditions:

- All worker commits are reviewed for allowed-file compliance.
- local `main` contains the final integrated commits.
- Verification requested by the user is run and recorded.
- `docs/CONTEXT.md` is updated only after implementation behavior is true.
- `TASK-20260607-004` board row is updated to next state or archive path.
- `task-runner` deletion/retention decision is explicit.

Test viewpoints:

- API route tests.
- agent monitor/executor tests.
- UI hook/component tests.
- Mac実機 manual checklist.
- Cloud Run no-regression checklist.
- 3秒measurement checklist.

Report to parent:

- worker commits and changed files
- final responsibility classification
- verification results
- local main/origin/main/production status
- remaining risks and next gate

## Implementation Order

1. API worker: remove normal `task-runner.ts --fast` spawn from schedule API and update initial messages to `focusmap-agent`.
2. Agent worker: confirm/adjust claim path for immediate `codex_app` auto tasks, then handle residuals in this order: archive parity, repo scan, scheduled recurrence/package/staff-status.
3. UI worker: unify active poll/read behavior to 3秒以内 and replace normal UI wording away from task-runner.
4. Desktop/Installer worker: remove old launchd setup path after API/agent parity is ready; keep explicit legacy env fallback.
5. Docs/Test worker: prepare and then apply `docs/CONTEXT.md` updates after actual implementation.
6. Integration worker: merge, verify, measure 3秒sync, confirm old `task-runner` is not required for normal use, and update board/archive records.

Do not stop an existing user `com.focusmap.task-runner` LaunchAgent as a standalone first step. Stop it only after the new agent is online and the residual responsibilities above are either migrated or explicitly deprecated. The installer can continue to stop old labels during a deliberate agent install/migration.

## Test Plan

Unit tests:

- `src/app/api/ai-tasks/schedule/route.ts`: no spawn on normal `codex_app` auto creation; manual handoff remains `prompt_waiting`; Turso mirror includes source mapping.
- `scripts/focusmap-agent`: `runCodexAppTask()` status snapshots; `codex-thread-monitor` running/resumed/awaiting/failed/archive transitions; direct thread metadata hot sync; pending archive requests.
- UI hooks: active statuses choose 3秒 interval; inactive statuses drop to low frequency; prompt_waiting does not become running without monitor evidence.
- Desktop/installer: static tests or script assertions for launchd labels/env gates if test harness exists.

Integration tests:

- Create due `codex_app` auto task via schedule API, fake or test agent claims it, then state route updates `running`.
- Feed a sample Codex rollout JSONL into agent monitor and confirm `awaiting_approval` plus activity messages.
- Pending AI history archive task is claimed by monitor and marked completed after app-server archive succeeds.
- If repo scan migrates, scan temp directories with `.git` and update `available_repos`.
- If recurrence/package/staff-status migrates, confirm next `scheduled_at` and retry semantics match legacy.

Manual Mac実機確認:

- Install or run Focusmap.app; confirm `focusmap-agent` online and Codex app-server ready.
- `launchctl list` shows no normal reliance on `com.focusmap.task-runner`; old job may be absent or stopped.
- Create manual handoff from a node: UI shows `prompt_waiting`, Codex opens/copy works, no auto send.
- Send in Codex.app: agent detects thread and UI moves to running/awaiting in active view.
- Create explicit auto `codex_app` task: agent starts it without schedule API spawning task-runner.
- Archive from AI history and from node completion path; agent archives thread and marks only the correct task complete.
- Check logs: `~/.focusmap/logs/agent.log` shows ownership; `task-runner.log` is unchanged during normal flow.

Cloud Run no-regression:

- Schedule API on production origin does not attempt local spawn or write `~/.focusmap/logs/task-runner.log`.
- Web/API behavior works with Mac agent remote polling via official API.
- No service role key or local-only env is required in the Mac app beyond agent token.
- `git push origin main` remains the only normal production deploy trigger; no manual runner deploy path.

3秒sync measurement:

- Use a single `task_id` and record timestamps for API creation, agent claim, first `running` state, Codex rollout terminal signal, backend snapshot/event update, and UI render.
- Acceptance for active UI is poll interval <=3000ms and backend write-to-render <=3000ms.
- Acceptance for agent local detection is target refresh <=3000ms and monitor tick <=1000ms for known tasks.
- If end-to-end from Codex local event to visible UI exceeds 3秒 due to phase alignment, report hop timings and fix the slow hop rather than hiding it behind a single averaged number.

## CONTEXT Update Targets

Do not update `docs/CONTEXT.md` in this Planner phase as if implementation is complete. Integration should update these sections after code changes land:

- `マインドマップとCodex.app連携`: schedule API no longer spawns old task-runner; normal Codex auto/manual ownership belongs to `focusmap-agent`.
- `runner状態表示` / Mac agent interval paragraphs: claim 3秒, monitor 1秒, target refresh 3秒, UI active poll 3秒以内, legacy runner fallback boundary.
- `Focusmap MacアプリMVP`: setup/install and LaunchAgent labels after old runner is retired.
- `関連ファイル`: mark `scripts/task-runner.ts` as legacy/debug only or remove it from normal path once deletion is done.
- scan settings / available repos paragraphs if repo scan moves to agent or is deprecated.

## Unconfirmed Risks

- `staff-status` may be a live personal workflow. Deleting oldrunner before confirming active rows would silently stop it.
- `ai_task_packages` and package cache behavior may still depend on task-runner-only sync.
- Recurring scheduled tasks may depend on oldrunner rescheduling semantics after completion.
- Some UI copy and status APIs still identify repo scan or runner install as `task-runner`.
- Existing user machines may still have old `com.focusmap.task-runner` loaded. Installer migration handles this, but manual old installs need clear fallback/cleanup instructions.
- `focusmap-agent` executor currently rejects unsupported legacy `executor='claude'` or package tasks; that is acceptable only if those task types are deprecated or separately migrated.

## Parent Report Template

```md
changed files:
- ...

plan location:
- parent: docs/ai/plans/active/20260607-codex-mac-agent-unification.md
- child: docs/ai/plans/active/20260623-task-runner-retirement-agent-single-path.md

task-board update:
- TASK-20260607-004: ...

task-runner responsibility classification:
- focusmap-agentへ移管済み:
- focusmap-agentへ移管が必要:
- 不要なので削除候補:
- legacy/debugとして残す:
- 未確認:

recommended implementation order:
1. API spawn removal
2. Agent residual migration/parity
3. UI active 3s sync
4. Desktop/Installer legacy launchd cleanup
5. Docs/Test
6. Integration

worker split:
- API:
- Agent:
- UI:
- Desktop/Installer:
- Docs/Test:
- Integration:

test plan:
- unit:
- integration:
- manual Mac:
- Cloud Run:
- 3s measurement:

unconfirmed risks:
- ...

next worker:
- ...

commit:
- <hash or none>

git state:
- staged:
- unstaged:
```
