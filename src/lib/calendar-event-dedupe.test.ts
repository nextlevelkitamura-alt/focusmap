import { describe, expect, test } from "vitest"
import type { CalendarEvent } from "@/types/calendar"
import { dedupeCalendarEventsForDisplay } from "./calendar-event-dedupe"

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    user_id: "user-1",
    google_event_id: "google-1",
    calendar_id: "cal-1",
    title: "予定",
    start_time: "2026-06-12T10:00:00.000Z",
    end_time: "2026-06-12T11:00:00.000Z",
    is_all_day: false,
    timezone: "Asia/Tokyo",
    synced_at: "2026-06-12T09:00:00.000Z",
    created_at: "2026-06-12T09:00:00.000Z",
    updated_at: "2026-06-12T09:00:00.000Z",
    ...overrides,
  }
}

describe("dedupeCalendarEventsForDisplay", () => {
  test("同じgoogle_event_idのイベントは1件に畳み込む", () => {
    const events = dedupeCalendarEventsForDisplay([
      event({ id: "old", title: "古い予定", updated_at: "2026-06-12T09:00:00.000Z" }),
      event({ id: "new", title: "新しい予定", updated_at: "2026-06-12T10:00:00.000Z" }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].title).toBe("新しい予定")
  })

  test("同じ時刻とタイトルの楽観イベントは実イベントに置き換わる", () => {
    const events = dedupeCalendarEventsForDisplay([
      event({
        id: "optimistic",
        google_event_id: "",
        sync_status: "pending",
        created_at: "2026-06-12T10:00:00.000Z",
      }),
      event({
        id: "google",
        google_event_id: "google-2",
        sync_status: undefined,
        created_at: "2026-06-12T10:00:05.000Z",
      }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe("google")
  })
})
