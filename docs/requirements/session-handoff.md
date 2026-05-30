# Session Handoff

Last updated: 2026-05-30

## Current Repo

Main Focusmap repo:

- `/Users/kitamuranaohiro/Private/focusmap`

Current branch at audit time:

- `feature/codex-node-relay`

Important git state at audit time:

- Branch has existing uncommitted changes unrelated to this requirements audit.
- Do not stage or commit those unrelated changes unless explicitly requested.
- Docs added by this audit should be reviewed and committed separately if approved.

## What Was Added

- `docs/requirements/product-requirements.md`
- `docs/requirements/requirements-ledger.md`
- `docs/requirements/progress-board.md`
- `docs/requirements/contradictions.md`
- `docs/requirements/non-goals.md`
- `docs/requirements/delivery-board.md`
- `docs/requirements/release-log.md`
- `docs/requirements/session-handoff.md`
- `docs/specs/memo-structure/requirements.md`
- `docs/specs/memo-structure/delivery-plan.md`
- `docs/adr/0001-memo-structure-foundation.md`

Note: `docs/status.md` is gitignored. It may contain a local pointer, but it is not the canonical versioned handoff.

## MEMO-STRUCTURE Evidence

Read these before changing memo-structure behavior:

- `supabase/migrations/20260525_create_memo_structure_items.sql`
- `src/lib/memo-structure.ts`
- `src/app/api/ai/memo-structure/route.ts`
- `src/app/api/memo-items/route.ts`
- `src/app/api/memo-items/[id]/link-task/route.ts`
- `src/app/api/memo-items/[id]/placement-candidates/route.ts`
- `src/app/api/memo-items/[id]/research-prompt/route.ts`
- `src/app/api/mindmap/memo-links/route.ts`
- `src/components/wishlist/wishlist-card-detail.tsx`
- `src/components/mindmap/mindmap-linked-memos-dialog.tsx`

## Known Blockers

- Current branch scope is not clean.
- Supabase migration apply status is not recorded.
- Two-level memo item hierarchy is not clearly enforced.
- MEMO-STRUCTURE route/RLS tests are not identified as complete.

## Next Safe Action

Scoped verification already run on 2026-05-30:

```sh
git status --short --branch
npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/mindmap-model.test.ts
```

Result: test command passed, 2 files and 6 tests.

Then decide whether to:

- commit docs-only changes separately,
- create a dedicated branch for MEMO-STRUCTURE verification,
- or continue on `feature/codex-node-relay` with explicit scope acceptance.
