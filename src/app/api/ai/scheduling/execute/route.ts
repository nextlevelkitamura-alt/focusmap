import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/ai/scheduling/execute - スケジューリングアクションの実行
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body as {
      action: { type: string; params: Record<string, unknown> }
    }

    if (!action?.type) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 })
    }

    if (action.type !== 'add_calendar_event') {
      return NextResponse.json(
        { success: false, message: `未対応のアクション: ${action.type}` },
        { status: 400 }
      )
    }

    const { title, scheduled_at, estimated_time, calendar_id, project_id } = action.params as {
      title: string
      scheduled_at: string
      estimated_time?: number
      calendar_id?: string
      project_id?: string
    }

    if (calendar_id) {
      const { data: ownedCalendar, error: calendarLookupError } = await supabase
        .from('user_calendars')
        .select('google_calendar_id')
        .eq('user_id', user.id)
        .eq('google_calendar_id', calendar_id)
        .maybeSingle()
      if (calendarLookupError) throw calendarLookupError
      if (!ownedCalendar) {
        return NextResponse.json(
          { success: false, message: '❌ 選択したカレンダーは利用できません' },
          { status: 400 }
        )
      }
    }

    const taskId = crypto.randomUUID()
    const estMin = estimated_time || 60

    // タスク作成（stage='scheduled'）
    const { error: taskError } = await supabase
      .from('tasks')
      .insert({
        id: taskId,
        title,
        user_id: user.id,
        project_id: project_id || null,
        scheduled_at,
        estimated_time: estMin,
        calendar_id: calendar_id || null,
        stage: 'scheduled',
        status: 'todo',
        priority: 3,
      })

    if (taskError) throw taskError

    // Google Calendar同期
    let calendarSynced = false
    let calId = calendar_id as string | undefined

    if (!calId) {
      const { data: settings } = await supabase
        .from('user_calendar_settings')
        .select('is_sync_enabled, default_calendar_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (settings?.is_sync_enabled) {
        calId = settings.default_calendar_id || 'primary'
        await supabase.from('tasks').update({ calendar_id: calId }).eq('id', taskId)
      }
    }

    if (calId && scheduled_at) {
      try {
        const { syncTaskToCalendar } = await import('@/lib/google-calendar')
        await syncTaskToCalendar(user.id, taskId, {
          title,
          scheduled_at,
          estimated_time: estMin,
          calendar_id: calId,
        })
        calendarSynced = true
      } catch (syncError) {
        console.error('[scheduling/execute] Calendar sync failed:', syncError)
      }
    }

    // 日時の表示用フォーマット（ISO8601の+09:00を解釈して表示）
    const parsedDate = new Date(scheduled_at)
    const jstDate = new Date(parsedDate.getTime() + 9 * 60 * 60 * 1000)
    const days = ['日', '月', '火', '水', '木', '金', '土']
    const dateLabel = `${jstDate.getUTCMonth() + 1}月${jstDate.getUTCDate()}日(${days[jstDate.getUTCDay()]}) ${String(jstDate.getUTCHours()).padStart(2, '0')}:${String(jstDate.getUTCMinutes()).padStart(2, '0')}`

    const msg = calendarSynced
      ? `✅ 「${title}」を${dateLabel}に登録しました`
      : `✅ 「${title}」をタスクとして${dateLabel}に追加しました`

    return NextResponse.json({
      success: true,
      message: msg,
      eventData: {
        id: taskId,
        title,
        scheduled_at,
        estimated_time: estMin,
        calendar_id: calId || calendar_id || null,
      },
    })
  } catch (error) {
    console.error('[scheduling/execute] Error:', error)
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { success: false, message: `❌ 登録に失敗しました: ${errMsg}` },
      { status: 500 }
    )
  }
}
