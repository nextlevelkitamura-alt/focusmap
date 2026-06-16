# Delivery Plan: desktop-todo-calendar-only

Status: `planned`
Last updated: 2026-06-17

## Summary

PC版 `Todo` を、中央のメモ/タイムライン/AI実行サブビューつき分割画面から、全幅3日カレンダー画面へ切り替える。

## Related Requirements

- `REQ-017`: Desktop Todo can be simplified to a calendar-only 3days view.

## Touch Points

UI:

- `src/app/dashboard/dashboard-client.tsx`
- `src/components/dashboard/desktop-today-panel.tsx`
- `src/components/dashboard/desktop-right-panel.tsx`
- `src/components/today/today-3days-calendar.tsx`

API:

- No planned changes.

DB:

- No planned changes.

External services:

- No planned changes to Google Calendar integration.

## Suggested Implementation Order

1. Add an explicit default range mode prop to `DesktopTodayPanel`.
2. Render `DesktopTodayPanel` or a thin Todo calendar wrapper in the desktop `Todo` main pane.
3. Prevent the right calendar side panel from also rendering when `activeView === 'today'`.
4. Pass `defaultRangeMode="3days"` only for the desktop Todo main pane.
5. Keep optional map/long-term side calendars on their existing default behavior.
6. Tune 3days card density only if full-width screenshots show unreadable wrapping.
7. Update `docs/CONTEXT.md` after implementation because this changes a major desktop dashboard UI flow.

## Verification

Per repository policy, Codex should not run verification commands unless explicitly requested.

Useful checks if requested:

- `npm run lint`
- `npm run build`
- Desktop visual check at `http://localhost:3001/dashboard`
- Mobile visual check to confirm Today is unchanged

## Rollback Plan

Revert the small UI commit. No DB or API migration is involved.

## Blockers

- Decide whether "表示のみ" means only the screen should show calendar, or whether event create/edit/delete controls should also be disabled.

