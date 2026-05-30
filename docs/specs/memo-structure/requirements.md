# MEMO-STRUCTURE Requirements

Last updated: 2026-05-30

## Summary

MEMO-STRUCTURE converts raw wishlist or note sources into structured, reviewable memo items and links selected items into the mind map/task flow.

Current status: `needs_verification`.

## Implementation Surface

- Schema: `supabase/migrations/20260525_create_memo_structure_items.sql`
- Types/helpers: `src/lib/memo-structure.ts`
- Structure API: `src/app/api/ai/memo-structure/route.ts`
- Item CRUD API: `src/app/api/memo-items/route.ts`
- Link API: `src/app/api/memo-items/[id]/link-task/route.ts`
- Placement candidates: `src/app/api/memo-items/[id]/placement-candidates/route.ts`
- Research prompt: `src/app/api/memo-items/[id]/research-prompt/route.ts`
- Mind map memo context: `src/app/api/mindmap/memo-links/route.ts`
- Wishlist UI entry: `src/components/wishlist/wishlist-card-detail.tsx`

## Functional Requirements

1. Load raw source data from either `ideal_goals` (`wishlist`) or `notes` (`note`).
2. Build an input hash from source content, mode, context, and feedback.
3. Reuse an existing completed run when the effective input has already been structured.
4. Create a new structure run when no reusable run exists.
5. Produce up to three actionable structured items from local quick mode or AI deep mode.
6. Store structured items with source, optional parent, project, kind, lifecycle status, confidence, metadata, and hashes.
7. Archive replaceable quick-mode items that are not already linked before inserting fresh results.
8. Let users update item fields and status.
9. Let users link a memo item to an existing task or create a new task.
10. Prevent duplicate active mind map links for the same memo item.
11. Let mind map nodes show linked source memo context.

## Acceptance Criteria

- `quick` mode structures a wishlist source and returns memo items.
- `deep` mode either returns valid AI JSON or falls back to local structuring.
- Repeating the same effective request reuses the existing run.
- Duplicate memo item content is reused or safely ignored.
- Linking an item creates or reuses a task and creates `memo_node_links`.
- Attempting to link the same item twice returns the existing link instead of creating another active link.
- Authorization prevents one user from reading or mutating another user's memo items.
- RLS behavior is verified against the target Supabase environment.

## Open Decisions

- Is the "2-level memo fragments" rule a hard invariant?
- Should the DB enforce hierarchy depth?
- Should the completed-run unique index include `mode`, or is `input_hash` sufficient because it already includes mode?
- Should `schedule` links reference a dedicated schedule/calendar row, or is task linkage enough?
- Which tests should be the minimum gate before PR?
