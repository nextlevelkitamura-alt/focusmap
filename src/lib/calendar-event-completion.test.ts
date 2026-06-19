import { describe, expect, test } from "vitest"
import type { CalendarEvent } from "@/types/calendar"
import {
  findCalendarEventForCompletion,
  getCalendarEventCompletionKey,
  matchesCalendarEventCompletionTarget,
} from "./calendar-event-completion"

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "cal-1::google-1",
    user_id: "user-1",
    google_event_id: "google-1",
    calendar_id: "cal-1",
    title: "予定",
    start_time: "2026-06-19T10:00:00.000Z",
    end_time: "2026-06-19T11:00:00.000Z",
    is_all_day: false,
    timezone: "Asia/Tokyo",
    synced_at: "2026-06-19T09:00:00.000Z",
    created_at: "2026-06-19T09:00:00.000Z",
    updated_at: "2026-06-19T09:00:00.000Z",
    ...overrides,
  }
}

describe("calendar-event-completion", () => {
  test("calendar_id と google_event_id の複合キーで予定を探せる", () => {
    const target = event({ calendar_id: "work", google_event_id: "shared", id: "work::shared" })

    expect(findCalendarEventForCompletion([target], "work::shared")).toBe(target)
    expect(getCalendarEventCompletionKey(target)).toBe("work::shared")
  })

  test("同じ google_event_id でも calendar_id が違う予定は完了対象にしない", () => {
    const target = event({ calendar_id: "work", google_event_id: "shared", id: "work::shared" })
    const otherCalendar = event({ calendar_id: "personal", google_event_id: "shared", id: "personal::shared" })

    expect(matchesCalendarEventCompletionTarget(target, target, "work::shared")).toBe(true)
    expect(matchesCalendarEventCompletionTarget(otherCalendar, target, "work::shared")).toBe(false)
  })

  test("表示ブロックが google_event_id だけを渡した場合もfallbackで探せる", () => {
    const target = event({ calendar_id: "cal-1", google_event_id: "google-only", id: "cal-1::google-only" })

    expect(findCalendarEventForCompletion([target], "google-only")).toBe(target)
  })

  test("google_event_id だけでは複数候補がある場合に対象を決めない", () => {
    const work = event({ calendar_id: "work", google_event_id: "shared", id: "work::shared" })
    const personal = event({ calendar_id: "personal", google_event_id: "shared", id: "personal::shared" })

    expect(findCalendarEventForCompletion([work, personal], "shared")).toBeUndefined()
  })
})
