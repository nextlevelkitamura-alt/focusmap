import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { google } from 'googleapis'
import { getCalendarClient } from '@/lib/google-calendar'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { scheduled_at, duration_minutes, title, description } = await request.json()
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
  const calendarId = settings.default_calendar_id ?? 'primary'

  try {
    const auth = await getCalendarClient(user.id)
    const calendar = google.calendar({ version: 'v3', auth })
    const gcalRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        description: description ?? '',
        start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Tokyo' },
        end:   { dateTime: endTime.toISOString(),   timeZone: 'Asia/Tokyo' },
      },
    })

    await supabase
      .from('ideal_goals')
      .update({ google_event_id: gcalRes.data.id, scheduled_at, duration_minutes, memo_status: 'scheduled' })
      .eq('id', id)
      .eq('user_id', user.id)

    return NextResponse.json({ google_event_id: gcalRes.data.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Googleカレンダーへの登録に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
