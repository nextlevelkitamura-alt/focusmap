import { describe, expect, test } from "vitest"
import { dedupeGoogleEventTasks } from "./google-event-task-dedupe"

describe("dedupeGoogleEventTasks", () => {
  test("同じgoogle_event_idの手動タスクと自動取り込みタスクは手動タスクを優先する", () => {
    const tasks = [
      {
        id: "imported",
        google_event_id: "google-1",
        calendar_id: "work",
        source: "google_event",
        status: "todo",
        updated_at: "2026-06-12T10:00:00Z",
      },
      {
        id: "manual",
        google_event_id: "google-1",
        calendar_id: "work",
        source: "manual",
        status: "todo",
        updated_at: "2026-06-12T09:00:00Z",
      },
      {
        id: "other",
        google_event_id: "google-2",
        calendar_id: "work",
        source: "google_event",
        status: "todo",
      },
    ]

    expect(dedupeGoogleEventTasks(tasks).map(task => task.id)).toEqual(["manual", "other"])
  })

  test("同じgoogle_event_idでも別カレンダーなら別タスクとして残す", () => {
    const tasks = [
      {
        id: "work",
        google_event_id: "google-1",
        calendar_id: "work",
        source: "google_event",
      },
      {
        id: "personal",
        google_event_id: "google-1",
        calendar_id: "personal",
        source: "google_event",
      },
    ]

    expect(dedupeGoogleEventTasks(tasks).map(task => task.id)).toEqual(["work", "personal"])
  })

  test("google_event_idがないタスクはそのまま残す", () => {
    const tasks = [
      { id: "task-1", google_event_id: null, source: "manual" },
      { id: "task-2", google_event_id: "", source: "manual" },
    ]

    expect(dedupeGoogleEventTasks(tasks)).toEqual(tasks)
  })
})
