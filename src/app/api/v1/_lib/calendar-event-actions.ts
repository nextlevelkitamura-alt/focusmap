import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyCalendarAuthError } from '@/lib/calendar-auth-errors'
import { getCalendarClient } from '@/lib/google-calendar'
import { compactText, isRecord, jsonValue, nullableText } from './external-ai'

type ServiceClient = SupabaseClient

export class V1CalendarActionError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 500) {
    super(message)
    this.name = 'V1CalendarActionError'
    this.code = code
    this.status = status
  }
}

type CalendarEventRow = {
  id: string
  google_event_id: string
  calendar_id: string
  title: string
  description: string | null
  location: string | null
  start_time: string
  end_time: string
  timezone: string
}

type GoogleCalendarEventLike = {
  id?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  recurrence?: string[] | null
  recurringEventId?: string | null
  colorId?: string | null
  created?: string | null
  updated?: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function stringValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function booleanValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function numberArrayValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    return value
      .map(item => typeof item === 'number' && Number.isFinite(item) ? Math.max(0, Math.round(item)) : null)
      .filter((item): item is number => item !== null)
  }
  return undefined
}

function requireIsoDate(value: string | null, field: string) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    throw new V1CalendarActionError('VALIDATION_ERROR', `${field} must be a valid ISO 8601 datetime`, 400)
  }
  return value
}

function optionalIsoDate(value: string | null, field: string) {
  if (!value) return null
  return requireIsoDate(value, field)
}

function googleDateTime(value: string, timezone: string) {
  return {
    dateTime: new Date(value).toISOString(),
    timeZone: timezone,
  }
}

function isMissingCalendarEventError(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : null
  const code = typeof error === 'object' && error && 'code' in error ? Number((error as { code?: unknown }).code) : null
  const message = error instanceof Error ? error.message : String(error)
  return status === 404 || code === 404 || status === 410 || code === 410 || message.includes('Not Found') || message.includes('notFound')
}

export function normalizeCalendarError(error: unknown) {
  if (error instanceof V1CalendarActionError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  const authError = classifyCalendarAuthError(error)
  if (authError) {
    return { code: authError.code, message: authError.message, status: authError.status }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'CALENDAR_ERROR', message, status: 500 }
}

async function ensureWritableCalendars(supabase: ServiceClient, userId: string, calendarIds: string[]) {
  const ids = Array.from(new Set(calendarIds.filter(id => id && id !== 'primary')))
  if (ids.length === 0) return

  const { data, error } = await supabase
    .from('user_calendars')
    .select('google_calendar_id, access_level')
    .eq('user_id', userId)
    .in('google_calendar_id', ids)
  if (error) throw new V1CalendarActionError('QUERY_ERROR', error.message, 500)

  const accessById = new Map((data ?? []).map(row => [row.google_calendar_id, row.access_level]))
  const readOnlyCalendarId = ids.find(id => {
    const accessLevel = accessById.get(id)
    return accessLevel && accessLevel !== 'owner' && accessLevel !== 'writer'
  })
  if (readOnlyCalendarId) {
    throw new V1CalendarActionError('READ_ONLY_CALENDAR', 'This calendar is read-only.', 403)
  }
}

async function selectedCalendarIds(supabase: ServiceClient, userId: string) {
  const { data } = await supabase
    .from('user_calendars')
    .select('google_calendar_id')
    .eq('user_id', userId)
  return (data ?? [])
    .map(row => row.google_calendar_id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

async function findCalendarContainingEvent(
  calendar: Awaited<ReturnType<typeof getCalendarClient>>['calendar'],
  calendarIds: string[],
  googleEventId: string,
) {
  for (const calendarId of Array.from(new Set(calendarIds.filter(Boolean)))) {
    try {
      await calendar.events.get({ calendarId, eventId: googleEventId })
      return calendarId
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error
    }
  }
  return null
}

async function findStoredEvent(
  supabase: ServiceClient,
  userId: string,
  eventId: string,
  googleEventId: string | null,
  calendarId: string | null,
): Promise<CalendarEventRow | null> {
  if (isUuid(eventId)) {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('id, google_event_id, calendar_id, title, description, location, start_time, end_time, timezone')
      .eq('id', eventId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new V1CalendarActionError('QUERY_ERROR', error.message, 500)
    if (data) return data as CalendarEventRow
  }

  const effectiveGoogleEventId = googleEventId || (!isUuid(eventId) ? eventId : null)
  if (!effectiveGoogleEventId) return null

  let query = supabase
    .from('calendar_events')
    .select('id, google_event_id, calendar_id, title, description, location, start_time, end_time, timezone')
    .eq('user_id', userId)
    .eq('google_event_id', effectiveGoogleEventId)
    .limit(1)
  if (calendarId) query = query.eq('calendar_id', calendarId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new V1CalendarActionError('QUERY_ERROR', error.message, 500)
  return data as CalendarEventRow | null
}

function eventTimesFromGoogle(event: GoogleCalendarEventLike) {
  return {
    startTime: event.start?.dateTime ?? event.start?.date ?? null,
    endTime: event.end?.dateTime ?? event.end?.date ?? null,
  }
}

async function upsertCalendarEventCache(
  supabase: ServiceClient,
  userId: string,
  payload: Record<string, unknown>,
  existingId?: string | null,
) {
  const query = existingId
    ? supabase
        .from('calendar_events')
        .update(payload)
        .eq('user_id', userId)
        .eq('id', existingId)
        .select('*')
        .single()
    : supabase
        .from('calendar_events')
        .upsert(payload, {
          onConflict: 'user_id,calendar_id,google_event_id',
          ignoreDuplicates: false,
        })
        .select('*')
        .single()
  const { data, error } = await query
  if (error) throw new V1CalendarActionError('DB_UPDATE_ERROR', error.message, 500)
  return data
}

async function updateLinkedTasksAndMemos(
  supabase: ServiceClient,
  userId: string,
  oldGoogleEventId: string,
  next: {
    googleEventId: string
    calendarId: string
    title?: string | null
    description?: string | null
    startTime?: string | null
    endTime?: string | null
  },
) {
  const taskUpdates: Record<string, unknown> = {
    google_event_id: next.googleEventId,
    calendar_id: next.calendarId,
    updated_at: new Date().toISOString(),
  }
  if (next.title) taskUpdates.title = next.title
  if (next.startTime) taskUpdates.scheduled_at = next.startTime

  await supabase
    .from('tasks')
    .update(taskUpdates)
    .eq('user_id', userId)
    .eq('google_event_id', oldGoogleEventId)

  const memoUpdates: Record<string, unknown> = {
    google_event_id: next.googleEventId,
    memo_status: 'scheduled',
    updated_at: new Date().toISOString(),
  }
  if (next.title) memoUpdates.title = next.title
  if (next.description !== undefined) memoUpdates.description = next.description
  if (next.startTime) memoUpdates.scheduled_at = next.startTime
  if (next.startTime && next.endTime) {
    memoUpdates.duration_minutes = Math.max(1, Math.round((new Date(next.endTime).getTime() - new Date(next.startTime).getTime()) / 60000))
  }

  await supabase
    .from('ideal_goals')
    .update(memoUpdates)
    .eq('user_id', userId)
    .eq('google_event_id', oldGoogleEventId)
}

export async function createCalendarEventV1(supabase: ServiceClient, userId: string, body: unknown) {
  if (!isRecord(body)) throw new V1CalendarActionError('INVALID_BODY', 'Invalid request body', 400)

  const title = compactText(body.title ?? body.summary, 160)
  const startTime = requireIsoDate(stringValue(body, 'start_time', 'startTime'), 'start_time')
  const endTime = requireIsoDate(stringValue(body, 'end_time', 'endTime'), 'end_time')
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    throw new V1CalendarActionError('VALIDATION_ERROR', 'end_time must be after start_time', 400)
  }
  if (!title) throw new V1CalendarActionError('VALIDATION_ERROR', 'title is required', 400)

  const { data: settings, error: settingsError } = await supabase
    .from('user_calendar_settings')
    .select('is_sync_enabled, default_calendar_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (settingsError) throw new V1CalendarActionError('QUERY_ERROR', settingsError.message, 500)
  if (settings && !settings.is_sync_enabled) {
    throw new V1CalendarActionError('CALENDAR_NOT_CONNECTED', 'Calendar sync is disabled.', 401)
  }

  const calendarId = stringValue(body, 'calendar_id', 'calendarId') ?? settings?.default_calendar_id ?? 'primary'
  const timezone = stringValue(body, 'timezone', 'timeZone') ?? 'Asia/Tokyo'
  await ensureWritableCalendars(supabase, userId, [calendarId])

  const reminders = numberArrayValue(body, 'reminders')
  const requestBody: Record<string, unknown> = {
    summary: title,
    description: nullableText(body.description, 5000) ?? undefined,
    location: nullableText(body.location, 500) ?? undefined,
    start: googleDateTime(startTime, timezone),
    end: googleDateTime(endTime, timezone),
  }
  if (reminders !== undefined) {
    requestBody.reminders = reminders.length > 0
      ? { useDefault: false, overrides: reminders.map(minutes => ({ method: 'popup', minutes })) }
      : { useDefault: false, overrides: [] }
  }

  const { calendar } = await getCalendarClient(userId, supabase)
  const created = await calendar.events.insert({ calendarId, requestBody })
  const googleEventId = created.data.id
  if (!googleEventId) throw new V1CalendarActionError('GOOGLE_ERROR', 'Google Calendar did not return an event id', 500)

  const event = await upsertCalendarEventCache(supabase, userId, {
    user_id: userId,
    google_event_id: googleEventId,
    calendar_id: calendarId,
    title,
    description: nullableText(body.description, 5000),
    location: nullableText(body.location, 500),
    start_time: startTime,
    end_time: endTime,
    is_all_day: booleanValue(body, 'is_all_day', 'isAllDay') ?? false,
    timezone,
    recurrence: Array.isArray(body.recurrence) ? body.recurrence : null,
    recurring_event_id: stringValue(body, 'recurring_event_id', 'recurringEventId'),
    color: nullableText(body.color, 80),
    background_color: nullableText(body.background_color ?? body.backgroundColor, 80),
    google_created_at: created.data.created ?? new Date().toISOString(),
    google_updated_at: created.data.updated ?? new Date().toISOString(),
    reminders: reminders ?? null,
    is_completed: booleanValue(body, 'is_completed', 'isCompleted') ?? false,
    synced_at: new Date().toISOString(),
  })

  return { event, google_event_id: googleEventId, calendar_id: calendarId }
}

export async function updateCalendarEventV1(
  supabase: ServiceClient,
  userId: string,
  eventId: string,
  body: unknown,
) {
  if (!isRecord(body)) throw new V1CalendarActionError('INVALID_BODY', 'Invalid request body', 400)

  const calendarIdInput = stringValue(body, 'calendar_id', 'calendarId')
  const sourceCalendarInput = stringValue(body, 'original_calendar_id', 'originalCalendarId', 'source_calendar_id', 'sourceCalendarId')
  const explicitGoogleEventId = stringValue(body, 'google_event_id', 'googleEventId')
  const storedEvent = await findStoredEvent(supabase, userId, eventId, explicitGoogleEventId, sourceCalendarInput ?? calendarIdInput)
  const googleEventId = explicitGoogleEventId ?? storedEvent?.google_event_id ?? (!isUuid(eventId) ? eventId : null)
  if (!googleEventId) throw new V1CalendarActionError('VALIDATION_ERROR', 'google_event_id is required', 400)

  const selectedIds = await selectedCalendarIds(supabase, userId)
  const { calendar } = await getCalendarClient(userId, supabase)
  const destinationCalendarId = calendarIdInput ?? storedEvent?.calendar_id ?? 'primary'
  let sourceCalendarId = sourceCalendarInput ?? storedEvent?.calendar_id ?? destinationCalendarId
  if (!sourceCalendarInput && !storedEvent?.calendar_id) {
    sourceCalendarId = await findCalendarContainingEvent(calendar, [destinationCalendarId, 'primary', ...selectedIds], googleEventId) ?? sourceCalendarId
  }
  await ensureWritableCalendars(supabase, userId, [sourceCalendarId, destinationCalendarId])

  let effectiveGoogleEventId = googleEventId
  let latestGoogleEvent: GoogleCalendarEventLike | null = null
  if (sourceCalendarId !== destinationCalendarId) {
    const moved = await calendar.events.move({
      calendarId: sourceCalendarId,
      eventId: googleEventId,
      destination: destinationCalendarId,
    })
    effectiveGoogleEventId = moved.data.id ?? googleEventId
    latestGoogleEvent = moved.data
  }

  const startTime = optionalIsoDate(stringValue(body, 'start_time', 'startTime'), 'start_time')
  const endTime = optionalIsoDate(stringValue(body, 'end_time', 'endTime'), 'end_time')
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new V1CalendarActionError('VALIDATION_ERROR', 'start_time and end_time must be provided together', 400)
  }
  if (startTime && endTime && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    throw new V1CalendarActionError('VALIDATION_ERROR', 'end_time must be after start_time', 400)
  }

  const timezone = stringValue(body, 'timezone', 'timeZone') ?? storedEvent?.timezone ?? 'Asia/Tokyo'
  const patchBody: Record<string, unknown> = {}
  const title = 'title' in body || 'summary' in body ? compactText(body.title ?? body.summary, 160) : null
  if (title !== null) {
    if (!title) throw new V1CalendarActionError('VALIDATION_ERROR', 'title cannot be empty', 400)
    patchBody.summary = title
  }
  if ('description' in body) patchBody.description = nullableText(body.description, 5000) ?? undefined
  if ('location' in body) patchBody.location = nullableText(body.location, 500) ?? undefined
  if (startTime && endTime) {
    patchBody.start = googleDateTime(startTime, timezone)
    patchBody.end = googleDateTime(endTime, timezone)
  }
  const reminders = numberArrayValue(body, 'reminders')
  if (reminders !== undefined) {
    patchBody.reminders = reminders.length > 0
      ? { useDefault: false, overrides: reminders.map(minutes => ({ method: 'popup', minutes })) }
      : { useDefault: false, overrides: [] }
  }

  if (Object.keys(patchBody).length > 0) {
    const updated = await calendar.events.patch({
      calendarId: destinationCalendarId,
      eventId: effectiveGoogleEventId,
      requestBody: patchBody,
    })
    latestGoogleEvent = updated.data
  }

  if (!latestGoogleEvent) {
    const fetched = await calendar.events.get({ calendarId: destinationCalendarId, eventId: effectiveGoogleEventId })
    latestGoogleEvent = fetched.data
  }

  const googleTimes = eventTimesFromGoogle(latestGoogleEvent)
  const nextStartTime = startTime ?? googleTimes.startTime ?? storedEvent?.start_time ?? null
  const nextEndTime = endTime ?? googleTimes.endTime ?? storedEvent?.end_time ?? null
  if (!nextStartTime || !nextEndTime) {
    throw new V1CalendarActionError('GOOGLE_ERROR', 'Google Calendar event did not include start/end times', 500)
  }

  const nextTitle = title ?? latestGoogleEvent.summary ?? storedEvent?.title ?? 'Untitled'
  const nextDescription = 'description' in body
    ? nullableText(body.description, 5000)
    : latestGoogleEvent.description ?? storedEvent?.description ?? null
  const nextLocation = 'location' in body
    ? nullableText(body.location, 500)
    : latestGoogleEvent.location ?? storedEvent?.location ?? null

  const event = await upsertCalendarEventCache(supabase, userId, {
    user_id: userId,
    google_event_id: effectiveGoogleEventId,
    calendar_id: destinationCalendarId,
    title: nextTitle,
    description: nextDescription,
    location: nextLocation,
    start_time: nextStartTime,
    end_time: nextEndTime,
    is_all_day: !latestGoogleEvent.start?.dateTime,
    timezone,
    recurrence: Array.isArray(latestGoogleEvent.recurrence) ? latestGoogleEvent.recurrence : null,
    recurring_event_id: latestGoogleEvent.recurringEventId ?? null,
    color: latestGoogleEvent.colorId ?? null,
    background_color: null,
    google_created_at: latestGoogleEvent.created ?? null,
    google_updated_at: latestGoogleEvent.updated ?? new Date().toISOString(),
    reminders: reminders ?? null,
    synced_at: new Date().toISOString(),
  }, storedEvent?.id)

  if (sourceCalendarId !== destinationCalendarId || googleEventId !== effectiveGoogleEventId) {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', userId)
      .eq('calendar_id', sourceCalendarId)
      .eq('google_event_id', googleEventId)
  }
  await updateLinkedTasksAndMemos(supabase, userId, googleEventId, {
    googleEventId: effectiveGoogleEventId,
    calendarId: destinationCalendarId,
    title: nextTitle,
    description: nextDescription,
    startTime: nextStartTime,
    endTime: nextEndTime,
  })

  return {
    event,
    google_event_id: effectiveGoogleEventId,
    calendar_id: destinationCalendarId,
    moved: sourceCalendarId !== destinationCalendarId,
    source_calendar_id: sourceCalendarId,
  }
}

export async function deleteCalendarEventV1(
  supabase: ServiceClient,
  userId: string,
  eventId: string,
  request: Request,
) {
  const url = new URL(request.url)
  const queryGoogleEventId = url.searchParams.get('google_event_id') || url.searchParams.get('googleEventId')
  const queryCalendarId = url.searchParams.get('calendar_id') || url.searchParams.get('calendarId')
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const record = isRecord(body) ? body : {}

  const googleEventId = queryGoogleEventId
    ?? stringValue(record, 'google_event_id', 'googleEventId')
    ?? (!isUuid(eventId) ? eventId : null)
  const bodyCalendarId = queryCalendarId ?? stringValue(record, 'calendar_id', 'calendarId')
  const storedEvent = await findStoredEvent(supabase, userId, eventId, googleEventId, bodyCalendarId)
  const effectiveGoogleEventId = googleEventId ?? storedEvent?.google_event_id
  if (!effectiveGoogleEventId) throw new V1CalendarActionError('VALIDATION_ERROR', 'google_event_id is required', 400)

  const calendarId = bodyCalendarId ?? storedEvent?.calendar_id ?? 'primary'
  await ensureWritableCalendars(supabase, userId, [calendarId])

  const { calendar } = await getCalendarClient(userId, supabase)
  let deletedFromGoogle = false
  try {
    await calendar.events.delete({ calendarId, eventId: effectiveGoogleEventId })
    deletedFromGoogle = true
  } catch (error) {
    if (!isMissingCalendarEventError(error)) throw error
  }

  const { error: deleteError } = await supabase
    .from('calendar_events')
    .delete()
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .eq('google_event_id', effectiveGoogleEventId)
  if (deleteError) throw new V1CalendarActionError('DB_UPDATE_ERROR', deleteError.message, 500)

  const { data: relatedTasks } = await supabase
    .from('tasks')
    .select('id, source')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .eq('google_event_id', effectiveGoogleEventId)

  const importedTaskIds = (relatedTasks ?? [])
    .filter(task => task.source === 'google_event')
    .map(task => task.id)
  const manualTaskIds = (relatedTasks ?? [])
    .filter(task => task.source !== 'google_event')
    .map(task => task.id)
  if (importedTaskIds.length > 0) {
    await supabase
      .from('tasks')
      .update({
        deleted_at: new Date().toISOString(),
        is_timer_running: false,
        last_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('id', importedTaskIds)
  }
  if (manualTaskIds.length > 0) {
    await supabase
      .from('tasks')
      .update({
        google_event_id: null,
        calendar_event_id: null,
        calendar_id: null,
        scheduled_at: null,
        stage: 'plan',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('id', manualTaskIds)
  }

  await supabase
    .from('ideal_goals')
    .update({
      scheduled_at: null,
      google_event_id: null,
      memo_status: 'unsorted',
      is_today: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('google_event_id', effectiveGoogleEventId)

  return {
    deleted_from_google: deletedFromGoogle,
    google_event_id: effectiveGoogleEventId,
    calendar_id: calendarId,
    affected_task_ids: [...importedTaskIds, ...manualTaskIds],
    affected_resources: jsonValue({
      calendar_events: true,
      tasks: importedTaskIds.length + manualTaskIds.length,
      memos: true,
    }),
  }
}
