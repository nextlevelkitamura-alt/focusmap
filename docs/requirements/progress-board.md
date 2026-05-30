# Progress Board

Last updated: 2026-05-30

## Session Resume Protocol

1. Read `docs/requirements/session-handoff.md`.
2. Run `git status --short --branch`.
3. Confirm whether the active work is still `feature/codex-node-relay`.
4. Read `docs/requirements/requirements-ledger.md` and `docs/requirements/delivery-board.md`.
5. If touching MEMO-STRUCTURE, inspect the implementation files listed in `docs/specs/memo-structure/requirements.md`.
6. Do not merge, push, or deploy until delivery blockers are resolved or explicitly accepted.

## Done

- REQ-013: Canonical development-management docs are now present in the main Focusmap repo.

No product requirement is marked `done` yet.

## In Progress

- `feature/codex-node-relay`: Active branch has ongoing uncommitted work unrelated to this requirements audit.

## Needs Verification

- MEMO-STRUCTURE end-to-end behavior exists in code but needs verification.
- REQ-001: Raw memo separation.
- REQ-002: Wishlist/note source support.
- REQ-003: Structure run reuse/idempotency.
- REQ-004: Memo item deduplication.
- REQ-005: Memo item lifecycle transitions.
- REQ-006: Memo item to mind map task linking.
- REQ-007: Duplicate active mind map insertion prevention.
- REQ-008: Linked memo context display from mind map.
- REQ-009: Cross-user access isolation.

## Verification Run

- 2026-05-30: `npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/mindmap-model.test.ts` passed: 2 files, 6 tests. This verifies adjacent mind map logic only; it does not close MEMO-STRUCTURE route/RLS requirements.

## Blocked

- REQ-010: Intended memo item depth limit is not clearly enforced.
- REQ-011: Supabase migration deployment/verification is not recorded.
- REQ-012: Current branch contains unrelated uncommitted changes, so PR/deploy scope is unclear.

## Deferred

- Dedicated tests for MEMO-STRUCTURE routes and RLS.
- Decide whether `memo_structure_runs_unique_completed_input_idx` should include `mode`.
- Stronger DB-level hierarchy enforcement if two-level depth is a hard invariant.

## Deprecated

- None identified.
