# Memo Codex Execution Delivery Plan

## Status

Planned.

## Current Constraints

- Existing `package.json` worktree diff is unrelated and must not be staged into this feature.
- Other local UI files may be dirty from another agent. This plan must be implemented in isolated commits.
- Existing Codex sync already uses `ai_tasks`, `result.live_log`, `codex_thread_id`, `~/.codex/state_5.sqlite`, rollout JSONL, and `/api/codex/sync-node`.
- Existing `project_contexts` has `heading`, `details`, `progress`, and `progress_status`; current memo structure code does not yet fully use it.

## Phase 0: Spec And Guardrails

- Add this spec folder.
- Link the spec from `docs/CONTEXT.md`.
- Do not change production behavior.

Verification:

- `git diff --check`

## Phase 1: Data Model

Add an activity-message table for chat-style execution history.

Candidate migration:

- `ai_task_activity_messages`
  - `id uuid primary key`
  - `task_id uuid references ai_tasks(id) on delete cascade`
  - `user_id uuid references auth.users(id) on delete cascade`
  - `role text`
  - `kind text`
  - `body text`
  - `importance text default 'normal'`
  - `metadata jsonb default '{}'`
  - `created_at timestamptz default now()`

Indexes:

- `(task_id, created_at)`
- `(user_id, created_at desc)`

Policies:

- User can CRUD own rows.

Retention helper:

- Add server utility to keep at most 50 messages per task.
- Delete old `importance='normal'` messages first.
- Preserve important messages: sent, question, approval, resumed, completed, failed, user answer.

Verification:

- Migration applies locally.
- Generated DB types compile.

## Phase 2: Codex Activity Sync

Extend Codex sync so it updates current state frequently but writes activity messages sparingly.

Implementation targets:

- `src/lib/codex-run-state.ts`
- `src/app/api/codex/sync-node/route.ts`
- `scripts/task-runner.ts`
- Shared helper for activity message insertion/deduplication.

Rules:

- When `codex_run_state === 'running'`, allow 3 second sync.
- Do not create periodic activity messages while not running.
- While `awaiting_approval`, only detect resume.
- If a later user message or task start appears after `awaiting_approval_at`, set state back to `running`.
- On resume, add one `resumed` activity message.
- On approval/question, add one `approval` or `question` message and stop adding progress messages.
- Add progress message only when current step changes meaningfully, or every 2 minutes while still running.

Verification:

- Unit tests for rollout parsing and resume detection.
- Route test for activity message cap.
- Manual check with Codex thread: running -> awaiting_approval -> user follow-up -> running.

## Phase 3: Memo Execution Source

Add direct memo-to-Codex execution.

Implementation targets:

- `src/components/wishlist/wishlist-card-detail.tsx`
- `src/components/wishlist/wishlist-card.tsx`
- memo execution API or existing `ai_tasks` insertion path
- `useMemoAiTasks`

Behavior:

- `今すぐ実行` creates/updates `ai_tasks` with source memo id.
- Default prompt uses the minimal wrapper and raw memo body.
- It opens/copies via existing Codex handoff path.
- It records a `sent` activity message.

Verification:

- Memo detail can start Codex.
- Memo list shows `実行中 · Codex`.
- Today-completed badge disappears after the current day.

## Phase 4: Memo Detail Activity UI

Render AI execution as chat-style activity, not raw logs.

Implementation targets:

- New `MemoAiExecutionPanel` component.
- Existing `NoteClaudeRunnerPanel` can be referenced but should not drive the final mobile UX if too heavy.
- Hook/API to fetch activity messages by latest task.

UI rules:

- List: compact badge only.
- Detail running: current state + chat activity visible.
- Detail awaiting approval: latest question/approval message is prominent.
- Completed: show today, then collapse.

Verification:

- Mobile screenshot at `http://localhost:3001/dashboard?view=memo&desktop=0`.
- No overlapping text on 390px width.

## Phase 5: Organize Intent And Context

Update `整理する` to use staged context.

Implementation targets:

- `src/app/api/ai/memo-structure/route.ts` or a new route for memo organize.
- `src/lib/ai/context/project-context.ts`
- `src/lib/ai/context/mindmap-context.ts`

Stage 1:

- Memo raw body.
- All projects with compact project context:
  - title
  - description/purpose
  - `project_contexts.heading`
  - details prefix
  - progress status and progress prefix

Stage 2:

- Only candidate projects.
- Existing mindmap tree.

Output:

- Max two suggestions.
- Map placement candidate with node id and reason.
- No automatic map insertion.

Verification:

- Project context includes `heading/details/progress`.
- Non-candidate projects do not include full mindmap.
- User can change target node before commit.

## Phase 6: Map Placement UX

Add the `変更` flow for suggested map placement.

Implementation targets:

- Memo detail placement card.
- Bottom sheet selector for mobile.
- Reuse existing placement candidates where possible.

Features:

- Candidate project chips.
- Candidate node list.
- Search.
- Placement mode: child, sibling, new root.
- Confirm button.

Verification:

- Suggested target can be changed without touching the full map canvas.
- Confirmation creates the correct task/link.

## Deployment Order

1. Data model and activity-message helper.
2. Codex sync behavior and tests.
3. Memo detail/list status UI.
4. Direct memo execution.
5. Organize intent/context improvements.
6. Map placement selector.

This order allows visible execution tracking before changing the heavier organize/mindmap flow.

## Rollback Plan

- If activity messages misbehave, hide the panel and fall back to existing `ai_tasks.result.live_log`.
- If resume detection is noisy, keep `awaiting_approval` stable and require manual refresh/open Codex.
- If organize output is poor, keep existing `memo-structure` behavior and gate the new route behind a UI flag.
