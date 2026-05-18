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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { calendar_id?: string }

  const { data: memo, error: memoError } = await supabase
    .from('ideal_goals')
    .select('id, google_event_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (memoError || !memo) {
    return NextResponse.json({ error: 'メモを確認できませんでした' }, { status: 404 })
  }

  const googleEventId = memo.google_event_id
  if (googleEventId) {
    const { data: storedEvent } = await supabase
      .from('calendar_events')
      .select('calendar_id')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId)
      .maybeSingle()

    const { data: userCalendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id')
      .eq('user_id', user.id)

    const requestedCalendarId = typeof body.calendar_id === 'string' && body.calendar_id.trim()
      ? body.calendar_id.trim()
      : null
    const calendarIds = Array.from(new Set([
      storedEvent?.calendar_id,
      requestedCalendarId,
      'primary',
      ...(userCalendars ?? []).map(calendar => calendar.google_calendar_id),
    ].filter((calendarId): calendarId is string => typeof calendarId === 'string' && calendarId.trim().length > 0)))

    const { calendar } = await getCalendarClient(user.id)
    let deletedFromGoogle = false
    try {
      for (const calendarId of calendarIds) {
        try {
          await calendar.events.delete({
            calendarId,
            eventId: googleEventId,
          })
          deletedFromGoogle = true
          break
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'カレンダー予定の削除に失敗しました'
      return NextResponse.json({ error: message }, { status: 500 })
    }

    if (!deletedFromGoogle) {
      console.warn('[wishlist/unschedule] Google Calendar event was not found:', googleEventId)
    }

    await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId)
  }

  const { data: item, error: updateError } = await supabase
    .from('ideal_goals')
    .update({
      scheduled_at: null,
      google_event_id: null,
      memo_status: 'unsorted',
      is_today: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, ideal_items(*)')
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ item })
}
