import { describe, expect, test } from "vitest"
import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { buildTimeBlocksForDay, countScheduleItemsForDay } from "./today-range-blocks"

function task(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    user_id: "user-1",
    project_id: null,
    parent_task_id: null,
    is_group: false,
    title: "予定",
    status: "todo",
    stage: "scheduled",
    priority: null,
    order_index: 0,
    scheduled_at: "2026-06-12T10:00:00.000Z",
    estimated_time: 30,
    actual_time_minutes: 0,
    google_event_id: null,
    calendar_event_id: null,
    calendar_id: null,
    total_elapsed_seconds: 0,
    last_started_at: null,
    is_timer_running: false,
    created_at: "2026-06-12T09:00:00.000Z",
    updated_at: "2026-06-12T09:00:00.000Z",
    source: "manual",
    deleted_at: null,
    google_event_fingerprint: null,
    is_habit: false,
    habit_frequency: null,
    habit_icon: null,
    habit_start_date: null,
    habit_end_date: null,
    memo: null,
    memo_images: null,
    node_width: null,
    mindmap_collapsed: false,
    ...overrides,
  }
}

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

describe("today-range-blocks", () => {
  test("同じgoogle_event_idを持つ手動タスクと自動取り込みタスクは1件として数える", () => {
    const count = countScheduleItemsForDay({
      date: new Date("2026-06-12T00:00:00.000Z"),
      events: [],
      tasks: [
        task({ id: "manual", source: "manual", google_event_id: "google-1", calendar_id: "cal-1" }),
        task({ id: "imported", source: "google_event", google_event_id: "google-1", calendar_id: "cal-1" }),
      ],
    })

    expect(count).toBe(1)
  })

  test("タイトル欠損イベントが3日/月表示の集計に混ざっても例外にしない", () => {
    const blocks = buildTimeBlocksForDay({
      date: new Date("2026-06-12T00:00:00.000Z"),
      events: [
        event({
          id: "bad-title",
          title: null as unknown as string,
        }),
      ],
      tasks: [],
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe("(No title)")
  })

  test("日時不正イベントは3日/月表示の集計から除外する", () => {
    const count = countScheduleItemsForDay({
      date: new Date("2026-06-12T00:00:00.000Z"),
      events: [
        event({
          id: "bad-date",
          start_time: "not-a-date",
        }),
      ],
      tasks: [],
    })

    expect(count).toBe(0)
  })
})
