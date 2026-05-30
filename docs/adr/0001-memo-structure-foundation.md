# ADR 0001: Memo Structure Foundation

Date: 2026-05-30

Status: Proposed, implemented in code, needs verification.

## Context

Focusmap needs a layer between raw user memos and the mind map. Raw wishlist/note sources should stay intact, while AI/manual decomposition should produce smaller units that can be reviewed, dismissed, archived, promoted, or linked into the task map.

## Decision

Use three tables:

- `memo_structure_runs`: records decomposition attempts, effective input hash, feedback, context snapshots, result, and status.
- `memo_items`: stores structured memo fragments with lifecycle status and source references.
- `memo_node_links`: links structured memo items to mind map task nodes or related task/schedule targets.

Use route-level user filtering and DB RLS scoped by `user_id`.

Use hashes and unique indexes to reduce duplicate structure runs, duplicate memo items, and duplicate active mind map insertion.

## Consequences

- Raw memo data remains separate from generated structure.
- Repeated structuring can reuse previous results when the effective input is unchanged.
- Mind map insertion is idempotent for active memo item links.
- Source references are polymorphic, so source integrity is partly enforced by application code.
- The intended two-level memo item hierarchy is not fully enforced by the visible DB schema.

## Follow-Up Decisions

- Decide depth enforcement.
- Decide whether the completed-run unique index should include `mode`.
- Add verification for RLS and duplicate prevention.
- Record migration deploy status before marking delivery complete.
