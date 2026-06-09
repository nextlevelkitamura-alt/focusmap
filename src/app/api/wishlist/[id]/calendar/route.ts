import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getCalendarClient } from '@/lib/google-calendar'

function isMissingCalendarEventError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? Number((error as { code?: unknown }).code) : null
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : null
  const message = error instanceof Error ? error.message : String(error)
  return code === 404 || status === 404 || code === 410 || status === 410 || message.includes('Not Found') || message.includes('notFound')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { scheduled_at, duration_minutes, title, description, calendar_id } = await request.json()
  if (!scheduled_at || !duration_minutes) {
    return NextResponse.json({ error: '日時と所要時間が必要です' }, { status: 400 })
  }

  const { data: settings } = await supabase
    .from('user_calendar_settings')
    .select('is_sync_enabled, default_calendar_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.is_sync_enabled) {
    return NextResponse.json(
      { error: 'Googleカレンダーが未連携です。設定からカレンダー連携を行ってください。' },
      { status: 401 }
    )
  }

  const startTime = new Date(scheduled_at)
  const endTime = new Date(startTime.getTime() + duration_minutes * 60 * 1000)
  const requestedCalendarId = typeof calendar_id === 'string' && calendar_id.trim().length > 0
    ? calendar_id.trim()
    : null
  const calendarId = requestedCalendarId ?? settings.default_calendar_id ?? 'primary'

  try {
    const { calendar } = await getCalendarClient(user.id)
    const { data: existingMemo } = await supabase
      .from('ideal_goals')
      .select('google_event_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingMemo?.google_event_id) {
      const { data: storedEvent } = await supabase
        .from('calendar_events')
        .select('calendar_id')
        .eq('user_id', user.id)
        .eq('google_event_id', existingMemo.google_event_id)
        .maybeSingle()
      const { data: userCalendars } = await supabase
        .from('user_calendars')
        .select('google_calendar_id')
        .eq('user_id', user.id)

      const oldCalendarIds = Array.from(new Set([
        storedEvent?.calendar_id,
        requestedCalendarId,
        calendarId,
        'primary',
        ...(userCalendars ?? []).map(cal => cal.google_calendar_id),
      ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))

      for (const oldCalendarId of oldCalendarIds) {
        try {
          await calendar.events.delete({
            calendarId: oldCalendarId,
            eventId: existingMemo.google_event_id,
          })
          break
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }
      }

      await supabase
        .from('calendar_events')
        .delete()
        .eq('user_id', user.id)
        .eq('google_event_id', existingMemo.google_event_id)
    }

    const gcalRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        description: description ?? '',
        start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Tokyo' },
        end:   { dateTime: endTime.toISOString(),   timeZone: 'Asia/Tokyo' },
      },
    })

    const { data: item, error: updateError } = await supabase
      .from('ideal_goals')
      .update({ google_event_id: gcalRes.data.id, scheduled_at, duration_minutes, calendar_id: calendarId, memo_status: 'scheduled', is_today: false })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*, ideal_items(*)')
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ google_event_id: gcalRes.data.id, calendar_id: calendarId, item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Googleカレンダーへの登録に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
