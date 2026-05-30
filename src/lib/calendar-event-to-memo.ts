import type { CalendarEvent } from "@/types/calendar"

export type CalendarEventMemoDeleteScope = "this" | "series"

export type CalendarEventMemoPayload = {
  eventId: string
  googleEventId: string
  calendarId: string
  title: string
  description?: string | null
  location?: string | null
  startTime: string
  endTime: string
  isAllDay?: boolean
  timezone?: string | null
  recurrence?: string[] | null
  recurringEventId?: string | null
}

export const CALENDAR_EVENT_TO_MEMO_CONVERTED_EVENT = "focusmap:calendar-event-to-memo-converted" as const

export function buildCalendarEventMemoPayload(event: CalendarEvent): CalendarEventMemoPayload | null {
  if (!event.google_event_id || !event.calendar_id) return null
  return {
    eventId: event.id,
    googleEventId: event.google_event_id,
    calendarId: event.calendar_id,
    title: event.title || "無題の予定",
    description: event.description ?? null,
    location: event.location ?? null,
    startTime: event.start_time,
    endTime: event.end_time,
    isAllDay: event.is_all_day,
    timezone: event.timezone ?? "Asia/Tokyo",
    recurrence: event.recurrence ?? null,
    recurringEventId: event.recurring_event_id ?? null,
  }
}

export function broadcastCalendarEventToMemoConverted(payload: CalendarEventMemoPayload) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CALENDAR_EVENT_TO_MEMO_CONVERTED_EVENT, {
    detail: payload,
  }))
}

export function isRecurringCalendarEventMemo(payload: Pick<CalendarEventMemoPayload, "recurrence" | "recurringEventId">) {
  return !!payload.recurringEventId || !!payload.recurrence?.length
}

export function confirmCalendarEventMemoDeleteScope(payload: CalendarEventMemoPayload): CalendarEventMemoDeleteScope | null {
  if (!isRecurringCalendarEventMemo(payload)) return "this"
  const deleteSeries = window.confirm(
    `「${payload.title || "無題の予定"}」は繰り返し予定です。\n\nOK: 繰り返し予定を全部消してメモにする\nキャンセル: この1回だけ消してメモにする`
  )
  return deleteSeries ? "series" : "this"
}

export async function convertCalendarEventToMemo(
  payload: CalendarEventMemoPayload,
  options: {
    projectId?: string | null
    deleteScope?: CalendarEventMemoDeleteScope
  } = {},
) {
  const deleteScope = options.deleteScope ?? "this"
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(payload.eventId)}/memo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      googleEventId: payload.googleEventId,
      calendarId: payload.calendarId,
      title: payload.title,
      description: payload.description ?? null,
      location: payload.location ?? null,
      startTime: payload.startTime,
      endTime: payload.endTime,
      isAllDay: payload.isAllDay ?? false,
      timezone: payload.timezone ?? "Asia/Tokyo",
      recurrence: payload.recurrence ?? null,
      recurringEventId: payload.recurringEventId ?? null,
      deleteScope,
      project_id: options.projectId ?? null,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(data.error || "予定をメモにできませんでした")
  }
  return data
}
