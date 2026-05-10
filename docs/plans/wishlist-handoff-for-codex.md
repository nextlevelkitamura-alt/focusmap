# Wishlist Feature — Codex Handoff

## What to build

A new **Wishlist view** for Focusmap — a place to manage long-term things you want to learn, explore, or do.

**Features:**
- Card-based grid layout (1 column mobile, 2–3 columns desktop)
- Each card: title, cover image, memo, date/time, duration, category tag, subtask checklist, checkbox
- 3 visual states: unscheduled (default) / calendar-linked (blue border + badge) / completed (grayed out + moves to archive section at bottom)
- Text input at the top: type anything freely → AI parses it → proposes a card or calendar event → user approves in 1 tap
- Cards with date/time can be pushed to Google Calendar

**Navigation changes:**
- Rename desktop tab "ボード" → "Today", "長期" → "Wish"
- Reorder desktop tabs: Today → Wish → マップ → 習慣 → 理想
- Mobile bottom nav: today / wish / habits / ai (4 columns, remove overflow "More" menu)

## Branch

Work on: **`feat/wishlist-codex`**

Claude Code is implementing the same feature in parallel on: `feat/wishlist-claude`

Both branches start from `main`.

## Running locally alongside Claude's branch

Use git worktree so both branches run simultaneously without switching:

```bash
# from the project root (Claude is already running on port 3000)
git worktree add ../focusmap-codex feat/wishlist-codex
cd ../focusmap-codex
npm install
PORT=3001 npm run dev
```

Claude's version → `http://localhost:3000`  
Codex's version → `http://localhost:3001`

After implementing, both versions will be compared and the better one (or best parts of each) will be merged to `main`.

## Key files to read first

- `src/contexts/ViewContext.tsx` — view IDs (`'long-term'` is the view key for Wishlist — do not rename the ID)
- `src/components/layout/header.tsx` — desktop nav tabs
- `src/components/mobile/bottom-nav.tsx` — mobile bottom nav
- `src/components/dashboard/center-pane.tsx` — where views are rendered by active view
- `src/app/dashboard/dashboard-client.tsx` — master layout component
- `src/types/database.ts` — existing table types (see `ideal_goals` and `ideal_items`)
- `src/app/api/ideals/route.ts` — existing API for `ideal_goals` (reuse, don't recreate)
- `supabase/migrations/` — existing DB migrations for reference

## Notes

- Tech stack: Next.js 14 App Router / TypeScript / Tailwind CSS / Radix UI / Supabase
- `'long-term'` view ID in ViewContext stays as-is; only the display label changes
- Wishlist data can reuse the existing `ideal_goals` and `ideal_items` tables (add columns via migration as needed)
- AI intake should call an OpenAI-compatible API via `EXTERNAL_AI_API_KEY` env var (server-side only)
- Mobile-first: tap targets min 44px
- Do not commit `.env.local` or any API keys
