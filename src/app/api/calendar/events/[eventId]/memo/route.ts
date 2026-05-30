import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getCalendarClient } from '@/lib/google-calendar'
import { classifyCalendarAuthError } from '@/lib/calendar-auth-errors'
import { upsertMemoTags } from '@/lib/memo-tags-server'

type DeleteScope = 'this' | 'series'

type ConvertBody = {
  googleEventId?: string
  calendarId?: string
  title?: string
  description?: string | null
  location?: string | null
  startTime?: string
  endTime?: string
  isAllDay?: boolean
  timezone?: string
  recurrence?: string[] | null
  recurringEventId?: string | null
  deleteScope?: DeleteScope
  project_id?: string | null
}

function isMissingCalendarEventError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? Number((error as { code?: unknown }).code) : null
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : null
  const message = error instanceof Error ? error.message : String(error)
  return code === 404 || status === 404 || code === 410 || status === 410 || message.includes('Not Found') || message.includes('notFound')
}

function isWritableCalendar(accessLevel: string | null | undefined) {
  return accessLevel === 'owner' || accessLevel === 'writer'
}

function originalTimeLabel(start: Date, end: Date) {
  const startLabel = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(start)
  const endLabel = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(end)
  return `${startLabel}-${endLabel}`
}

function buildMemoDescription(input: {
  description?: string | null
  location?: string | null
  start: Date
  end: Date
  deleteScope: DeleteScope
}) {
  return [
    input.description?.trim() || null,
    `元の予定: ${originalTimeLabel(input.start, input.end)}`,
    input.deleteScope === 'series' ? '繰り返し予定: 全体を削除してメモ化' : null,
    input.location ? `場所: ${input.location}` : null,
  ].filter((line): line is string => !!line).join('\n\n')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let memoId: string | null = null
  let conversionId: string | null = null
  let deletedFromGoogle = false

  try {
    const body = await request.json().catch(() => ({})) as ConvertBody
    const googleEventId = (body.googleEventId || eventId || '').trim()
    const calendarId = (body.calendarId || 'primary').trim()
    const title = (body.title || '無題の予定').trim()
    const start = body.startTime ? new Date(body.startTime) : null
    const end = body.endTime ? new Date(body.endTime) : null
    const deleteScope: DeleteScope = body.deleteScope === 'series' ? 'series' : 'this'
    const recurringEventId = body.recurringEventId?.trim() || null
    const targetGoogleEventId = deleteScope === 'series'
      ? (recurringEventId || googleEventId)
      : googleEventId

    if (!googleEventId || !calendarId || !title || !start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: '予定情報が不足しています' }, { status: 400 })
    }

    if (body.project_id) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', body.project_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (projectError) throw projectError
      if (!project) return NextResponse.json({ error: 'プロジェクトを確認できませんでした' }, { status: 400 })
    }

    const { data: targetCalendar, error: calendarLookupError } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, access_level')
      .eq('user_id', user.id)
      .eq('google_calendar_id', calendarId)
      .maybeSingle()
    if (calendarLookupError) throw calendarLookupError

    if (targetCalendar && !isWritableCalendar(targetCalendar.access_level)) {
      return NextResponse.json({ error: 'このカレンダーは閲覧専用のため削除できません' }, { status: 403 })
    }

    const { calendar } = await getCalendarClient(user.id)
    let googleSnapshot: unknown = null
    try {
      const snapshot = await calendar.events.get({
        calendarId,
        eventId: targetGoogleEventId,
      })
      googleSnapshot = snapshot.data
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error
    }

    const { count } = await supabase
      .from('ideal_goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['wishlist', 'memo'])

    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    const memoDescription = buildMemoDescription({
      description: body.description,
      location: body.location,
      start,
      end,
      deleteScope,
    })
    const eventSnapshot = {
      source: 'google_calendar_event',
      calendar_id: calendarId,
      google_event_id: googleEventId,
      target_google_event_id: targetGoogleEventId,
      recurring_event_id: recurringEventId,
      delete_scope: deleteScope,
      title,
      description: body.description ?? null,
      location: body.location ?? null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      is_all_day: body.isAllDay ?? false,
      timezone: body.timezone || 'Asia/Tokyo',
      recurrence: Array.isArray(body.recurrence) ? body.recurrence : null,
      google_event: googleSnapshot,
    }

    const { data: memo, error: memoError } = await supabase
      .from('ideal_goals')
      .insert({
        user_id: user.id,
        title,
        project_id: body.project_id || null,
        description: memoDescription,
        category: '予定',
        scheduled_at: null,
        duration_minutes: durationMinutes,
        google_event_id: null,
        tags: [],
        memo_status: 'unsorted',
        ai_source_payload: eventSnapshot,
        status: 'memo',
        color: '#6366f1',
        display_order: (count ?? 0) + 1,
        total_daily_minutes: 0,
        is_completed: false,
        is_today: false,
      })
      .select('*, ideal_items(*)')
      .single()
    if (memoError) throw memoError
    memoId = memo.id

    const { data: conversion, error: conversionError } = await supabase
      .from('calendar_event_memo_conversions')
      .insert({
        user_id: user.id,
        memo_id: memoId,
        calendar_id: calendarId,
        google_event_id: googleEventId,
        target_google_event_id: targetGoogleEventId,
        recurring_event_id: recurringEventId,
        delete_scope: deleteScope,
        title,
        description: body.description ?? null,
        location: body.location ?? null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_all_day: body.isAllDay ?? false,
        timezone: body.timezone || 'Asia/Tokyo',
        recurrence: Array.isArray(body.recurrence) ? body.recurrence : null,
        event_snapshot: eventSnapshot,
        conversion_status: 'memo_created',
      })
      .select('id')
      .single()
    if (conversionError) throw conversionError
    conversionId = conversion.id

    try {
      await calendar.events.delete({
        calendarId,
        eventId: targetGoogleEventId,
      })
      deletedFromGoogle = true
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error
    }

    const { data: scopedEvents } = await supabase
      .from('calendar_events')
      .select('google_event_id')
      .eq('user_id', user.id)
      .eq('calendar_id', calendarId)
      .or(deleteScope === 'series'
        ? `google_event_id.eq.${targetGoogleEventId},recurring_event_id.eq.${targetGoogleEventId}`
        : `google_event_id.eq.${googleEventId}`)

    const scopedGoogleEventIds = Array.from(new Set([
      googleEventId,
      ...(scopedEvents ?? []).map(event => event.google_event_id).filter((id): id is string => !!id),
    ]))

    let dbDeleteQuery = supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('calendar_id', calendarId)
    dbDeleteQuery = deleteScope === 'series'
      ? dbDeleteQuery.or(`google_event_id.eq.${targetGoogleEventId},recurring_event_id.eq.${targetGoogleEventId}`)
      : dbDeleteQuery.eq('google_event_id', googleEventId)
    const { error: dbDeleteError } = await dbDeleteQuery
    if (dbDeleteError) throw dbDeleteError

    const { data: relatedTasks } = scopedGoogleEventIds.length > 0
      ? await supabase
        .from('tasks')
        .select('id, source')
        .eq('user_id', user.id)
        .eq('calendar_id', calendarId)
        .in('google_event_id', scopedGoogleEventIds)
      : { data: [] }

    const importedTaskIds = (relatedTasks ?? [])
      .filter(task => task.source === 'google_event')
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
        .eq('user_id', user.id)
        .in('id', importedTaskIds)
    }

    const manualTaskIds = (relatedTasks ?? [])
      .filter(task => task.source !== 'google_event')
      .map(task => task.id)
    if (manualTaskIds.length > 0) {
      await supabase
        .from('tasks')
        .update({
          google_event_id: null,
          calendar_id: null,
          scheduled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .in('id', manualTaskIds)
    }

    if (scopedGoogleEventIds.length > 0) {
      await supabase
        .from('ideal_goals')
        .update({
          scheduled_at: null,
          google_event_id: null,
          memo_status: 'unsorted',
          is_today: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .in('google_event_id', scopedGoogleEventIds)
    }

    if (conversionId) {
      await supabase
        .from('calendar_event_memo_conversions')
        .update({
          conversion_status: 'completed',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', conversionId)
        .eq('user_id', user.id)
    }

    await upsertMemoTags(supabase, user.id, '予定', [])

    return NextResponse.json({
      item: memo,
      conversion_id: conversionId,
      delete_scope: deleteScope,
      deleted_from_google: deletedFromGoogle,
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '予定をメモにできませんでした'

    if (conversionId) {
      await supabase
        .from('calendar_event_memo_conversions')
        .update({
          conversion_status: 'failed',
          error_message: message,
        })
        .eq('id', conversionId)
        .eq('user_id', user.id)
    }

    if (!deletedFromGoogle && memoId) {
      await supabase
        .from('ideal_goals')
        .delete()
        .eq('id', memoId)
        .eq('user_id', user.id)
    }

    const authErrorInfo = classifyCalendarAuthError(message)
    if (authErrorInfo) {
      return NextResponse.json({ error: authErrorInfo.message }, { status: authErrorInfo.status })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
