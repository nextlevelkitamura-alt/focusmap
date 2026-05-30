# Delivery Plan: memo-structure

Last updated: 2026-05-30

## Summary

MEMO-STRUCTURE has schema and application implementation in the repo, but delivery is blocked until migration state, test coverage, and branch scope are clear.

Current delivery status: `blocked`.

## Branch / PR

- Current branch: `feature/codex-node-relay`
- PR: unknown
- Recommended: keep MEMO-STRUCTURE verification/docs in a separate commit or branch unless the owner intentionally bundles it with Codex relay work.

## Touch Points

- UI: `src/components/wishlist/wishlist-card-detail.tsx`, linked memo dialogs.
- API: `src/app/api/ai/memo-structure/route.ts`, `src/app/api/memo-items/**`, `src/app/api/mindmap/memo-links/route.ts`.
- DB: `supabase/migrations/20260525_create_memo_structure_items.sql`.
- Types: `src/types/database.ts`.
- AI: `src/lib/memo-structure.ts`, `src/lib/ai-client.ts`.

## Merge Order

Recommended order if splitting work:

1. Docs/process audit.
2. MEMO-STRUCTURE tests and verification fixes.
3. Any DB invariant change for hierarchy depth or unique indexes.
4. UI/API refinements.
5. Codex relay branch work.

## Deploy Order

1. Confirm migration history and target Supabase project.
2. Verify required functions/tables exist, especially `update_updated_at_column()`, `projects`, `tasks`, `ideal_goals`, and `notes`.
3. Apply or confirm migration in non-production.
4. Run route and RLS verification.
5. Deploy app code only after DB compatibility is confirmed.
6. Record result in `docs/requirements/release-log.md`.

## Pre-Deploy Checks

- `git status --short --branch` reviewed.
- Scope of current branch accepted.
- Supabase migration state confirmed.
- Tests for structure, linking, duplicate prevention, and authorization identified or added.
- Depth-limit decision recorded.

## Post-Deploy Verification

- Structure a wishlist memo.
- Structure a note memo.
- Re-run the same request and confirm reuse.
- Link an item into the mind map.
- Attempt duplicate link and confirm reuse/prevention.
- Open the mind map linked memo dialog and confirm structured context appears.
- Confirm cross-user access is denied.

## Rollback Plan

Not yet verified.

Candidate approach:

- Disable UI/API entry points if runtime behavior is wrong.
- Prefer a forward migration fix if production data exists.
- Only drop tables/indexes if there is confirmed no production data.

## Blockers

- Branch has unrelated uncommitted changes.
- Supabase apply status unknown.
- Depth-limit rule unresolved.
- Verification suite incomplete or not recorded.
