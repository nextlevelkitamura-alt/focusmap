import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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

  // calendar_settingsからアクセストークン取得
  const { data: settings } = await supabase
    .from('calendar_settings')
    .select('google_access_token, google_refresh_token, google_token_expires_at, default_calendar_id')
    .eq('user_id', user.id)
    .single()

  if (!settings?.google_access_token) {
    return NextResponse.json(
      { error: 'Googleカレンダーが未連携です。設定からカレンダー連携を行ってください。' },
      { status: 401 }
    )
  }

  const startTime = new Date(scheduled_at)
  const endTime = new Date(startTime.getTime() + duration_minutes * 60 * 1000)
  const calendarId = settings.default_calendar_id ?? 'primary'

  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.google_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: title,
        description: description ?? '',
        start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Tokyo' },
        end:   { dateTime: endTime.toISOString(),   timeZone: 'Asia/Tokyo' },
      }),
    }
  )

  if (!gcalRes.ok) {
    const err = await gcalRes.json()
    return NextResponse.json(
      { error: err.error?.message ?? 'Googleカレンダーへの登録に失敗しました' },
      { status: gcalRes.status }
    )
  }

  const gcalEvent = await gcalRes.json()

  // google_event_idをideal_goalsに保存
  await supabase
    .from('ideal_goals')
    .update({ google_event_id: gcalEvent.id, scheduled_at, duration_minutes })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ google_event_id: gcalEvent.id })
}
