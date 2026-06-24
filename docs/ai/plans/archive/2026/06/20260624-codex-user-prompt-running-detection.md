# Codex user prompt running detection

## Status

- Completed: 2026-06-24
- Task: TASK-20260624-001
- Mode: SINGLE_CHAT_WITH_READONLY_SUBAGENTS
- Worktree: `/Users/kitamuranaohiro/Private/focusmap-codex-reconcile-main`

## Findings

- `focusmap-agent` could read Codex rollout `user_message` / `message role=user` before assistant output, but initial prompt events were not consistently used as the current rally start.
- Linked `ai_tasks.result.codex_turn_started_at` used `latestTaskStartedAt` only, so prompt-detected running could appear without the authoritative start time.
- Task-progress snapshot `updated_at` used Codex activity time, which could fall behind the UI incremental cursor and make status/title changes appear only after a later assistant event.
- The UI can render `running` immediately once the API stores `status='running'`; the main issue was upstream detection/write semantics, not the card UI.

## Changes

- Treat initial and resumed user prompt rollout events as running evidence and current rally start before assistant text appears.
- Preserve the prompt event as the running presentation start when `task_started` arrives later.
- Persist linked task `codex_turn_started_at` from the active rally start before falling back to `task_started`.
- Use DB write time for Turso task-progress snapshot `updated_at` while keeping Codex activity time in result fields.
- Updated `docs/CONTEXT.md` to separate display activity time from snapshot cursor time.

## Verification

- Not run: tests/lint/build/browser checks were not explicitly requested under the repository verification policy.
- Regression tests were added for the initial prompt and prompt-before-`task_started` cases, but not executed.
