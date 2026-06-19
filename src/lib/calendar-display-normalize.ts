import type { CalendarEvent } from "@/types/calendar"
import type { Task } from "@/types/database"

const FALLBACK_EVENT_TITLE = "(No title)"
const FALLBACK_TASK_TITLE = "無題のタスク"

export function displayText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const text = value.trim()
  return text || fallback
}

export function calendarEventTitle(event: Pick<CalendarEvent, "title">): string {
  return displayText((event as { title?: unknown }).title, FALLBACK_EVENT_TITLE)
}

export function taskTitle(task: Pick<Task, "title">): string {
  return displayText((task as { title?: unknown }).title, FALLBACK_TASK_TITLE)
}

export function calendarEventGoogleId(event: Pick<CalendarEvent, "google_event_id">): string {
  const value = (event as { google_event_id?: unknown }).google_event_id
  return typeof value === "string" ? value : ""
}

export function calendarEventDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
