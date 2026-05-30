# Focusmap Product Requirements

Last updated: 2026-05-30

## Product Direction

Focusmap is an AI-managed dashboard where the user reviews, approves, and steers work from a high-level map.

Primary references:

- `README.md`
- `AGENTS.md`
- `docs/plans/focusmap-pivot.md`
- `docs/CONTEXT.md`
- `docs/ROADMAP.md`

## Current Managed Scope

### CALENDAR-EVENT-TO-MEMO

Convert a Google Calendar event on the right-side timeline into an unscheduled Focusmap memo by dragging it to the left memo board or using the memo action.

Current status: `deployed_needs_recurring_verification`.

Key implementation evidence:

- `supabase/migrations/20260530143000_calendar_event_memo_conversions.sql`
- `src/app/api/calendar/events/[eventId]/memo/route.ts`
- `src/lib/calendar-event-to-memo.ts`
- `src/components/today/today-timeline-calendar.tsx`
- `src/components/dashboard/today-memo-board.tsx`
- `src/hooks/useTodayViewLogic.ts`

Acceptance criteria before this feature is `done`:

1. A Google Calendar event without an existing memo can become a new memo.
2. The new memo title is the event title.
3. The new memo is unscheduled: `scheduled_at = null`, `google_event_id = null`, `memo_status = unsorted`, `is_today = false`.
4. The source Google Calendar event is deleted after memo creation.
5. Recurring events warn the user and support either this occurrence or the whole series.
6. The conversion stores original event metadata and delete scope for traceability.
7. Read-only calendars are rejected before memo conversion.
8. Failure before Google deletion does not leave a duplicate memo.

### MEMO-STRUCTURE

Turn raw user memos from wishlist items or notes into structured, reviewable memo items, then let selected items be linked into the mind map as task nodes or supporting context.

Current status: `needs_verification`.

Key implementation evidence:

- `supabase/migrations/20260525_create_memo_structure_items.sql`
- `src/lib/memo-structure.ts`
- `src/app/api/ai/memo-structure/route.ts`
- `src/app/api/memo-items/route.ts`
- `src/app/api/memo-items/[id]/link-task/route.ts`
- `src/app/api/mindmap/memo-links/route.ts`
- `src/components/wishlist/wishlist-card-detail.tsx`

Acceptance criteria before this feature is `done`:

1. Raw wishlist or note content remains available as the source of truth.
2. Structure runs are recorded with input hash, mode, feedback, context snapshots, and result.
3. Existing completed runs can be reused for the same effective input.
4. Memo items are deduplicated per user/source/content hash.
5. Memo items can be reviewed, updated, dismissed, archived, or promoted.
6. A memo item can create or link to a mind map task node.
7. The same memo item cannot be inserted as an active mind map node twice.
8. Linked memo items are visible from the mind map node context.
9. RLS or equivalent checks prevent cross-user access.
10. Tests or manual verification cover the happy path, duplicate prevention, and RLS-sensitive paths.

## Operating Rules

- Do not mark product requirements `done` without evidence.
- Do not mark delivery `deployed` without deploy or migration verification evidence.
- Keep new ideas as `proposed` until acceptance criteria, non-goals, impact files, and verification are clear.
- If work is interrupted, restart from `docs/requirements/session-handoff.md`.

## Known Constraints

- Current branch is `feature/codex-node-relay`.
- The branch has unrelated uncommitted changes. Do not mix them into documentation or MEMO-STRUCTURE commits.
- `docs/status.md` is gitignored in this repo; the canonical, versioned handoff is `docs/requirements/session-handoff.md`.
