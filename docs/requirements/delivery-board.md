# Delivery Board

Last updated: 2026-05-30

| ID | Branch/PR | Feature | Status | Touch Points | Depends On | Deploy Risk | Verification | Owner/Next |
|---|---|---|---|---|---|---|---|---|
| DEL-001 | `feature/codex-node-relay` / PR unknown | Codex relay | active | `scripts/run-codex-app-server.sh`, dashboard/calendar/today UI, hooks | Existing uncommitted changes | medium | Pending owner-specific verification | Do not mix with MEMO-STRUCTURE unless intentionally bundled. |
| DEL-002 | branch unknown | MEMO-STRUCTURE | blocked | `supabase/migrations/20260525_create_memo_structure_items.sql`, `src/lib/memo-structure.ts`, memo API routes, wishlist detail UI, mindmap memo links | Supabase migration state, route/RLS tests, depth decision | medium | Pending: route tests, RLS verification, migration verification | Confirm whether to verify on current branch or split to a dedicated branch. |
| DEL-003 | docs-only local change | Development management docs | ready_for_review | `docs/requirements/*`, `docs/specs/memo-structure/*`, `docs/adr/*` | None beyond owner review | low | `npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/mindmap-model.test.ts` passed | Commit separately only if explicitly approved. |
| DEL-004 | `feature/codex-node-relay` / commit `c538292` | CALENDAR-EVENT-TO-MEMO | deployed | `supabase/migrations/20260530143000_calendar_event_memo_conversions.sql`, `src/app/api/calendar/events/[eventId]/memo/route.ts`, today timeline/memo board | Recurring event and RLS verification | medium | `npx tsc --noEmit` passed; targeted eslint 0 errors; targeted test passed; Supabase migration applied; Cloud Run `shikumika-app-00478-cjj` deployed | Verify recurring occurrence/series and RLS visibility. |

## Delivery Gate Result

Proceed to implementation: `needs_decision`.

Reasons:

- The active branch contains unrelated work.
- MEMO-STRUCTURE deployment state is unknown.
- The depth-limit rule is undecided.
- MEMO-STRUCTURE-specific route/RLS/migration verification has not been run for this audit.

## Required Before PR or Deploy

- Decide whether docs-only management changes should be committed on this branch or split.
- Confirm Supabase migration application status.
- Add or run tests for memo structure run reuse, memo item linking, duplicate link prevention, and authorization.
- Resolve the two-level hierarchy rule.
- Record rollback strategy before deploying DB changes.
