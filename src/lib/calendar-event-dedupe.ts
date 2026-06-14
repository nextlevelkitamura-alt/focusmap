import type { CalendarEvent } from "@/types/calendar"

function hasGoogleEventId(event: CalendarEvent): boolean {
  return event.google_event_id.trim().length > 0
}

function eventSignature(event: CalendarEvent): string {
  return [
    event.calendar_id,
    event.title.trim().toLowerCase(),
    event.start_time,
    event.end_time,
    event.is_all_day ? "all-day" : "timed",
  ].join("|")
}

function googleEventKey(event: CalendarEvent): string {
  return `${event.calendar_id}::${event.google_event_id}`
}

function eventTimeValue(value?: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function eventRank(event: CalendarEvent): number {
  let rank = 0
  if (hasGoogleEventId(event)) rank += 100
  if (event.sync_status !== "pending") rank += 20
  if (event.sync_status !== "confirmed") rank += 5
  rank += Math.min(eventTimeValue(event.updated_at || event.synced_at || event.created_at) / 1_000_000_000_000, 9)
  return rank
}

function preferCalendarEvent(candidate: CalendarEvent, current: CalendarEvent): CalendarEvent {
  return eventRank(candidate) >= eventRank(current) ? candidate : current
}

export function dedupeCalendarEventsForDisplay(events: CalendarEvent[]): CalendarEvent[] {
  if (events.length < 2) return events

  const byGoogleEventKey = new Map<string, CalendarEvent>()
  const withoutGoogleEventId: CalendarEvent[] = []

  for (const event of events) {
    if (!hasGoogleEventId(event)) {
      withoutGoogleEventId.push(event)
      continue
    }

    const key = googleEventKey(event)
    const current = byGoogleEventKey.get(key)
    byGoogleEventKey.set(key, current ? preferCalendarEvent(event, current) : event)
  }

  const deduped: CalendarEvent[] = [...byGoogleEventKey.values()]
  const signatureToIndex = new Map<string, number>()

  for (const [index, event] of deduped.entries()) {
    signatureToIndex.set(eventSignature(event), index)
  }

  for (const event of withoutGoogleEventId) {
    const signature = eventSignature(event)
    const existingIndex = signatureToIndex.get(signature)
    const isOptimistic = event.sync_status === "pending" || event.sync_status === "confirmed"

    if (existingIndex !== undefined && isOptimistic) {
      deduped[existingIndex] = preferCalendarEvent(event, deduped[existingIndex])
      continue
    }

    const idKey = `id:${event.id}`
    const existingByIdIndex = signatureToIndex.get(idKey)
    if (existingByIdIndex !== undefined) {
      deduped[existingByIdIndex] = preferCalendarEvent(event, deduped[existingByIdIndex])
      continue
    }

    signatureToIndex.set(idKey, deduped.length)
    if (isOptimistic) signatureToIndex.set(signature, deduped.length)
    deduped.push(event)
  }

  return deduped.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  )
}
