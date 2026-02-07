# Handoff to Claude Code

## Project Status

**App Name**: SHIKUMIKA (Task & Calendar Management)
**Stack**: Next.js 16 (App Router), React 19, Supabase, Tailwind CSS 4, Radix UI.
**State**: Pre-production / MVP (Phase 2 Complete).

## Recent Changes (Phase 2 by Gemini)

- **Calendar UI Expansion**: Added Month, Week, 3-Day, and Day views.
    - `src/components/calendar/calendar-header.tsx`: View switcher added.
    - `src/components/calendar/calendar-3day-view.tsx`: New component.
- **Task Form Update**: Added `Calendar Type` selection.
    - `src/components/tasks/task-calendar-select.tsx`: New dropdown component.
    - `src/components/dashboard/center-pane.tsx`: Integrated dropdown into task list.
- **Deployment**:
    - **Vercel**: Deployment paused.
    - **Netlify**: User has Site ID (`9d7de87b-09d2-4eb8-8a7c-a6efef905cd6`).
    - **Migration Tool**: `scripts/migrate-to-netlify.sh` created to automate env var import.

## Next Steps for Claude Code

1.  **Assist with Netlify Migration**:
    - Ask user if they ran `scripts/migrate-to-netlify.sh`.
    - If not, guide them to run it (requires `npx netlify login` first).
2.  **Google Calendar Integration**: Ensure calendar selection actually syncs events.
3.  **Mobile Polish**: Check 3-Day view on mobile devices.
4.  **Performance**: Optimize calendar rendering with large datasets.

## Key Files
- `src/components/calendar/calendar-view.tsx`: Main calendar container.
- `src/components/dashboard/center-pane.tsx`: Task management core.
- `docs/deployment/netlify-migration.md`: Deployment instructions.
