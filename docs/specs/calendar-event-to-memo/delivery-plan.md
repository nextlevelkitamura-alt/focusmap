# Delivery Plan: calendar-event-to-memo

Last updated: 2026-05-30

## Touch Points

- DB: `supabase/migrations/20260530143000_calendar_event_memo_conversions.sql`
- API: `src/app/api/calendar/events/[eventId]/memo/route.ts`
- Client helper: `src/lib/calendar-event-to-memo.ts`
- UI: `src/components/today/today-timeline-calendar.tsx`
- UI: `src/components/dashboard/today-memo-board.tsx`
- Hook: `src/hooks/useTodayViewLogic.ts`

## Verification

1. Apply the migration to the target Supabase project.
2. Run `npx tsc --noEmit`.
3. Run targeted eslint for the touched files.
4. Run `npm test -- --run src/components/dashboard/today-memo-board.test.tsx`.
5. In the browser, convert a normal Google Calendar event to a memo.
6. Convert one occurrence of a recurring event.
7. Convert an entire recurring event series.
8. Verify `calendar_event_memo_conversions` rows are visible only to the owning user.

## Rollback

- Before production data: drop `calendar_event_memo_conversions` and revert the API/client changes.
- After production data: keep the audit table, disable the UI entry points, and stop calling the conversion API.
