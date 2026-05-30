# Release Log

Last updated: 2026-05-30

| Date | Release | Items | Merge Order | Deploy Result | Verification | Rollback Notes |
|---|---|---|---|---|---|---|
| 2026-05-30 | development-management-docs | REQ-013 | docs-only | not deployed | `npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/mindmap-model.test.ts` passed | no runtime rollback needed |
| 2026-05-30 | memo-structure | MEMO-STRUCTURE | unknown | pending | pending | DB rollback strategy not verified |

## Notes

- No MEMO-STRUCTURE release is marked `deployed`.
- Update this file when a PR, merge, migration apply result, or deployment record is confirmed.
