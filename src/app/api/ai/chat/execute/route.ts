import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/ai/chat/execute - AIチャットのアクション実行
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

    switch (action.type) {
      case 'add_task': {
        const { title, project_id, parent_task_id } = action.params as {
          title: string; project_id?: string; parent_task_id?: string
        }
        const { error } = await supabase
          .from('tasks')
          .insert({
            title,
            user_id: user.id,
            project_id: project_id || null,
            parent_task_id: parent_task_id || null,
            status: 'pending',
          })
        if (error) throw error
        return NextResponse.json({ success: true, message: `✅ タスク「${title}」をマップに追加しました` })
      }

      case 'add_calendar_event': {
        const { title, scheduled_at, estimated_time, calendar_id, project_id } = action.params as {
          title: string; scheduled_at: string; estimated_time?: number
          calendar_id?: string; project_id?: string
        }

        const taskId = crypto.randomUUID()
        const estMin = estimated_time || 60

        // 1. タスク作成（stage='scheduled'で今日ビューに表示可能）
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

        // 2. Google Calendar同期
        let calendarSynced = false
        if (scheduled_at && estMin > 0) {
          let calId = calendar_id as string | undefined
          if (!calId) {
            // calendar_id未指定ならデフォルトカレンダーを使用
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
          if (calId) {
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
              console.error('[execute] Calendar sync failed:', syncError)
              // タスク作成は成功しているのでエラーにはしない
            }
          }
        }

        const msg = calendarSynced
          ? `✅ 予定「${title}」をカレンダーに登録しました`
          : `✅ 予定「${title}」をタスクとして追加しました`
        return NextResponse.json({ success: true, message: msg })
      }

      case 'edit_memo': {
        const { note_id, content } = action.params as { note_id: string; content: string }
        const { error } = await supabase
          .from('notes')
          .update({ content })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ メモを更新しました' })
      }

      case 'link_project': {
        const { note_id, project_id } = action.params as { note_id: string; project_id: string }
        const { error } = await supabase
          .from('notes')
          .update({ project_id })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ プロジェクトを紐付けました' })
      }

      case 'archive_memo': {
        const { note_id } = action.params as { note_id: string }
        const { error } = await supabase
          .from('notes')
          .update({ status: 'archived' })
          .eq('id', note_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ メモを処理済みにしました' })
      }

      case 'update_priority': {
        const { task_id, priority } = action.params as { task_id: string; priority: number }
        const { error } = await supabase
          .from('tasks')
          .update({ priority })
          .eq('id', task_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: `✅ 優先度を${priority}に変更しました` })
      }

      case 'set_deadline': {
        const { task_id, scheduled_at, estimated_time } = action.params as {
          task_id: string; scheduled_at: string; estimated_time?: number
        }
        const updateData: Record<string, unknown> = { scheduled_at }
        if (estimated_time) updateData.estimated_time = estimated_time
        const { error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', task_id)
          .eq('user_id', user.id)
        if (error) throw error
        return NextResponse.json({ success: true, message: '✅ 締切を設定しました' })
      }

      default:
        return NextResponse.json({ success: false, message: `未対応のアクション: ${action.type}` }, { status: 400 })
    }
  } catch (error) {
    console.error('Execute action error:', error)
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, message: `❌ 実行に失敗しました: ${errMsg}` }, { status: 500 })
  }
}
