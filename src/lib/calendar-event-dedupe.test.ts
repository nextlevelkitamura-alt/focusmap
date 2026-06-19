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
  test("同じカレンダー内の同じgoogle_event_idは1件に畳み込む", () => {
    const events = dedupeCalendarEventsForDisplay([
      event({ id: "old", title: "古い予定", updated_at: "2026-06-12T09:00:00.000Z" }),
      event({ id: "new", title: "新しい予定", updated_at: "2026-06-12T10:00:00.000Z" }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].title).toBe("新しい予定")
  })

  test("別カレンダーの同じgoogle_event_idは別イベントとして残す", () => {
    const events = dedupeCalendarEventsForDisplay([
      event({ id: "work", google_event_id: "shared-id", calendar_id: "work", title: "仕事" }),
      event({ id: "personal", google_event_id: "shared-id", calendar_id: "personal", title: "個人" }),
    ])

    expect(events).toHaveLength(2)
    expect(events.map(item => item.id).sort()).toEqual(["personal", "work"])
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

  test("古いキャッシュに不正なIDやタイトルが混ざっても例外にしない", () => {
    const events = dedupeCalendarEventsForDisplay([
      event({
        id: "cached-bad-shape",
        google_event_id: null as unknown as string,
        title: null as unknown as string,
      }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe("cached-bad-shape")
  })
})
