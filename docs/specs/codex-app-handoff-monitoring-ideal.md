# Codex.app handoff + monitoring ideal

Status: living spec
Created: 2026-06-05
Primary audience: future Codex/Claude agents working on Focusmap Codex.app integration

## Purpose

This document is the ideal target for Focusmap's Codex.app handoff and monitoring flow. When future agents change backend, Mac agent, task progress UI, or map/Codex UX, they should compare their proposal against this document before editing code.

Focusmap's role is not to become Codex.app. Focusmap prepares the work, keeps the dashboard understandable, and shows the state that humans need for oversight. Codex.app remains the canonical place where the human sends and continues Codex turns.

## Product Principle

Focusmap is the dashboard where AI works and humans steer.

For Codex.app tasks, this means:

- Focusmap shows what needs attention, what is running, what failed to connect, and what was recently completed.
- Codex.app thread history is the source of truth for the conversation.
- Focusmap stores and displays lightweight state, short summaries, current step, and activity messages.
- Focusmap must not store or poll full raw logs as the normal path.
- Humans make the final send action in Codex.app for the standard flow.

## Standard Flow

The standard Codex.app flow is manual handoff.

1. User presses `Codexに送る` or an equivalent Codex action in Focusmap.
2. Focusmap creates a tracking `ai_tasks` record with `executor='codex_app'` and `dispatch_mode='manual'`.
3. Focusmap creates a handoff package:
   - prompt text
   - handoff token / Focusmap sync marker
   - repo path when available
   - image references when available
   - source task/memo identifiers
4. Focusmap copies the prompt to clipboard.
5. Focusmap opens Codex.app composer when possible, for example with `codex://threads/new?prompt=...&path=...`.
6. Human sends the prompt in Codex.app.
7. Mac local agent observes Codex.app state locally and sends lightweight snapshots/events to Focusmap.
8. Focusmap shows `未送信`, `実行中`, `確認待ち`, or `接続失敗` in map, board, and details.

Automatic `thread/start` / `turn/start` through the Codex app-server is not the standard path. It may exist only as an explicit mode when `dispatch_mode='auto'` is intentionally selected by a dedicated UI or internal workflow.

## Critical Invariants

These rules should not be broken during future fixes:

- Manual handoff tracking must exist before or atomically with opening Codex.app.
- Opening Codex.app without a Focusmap tracking task is a bug unless the UI clearly shows recovery/retry.
- Deep links set composer text; they must not be assumed to auto-send.
- Image attachment must not be assumed to work through deep links.
- Mac local checks can be frequent; cloud writes must stay lightweight and deduplicated.
- Full Codex logs, raw command output, full thread history, image bodies, and screenshots are not normal Turso payloads.
- `completed` from Codex is not the same as a completed Focusmap node. Human review still matters.
- Existing API contracts must not be broken to make the UI look simpler.

## User-Facing State Model

Internal task states are mapped to user-facing Codex states:

| Internal status / condition | User label | Meaning |
|---|---|---|
| `pending` or manual handoff without detected thread | `未送信` | Focusmap prepared the prompt; human still needs to send or Codex thread has not been detected. |
| `running` | `実行中` | Codex is actively working or recently resumed. |
| `awaiting_approval` / `needs_input` / Codex-side completion before human review | `確認待ち` | Human should inspect Codex output, approve, answer, or decide what to do next. |
| `failed` / monitoring lost / thread not found after timeout | `接続失敗` | Focusmap could not reliably connect or track the Codex session. |

Important behavior:

- Old `result.codex_run_state='running'` alone must not override a newer terminal or waiting state.
- Codex completion should be displayed as `確認待ち` until the human explicitly completes the Focusmap node.
- The node checkbox remains the source of truth for task completion in the map.

## Ideal UI

### Map First

The map is the primary place for node-specific Codex monitoring. Do not move this workflow to the generic chat tab.

Desktop:

- Show a compact, collapsible `Codex看板` under the map.
- Keep the map visually primary; the board should not dominate the screen by default.
- Initial collapsed state should show counts and urgent attention, not raw logs.

Mobile:

- Show a bottom-right `Codex` button.
- Open a bottom sheet with the Codex board.
- Keep tap targets at least 44px.
- Prioritize one-handed operation and quick recognition of what needs attention.

Board lanes:

- `実行中`
- `確認待ち`
- `接続失敗`
- `完了`

`未送信` cards may live in the `確認待ち` lane, but each card must clearly show its own `未送信` status.

`完了` should be temporary: show recently checked/completed items for context, but do not turn the board into a permanent archive.

### Board Cards

Each card should show only what helps decide the next action:

- status label
- node/memo title
- `current_step` or short fallback
- short `summary`
- Mac agent online/offline indication when relevant
- last updated time
- compact action surface

Do not show raw JSON, long tool logs, or full thread dumps in board cards.

### Detail Panel / Drawer

Details open only when the user asks for them.

When opened:

- immediately fetch current task progress
- open an active watch for the task
- poll detail tail at the boosted interval
- show summary/current step/activity first
- keep raw event/progress tail behind a detail affordance if needed

Expected safe operations:

- `Codexで開く`
- `再コピー`
- `更新`
- future: `送信済みにする`
- future: `確認待ちにする`
- future: `手動thread紐付け`

Do not fake actions that lack backend support. If an action is required but not implemented, keep it as a documented gap rather than a misleading button.

### Node Detail Priority

For a node with Codex activity, the Codex block should appear above long memo text because it is currently the most actionable context.

Still preserve access to the memo body. The detail view should not become a separate chat page or hide the source task.

## Handoff Package Requirements

The handoff package should be enough for a future agent or human to recover the flow.

Required:

- `handoff_id` or validated handoff token
- `ai_task_id`
- prompt text
- source type and source id
- repo path when known
- created timestamp

Optional:

- expected workspace path
- image references
- image local paths
- signed URLs if supported
- fallback instructions for manual attachment

Image handling must stay explicit:

- Clipboard paste may work for some images but cannot be assumed.
- Signed URLs may work if reachable from Codex.app/ChatGPT environment.
- Local paths may help only when Codex.app can access the same Mac path.
- Manual attach remains a valid fallback.

## Thread Detection

Focusmap should link `handoff_id` / `ai_task_id` / `codex_thread_id` as follows:

1. The tracking task exists before Codex.app opens.
2. The prompt includes a compact Focusmap marker or handoff token.
3. Mac local monitor reads Codex.app sqlite/rollout/app-server state.
4. It matches new or updated threads by:
   - explicit marker when available
   - prompt prefix/content match when needed
   - repo path / cwd
   - created/updated time window
5. When matched, it writes `codex_thread_id` to the lightweight snapshot and compatible `ai_tasks` fields.
6. If no thread is detected within the fast window, the task becomes `接続失敗` or `確認待ち` with a clear recovery path.

Thread detection must not rely on writing `codex_last_checked_at` repeatedly when nothing visible changed.

## Local Monitoring vs Cloud Sync

Mac local monitoring and Turso sync are separate.

Mac local:

- can read Codex.app state every 1 second while the agent is active
- can detect additional user input quickly
- can inspect sqlite/rollout/app-server locally
- can hold raw detail locally if needed

Cloud sync:

- sends latest small snapshot only when content hash changed or minimum interval passed
- sends state events only on meaningful transitions
- sends short detail tail only when needed
- never sends full logs on every tick

Recommended intervals:

| Situation | Local check | Cloud write/read |
|---|---:|---:|
| Runner alive | local process loop | heartbeat upsert every 10s |
| Running task, no detail open | 1s local | snapshot min 5s, only if hash changed |
| Detail panel open | 1s local | active watch + detail poll 3s |
| Awaiting approval / needs input | 1s local allowed | state change within 5s when user resumes |
| No running task visible | normal background | 30-45s or manual refresh |
| Completed / failed old tasks | no tight loop | low frequency or manual |

## Turso Data Rules

Turso is for lightweight monitoring state, not archival logs.

Tables:

- `ai_tasks`: latest display snapshot
- `ai_task_progress`: short tail/history only
- `ai_task_events`: state changes only
- `runner_heartbeats`: runner liveness
- `task_progress_watches`: detail-open boost hints
- `screenshots`: metadata only, not originals

Allowed in Turso:

- task id, user id, space id
- source type/id
- status
- `codex_thread_id`
- `current_step` under a small character limit
- `summary` under a small character limit
- compact progress metadata
- event type and small payload
- heartbeat metadata

Not allowed as normal Turso payload:

- full `live_log`
- full `output`
- raw command output
- full thread history
- full rollout JSON
- image body/base64
- screenshot originals
- large unbounded JSON

The API should sanitize payloads defensively even if the Mac agent is expected to compact them first.

## Turso Free Tier Discipline

The target is to remain comfortably inside Turso Free for normal personal use.

Write budget mindset:

- 10 second runner heartbeat is acceptable.
- 5 second running snapshot is acceptable if hash-deduplicated.
- 3 second boost is acceptable only while a detail panel/drawer is open.
- Every tick must not insert progress rows.
- Every tick must not insert event rows.
- Raw logs must not be saved repeatedly.

Rough monthly write examples:

| Scenario | Approx writes/month | Notes |
|---|---:|---|
| 1 runner heartbeat every 10s | 259k | One upsert row. |
| 1 running task every 5s, always changing, 24h/day | 518k | Worst normal snapshot case. |
| 5 running tasks every 5s, always changing, 24h/day | 2.59M | Still acceptable if no raw progress inserts. |
| 5 tasks detail-open every 3s, always changing, 24h/day | 4.32M | Heavy but still under 10M if other writes stay small. |
| Every task inserts progress/event every 3s | Too high | This is not allowed. |

Read budget discipline:

- Use `(updated_at, id)` cursor with `limit`.
- Avoid short-interval `select('*')`.
- Avoid `count` on hot paths.
- Avoid full scans.
- Add and preserve indexes for user and space cursor paths.

Required indexes for snapshot-style reads:

- `(user_id, updated_at, id)`
- `(space_id, updated_at, id)` when space reads are supported
- task progress by `(task_id, created_at)`
- events by `(task_id, created_at)`
- runner heartbeat by `(user_id, last_seen_at)`
- active watches by `(user_id, expires_at)` and/or `(task_id, expires_at)`

`task_progress_watches` must be cleaned up. TTL filtering alone is not enough; expired rows older than a retention window such as 24 hours should be deleted opportunistically.

## Backend Acceptance

Backend changes are acceptable only if they preserve these outcomes:

- Manual handoff creates tracking task before opening Codex.app or provides an explicit recovery path.
- `dispatch_mode='manual'` is never automatically `turn/start`ed by the normal runner.
- `dispatch_mode='auto'` remains explicit and separate.
- Snapshot POST updates latest state without inserting history when `snapshot_only=true`.
- Events insert only for meaningful transitions.
- Progress history is short and bounded.
- Watch open/ping/close controls detail boost.
- Expired watches do not accumulate forever.
- Runner monitoring is scoped by user/space when running in multi-user contexts.
- Turso failures do not destroy existing Supabase-compatible behavior unless the endpoint is explicitly Turso-only.

## Frontend Acceptance

Frontend changes are acceptable only if they preserve these outcomes:

- Map remains the main Codex monitoring surface.
- Board/card UI is compact and task-focused.
- Mobile uses a bottom sheet rather than a dense always-visible board.
- Detail tail is fetched only when detail is open.
- `未送信` / `実行中` / `確認待ち` / `接続失敗` labels are consistent.
- Completed Codex output does not auto-complete the Focusmap node.
- UI does not offer fake actions without backend support.
- Text does not overflow buttons/cards on mobile or desktop.
- Tap targets are at least 44px on mobile.
- The UI remains quiet, dense, and operational rather than decorative.

## Verification Checklist

Before finishing related work, run or explicitly explain why each item could not run:

- `git fetch --prune origin`
- `git status --short --branch`
- inspect existing uncommitted changes and avoid mixing them
- relevant lint for touched files
- relevant unit tests for Codex state mapping and map UI
- `git diff --check`
- `npx tsc --noEmit --pretty false`
- desktop check at `http://localhost:3001/dashboard?taskProgressFixture=1`
- mobile-width check of Codex button and bottom sheet

Known existing type errors should be named precisely and not hidden as successful typecheck.

## Prompt Template For Future Agents

Use this short block when handing the work to another agent:

```md
Read `docs/specs/codex-app-handoff-monitoring-ideal.md` before editing.
Your job is to move the current implementation closer to that ideal without breaking API contracts or mixing unrelated changes.

Prioritize:
1. manual handoff tracking cannot be lost
2. Turso writes stay snapshot/hash/event based
3. detail tail is read only when detail is open
4. UI labels stay 未送信 / 実行中 / 確認待ち / 接続失敗
5. map remains the primary monitoring surface

Do not:
- auto-send Codex.app standard handoffs
- save full logs to Turso
- assume images can be deep-link attached
- fake UI actions without backend support
- edit unrelated files
```

## Open Decisions

These are intentionally not forced by the current ideal:

- Whether to build `送信済みにする` as a real API action.
- Whether to build manual `codex_thread_id` linking UI.
- Whether to introduce SSE later for active detail views.
- Whether screenshots preview should become part of the first Codex monitoring release.
- Whether multi-user runner scoping should be mandatory before public release or only before shared-space rollout.

Until those are decided, use the conservative behavior described above.
