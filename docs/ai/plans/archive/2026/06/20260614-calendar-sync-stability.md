# Calendar Sync Stability

- Task ID: TASK-20260614-001
- Status: completed
- Created: 2026-06-14
- Completed: 2026-06-14
- Board: `docs/ai/task-board.md`

## Goal

Google Calendar のカレンダー一覧・選択状態・イベント同期が古いDB/cacheや calendar ID の取り違えに引っ張られないようにする。

## Scope

- カレンダー一覧同期で Google に存在しない/非表示のカレンダーを stale として扱う
- イベント同期・掃除・表示 dedupe を `calendar_id + google_event_id` 基準へ寄せる
- 書き込み可能カレンダーの判定を `owner` / `writer` に統一する
- 同期仕様を `docs/CONTEXT.md` に反映する

## Non-goals

- 本番DBへの直接操作
- Google OAuth 設定や外部アカウント設定の変更
- カレンダーUI全体のデザイン変更

## Plan

1. 現行の API route / hook / migration / tests を確認する。
2. DB migration とコード側の composite key 化を小さく入れる。
3. カレンダー一覧の stale cleanup とフロントキャッシュ無効化を追加する。
4. focused tests と型チェックを実行する。

## Parallelization

`SEQUENTIAL`。DB制約、API、hook、docs が同じ同期契約に依存するため、同一チャットで直列に進める。

## Verification

- `npm run test:run -- src/lib/calendar-event-dedupe.test.ts src/lib/google-event-task-dedupe.test.ts src/app/api/tasks/import-events/route.test.ts src/app/api/calendar/events/complete/route.test.ts 'src/app/api/calendar/events/[eventId]/route.test.ts' 'src/app/api/tasks/[id]/route.test.ts' --test-timeout=30000`
- `npx eslint src/lib/calendar-event-dedupe.ts src/lib/calendar-event-dedupe.test.ts src/lib/google-event-task-dedupe.ts src/lib/google-event-task-dedupe.test.ts src/lib/google-calendar.ts src/app/api/calendar/events/list/route.ts src/app/api/calendars/route.ts src/hooks/useCalendars.ts src/components/tasks/task-calendar-select.tsx src/app/api/calendar/events/[eventId]/route.ts src/app/api/calendar/events/[eventId]/route.test.ts src/app/api/calendar/events/complete/route.ts src/app/api/calendar/events/complete/route.test.ts src/app/api/calendar/sync-task/route.ts src/app/api/tasks/import-events/route.ts src/app/api/tasks/import-events/route.test.ts src/app/api/tasks/[id]/route.ts src/app/api/tasks/[id]/route.test.ts src/app/api/tasks/[id]/schedule/route.ts src/app/api/wishlist/[id]/calendar/route.ts src/app/api/wishlist/[id]/unschedule/route.ts src/lib/ai/tools/index.ts src/app/api/ai/chat/execute/route.ts src/hooks/useCalendarEvents.ts src/hooks/useTodayViewLogic.ts src/components/dashboard/today-memo-board.tsx src/components/wishlist/wishlist-view.tsx src/lib/time-block.ts src/lib/today-range-blocks.ts src/components/today/today-board.tsx src/components/today/today-task-board.tsx src/types/calendar.ts src/types/database.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`

## Result

Google Calendar の予定・完了・タスク取り込み・表示 dedupe・orphan cleanup を `user_id + calendar_id + google_event_id` 基準へ統一した。Google calendarList から消えたカレンダーは `selected=false` として返却から外し、複数カレンダー取得の一部失敗時は成功したカレンダーだけを掃除する。

## Links

- `docs/CONTEXT.md`
- `supabase/migrations/20260614174000_calendar_composite_event_keys.sql`
