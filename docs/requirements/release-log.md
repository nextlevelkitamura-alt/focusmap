# Release Log

Last updated: 2026-05-30

| Date | Release | Items | Merge Order | Deploy Result | Verification | Rollback Notes |
|---|---|---|---|---|---|---|
| 2026-05-30 | development-management-docs | REQ-013 | docs-only | not deployed | `npm test -- --run src/lib/ai/memo-to-mindmap.test.ts src/lib/mindmap-model.test.ts` passed | no runtime rollback needed |
| 2026-05-30 | memo-structure | MEMO-STRUCTURE | unknown | pending | pending | DB rollback strategy not verified |
| 2026-05-30 | calendar-event-to-memo | REQ-014, REQ-015, REQ-016 | commit `c538292` | deployed to Cloud Run revision `shikumika-app-00478-cjj` | `npx tsc --noEmit` passed; targeted eslint 0 errors; `npm test -- --run src/components/dashboard/today-memo-board.test.tsx` passed; Supabase migration `20260530143000` applied | Keep `calendar_event_memo_conversions` audit rows; disable UI/API if rollback is needed after production use. |

## Notes

- No MEMO-STRUCTURE release is marked `deployed`.
- Update this file when a PR, merge, migration apply result, or deployment record is confirmed.
