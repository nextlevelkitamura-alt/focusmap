import type { CalendarEvent } from "@/types/calendar"

export function getCalendarEventCompletionKey(event: Pick<CalendarEvent, "calendar_id" | "google_event_id">): string | null {
  if (!event.calendar_id || !event.google_event_id) return null
  return `${event.calendar_id}::${event.google_event_id}`
}

export function findCalendarEventForCompletion(events: CalendarEvent[], eventId: string): CalendarEvent | undefined {
  const exactMatch =
    events.find((event) => event.id === eventId) ??
    events.find((event) => getCalendarEventCompletionKey(event) === eventId)
  if (exactMatch) return exactMatch

  const googleEventMatches = events.filter((event) => !!event.google_event_id && event.google_event_id === eventId)
  if (googleEventMatches.length === 1) return googleEventMatches[0]

  return undefined
}

export function matchesCalendarEventCompletionTarget(
  event: CalendarEvent,
  targetEvent: Pick<CalendarEvent, "id" | "calendar_id" | "google_event_id">,
  eventId?: string,
): boolean {
  if (event.id === targetEvent.id) return true
  if (eventId && (event.id === eventId || getCalendarEventCompletionKey(event) === eventId)) return true
  if (!event.google_event_id || !targetEvent.google_event_id) return false
  return event.google_event_id === targetEvent.google_event_id && event.calendar_id === targetEvent.calendar_id
}
