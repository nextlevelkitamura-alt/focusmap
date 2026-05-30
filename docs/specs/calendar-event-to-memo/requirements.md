# Requirements: calendar-event-to-memo

Last updated: 2026-05-30

## Summary

Users can turn a Google Calendar event from the right-side timeline into a Focusmap memo by dragging it to the left memo board or using the memo action. The source calendar event is deleted after the memo is created.

## Requirements

1. A Google Calendar event without an existing memo creates a new `ideal_goals` memo.
2. The memo title is copied from the event title.
3. The memo body preserves the original time, location, and description.
4. The memo is placed in the unscheduled column.
5. The source Google Calendar event is deleted after memo creation.
6. Recurring events warn the user and support deleting either the current occurrence or the full series.
7. Read-only calendars must be rejected before conversion.
8. Conversion metadata is stored in `calendar_event_memo_conversions`.

## Acceptance

- Normal event: drag right timeline event to the left board, confirm memo appears in `未予定`, and event disappears from Google Calendar.
- Recurring event occurrence: choose this occurrence, confirm only one event instance is deleted.
- Recurring event series: choose whole series, confirm all instances are deleted.
- Failure before deletion: no duplicate memo remains.
- Audit: conversion row records `memo_id`, `calendar_id`, `google_event_id`, `delete_scope`, and event snapshot.
