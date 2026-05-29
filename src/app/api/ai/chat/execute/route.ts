import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { getCalendarClient } from '@/lib/google-calendar'
import type { calendar_v3 } from 'googleapis'

function isMissingCalendarEventError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined
  return status === 404 || code === 404
}

function toRestorableGoogleEvent(event: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
  return {
    summary: event.summary || undefined,
    description: event.description || undefined,
    location: event.location || undefined,
    start: event.start || undefined,
    end: event.end || undefined,
    recurrence: event.recurrence || undefined,
    attendees: event.attendees || undefined,
    reminders: event.reminders || undefined,
    colorId: event.colorId || undefined,
    transparency: event.transparency || undefined,
    visibility: event.visibility || undefined,
    extendedProperties: event.extendedProperties || undefined,
  }
}

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
        const taskId = crypto.randomUUID()
        const { error } = await supabase
          .from('tasks')
          .insert({
            id: taskId,
            title,
            user_id: user.id,
            project_id: project_id || null,
            parent_task_id: parent_task_id || null,
            status: 'pending',
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ タスク「${title}」をマップに追加しました`,
          taskData: { id: taskId, title, project_id: project_id || null, parent_task_id: parent_task_id || null },
          continueOptions: [
            { label: '別のタスクを追加', value: 'タスクを追加したい', silent: true },
            { label: '完了', value: '', silent: true },
          ],
        })
      }

      case 'add_calendar_event': {
        const { title, scheduled_at, estimated_time, calendar_id, project_id } = action.params as {
          title: string; scheduled_at: string; estimated_time?: number
          calendar_id?: string; project_id?: string
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
            return NextResponse.json({ success: false, message: '❌ 選択したカレンダーは利用できません' }, { status: 400 })
          }
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
        let resolvedCalendarId: string | null = calendar_id || null
        if (scheduled_at && estMin > 0) {
          if (!resolvedCalendarId) {
            // calendar_id未指定ならデフォルトカレンダーを使用
            const { data: settings } = await supabase
              .from('user_calendar_settings')
              .select('is_sync_enabled, default_calendar_id')
              .eq('user_id', user.id)
              .maybeSingle()
            if (settings?.is_sync_enabled) {
              resolvedCalendarId = settings.default_calendar_id || 'primary'
              await supabase.from('tasks').update({ calendar_id: resolvedCalendarId }).eq('id', taskId)
            }
          }
          if (resolvedCalendarId) {
            try {
              const { syncTaskToCalendar } = await import('@/lib/google-calendar')
              await syncTaskToCalendar(user.id, taskId, {
                title,
                scheduled_at,
                estimated_time: estMin,
                calendar_id: resolvedCalendarId,
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
        return NextResponse.json({
          success: true,
          message: msg,
          eventData: {
            id: taskId,
            title,
            scheduled_at,
            estimated_time: estMin,
            calendar_id: resolvedCalendarId,
          },
        })
      }

      case 'delete_calendar_event': {
        const {
          calendar_id,
          event_id,
          google_event_id,
          title,
          start_time,
          end_time,
          delete_scope,
          recurring_event_id,
        } = action.params as {
          calendar_id?: string
          event_id?: string
          google_event_id?: string
          title?: string
          start_time?: string
          end_time?: string
          delete_scope?: 'this' | 'series'
          recurring_event_id?: string
        }
        const calendarId = calendar_id?.trim()
        const eventId = (event_id || google_event_id)?.trim()

        if (!calendarId || !eventId) {
          return NextResponse.json({
            success: false,
            message: '❌ 削除対象の予定を特定できませんでした',
          }, { status: 400 })
        }

        const { data: ownedCalendar, error: calendarLookupError } = await supabase
          .from('user_calendars')
          .select('google_calendar_id, access_level')
          .eq('user_id', user.id)
          .eq('google_calendar_id', calendarId)
          .maybeSingle()
        if (calendarLookupError) throw calendarLookupError
        if (!ownedCalendar && calendarId !== 'primary') {
          return NextResponse.json({
            success: false,
            message: '❌ 選択したカレンダーは利用できません',
          }, { status: 400 })
        }
        if (ownedCalendar && !['owner', 'writer'].includes(ownedCalendar.access_level || '')) {
          return NextResponse.json({
            success: false,
            message: '❌ このカレンダーは閲覧専用のため削除できません',
          }, { status: 403 })
        }

        const { calendar } = await getCalendarClient(user.id)
        const requestedScope = delete_scope === 'series' ? 'series' : 'this'
        const targetEventId = requestedScope === 'series'
          ? (recurring_event_id?.trim() || eventId)
          : eventId
        let eventSnapshot: calendar_v3.Schema$Event | null = null
        try {
          const eventRes = await calendar.events.get({
            calendarId,
            eventId: targetEventId,
          })
          eventSnapshot = eventRes.data
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }

        const undoLog = eventSnapshot
          ? await supabase
              .from('calendar_sync_log')
              .insert({
                user_id: user.id,
                google_event_id: targetEventId,
                action: 'delete_with_undo',
                direction: 'to_calendar',
                status: 'pending',
                sync_data: {
                  calendar_id: calendarId,
                  event_id: targetEventId,
                  original_event_id: eventId,
                  delete_scope: requestedScope,
                  recurring_event_id: recurring_event_id || eventSnapshot.recurringEventId || null,
                  title: title || eventSnapshot.summary || null,
                  start_time: start_time || eventSnapshot.start?.dateTime || eventSnapshot.start?.date || null,
                  end_time: end_time || eventSnapshot.end?.dateTime || eventSnapshot.end?.date || null,
                  restore_event: toRestorableGoogleEvent(eventSnapshot),
                  restore_mode: requestedScope === 'this' && (recurring_event_id || eventSnapshot.recurringEventId)
                    ? 'standalone_equivalent'
                    : 'event_insert',
                },
              })
              .select('id')
              .single()
          : null
        if (undoLog?.error) throw undoLog.error

        let deletedFromGoogle = false
        try {
          await calendar.events.delete({
            calendarId,
            eventId: targetEventId,
          })
          deletedFromGoogle = true
        } catch (error) {
          if (!isMissingCalendarEventError(error)) throw error
        }

        if (undoLog?.data?.id) {
          await supabase
            .from('calendar_sync_log')
            .update({ status: deletedFromGoogle ? 'success' : 'not_found' })
            .eq('id', undoLog.data.id)
            .eq('user_id', user.id)
        }

        let calendarEventDeleteQuery = supabase
          .from('calendar_events')
          .delete()
          .eq('user_id', user.id)
          .eq('calendar_id', calendarId)

        calendarEventDeleteQuery = requestedScope === 'series'
          ? calendarEventDeleteQuery.or(`google_event_id.eq.${targetEventId},recurring_event_id.eq.${targetEventId}`)
          : calendarEventDeleteQuery.eq('google_event_id', targetEventId)

        await calendarEventDeleteQuery

        await supabase
          .from('tasks')
          .update({
            deleted_at: new Date().toISOString(),
            is_timer_running: false,
            last_started_at: null,
          })
          .eq('user_id', user.id)
          .eq('calendar_id', calendarId)
          .eq('google_event_id', targetEventId)
          .is('deleted_at', null)

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
          .eq('google_event_id', targetEventId)

        const dateLabel = start_time
          ? new Date(start_time).toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''
        const displayTitle = title || '予定'
        return NextResponse.json({
          success: true,
          message: deletedFromGoogle
            ? `✅ ${dateLabel ? `${dateLabel}の` : ''}予定「${displayTitle}」をカレンダーから削除しました`
            : `✅ 予定「${displayTitle}」はGoogleカレンダー上に見つかりませんでした。Focusmap側の同期情報を整理しました`,
          eventData: {
            google_event_id: targetEventId,
            calendar_id: calendarId,
            title: displayTitle,
            start_time,
            end_time,
            deleted: true,
            delete_scope: requestedScope,
            undo_id: undoLog?.data?.id || null,
          },
        })
      }

      case 'restore_calendar_event': {
        const { undo_id } = action.params as { undo_id?: string }
        if (!undo_id) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元対象が見つかりません',
          }, { status: 400 })
        }

        const { data: undoLog, error: undoLookupError } = await supabase
          .from('calendar_sync_log')
          .select('id, google_event_id, sync_data, created_at')
          .eq('id', undo_id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (undoLookupError) throw undoLookupError
        if (!undoLog?.sync_data || typeof undoLog.sync_data !== 'object') {
          return NextResponse.json({
            success: false,
            message: '❌ 復元データが見つかりません',
          }, { status: 404 })
        }
        const createdAt = new Date(undoLog.created_at).getTime()
        const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
        const startOfJstDayUtc = Date.UTC(
          jstNow.getUTCFullYear(),
          jstNow.getUTCMonth(),
          jstNow.getUTCDate(),
          -9,
          0,
          0,
          0,
        )
        if (!Number.isFinite(createdAt) || createdAt < startOfJstDayUtc) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元できるのは当日中に削除した予定のみです',
          }, { status: 400 })
        }

        const syncData = undoLog.sync_data as {
          calendar_id?: string
          restore_event?: calendar_v3.Schema$Event
          title?: string | null
          start_time?: string | null
          end_time?: string | null
        }
        const calendarId = syncData.calendar_id
        const restoreEvent = syncData.restore_event
        if (!calendarId || !restoreEvent) {
          return NextResponse.json({
            success: false,
            message: '❌ 復元データが不完全です',
          }, { status: 400 })
        }

        const { calendar } = await getCalendarClient(user.id)
        const restored = await calendar.events.insert({
          calendarId,
          requestBody: restoreEvent,
        })
        const restoredEventId = restored.data.id
        if (!restoredEventId) {
          throw new Error('Google Calendar did not return a restored event id')
        }

        await supabase
          .from('calendar_sync_log')
          .insert({
            user_id: user.id,
            google_event_id: restoredEventId,
            action: 'restore_delete',
            direction: 'to_calendar',
            status: 'success',
            sync_data: {
              undo_id,
              calendar_id: calendarId,
              restored_google_event_id: restoredEventId,
              original_google_event_id: undoLog.google_event_id,
            },
          })

        const displayTitle = syncData.title || restoreEvent.summary || '予定'
        const dateLabel = syncData.start_time
          ? new Date(syncData.start_time).toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''
        return NextResponse.json({
          success: true,
          message: `✅ ${dateLabel ? `${dateLabel}の` : ''}予定「${displayTitle}」を復元しました`,
          eventData: {
            google_event_id: restoredEventId,
            calendar_id: calendarId,
            title: displayTitle,
            start_time: syncData.start_time,
            end_time: syncData.end_time,
            restored: true,
          },
        })
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

      case 'add_mindmap_group': {
        const { title, project_id } = action.params as {
          title: string; project_id: string
        }
        // 現在の最大order_indexを取得
        const { data: maxOrderGroup } = await supabase
          .from('tasks')
          .select('order_index')
          .eq('user_id', user.id)
          .eq('project_id', project_id)
          .is('parent_task_id', null)
          .is('deleted_at', null)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextOrder = (maxOrderGroup?.order_index ?? -1) + 1

        const { error } = await supabase
          .from('tasks')
          .insert({
            title,
            user_id: user.id,
            project_id,
            is_group: true,
            parent_task_id: null,
            status: 'todo',
            stage: 'plan',
            order_index: nextOrder,
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ マインドマップに「${title}」グループを追加しました`,
          actionType: 'mindmap_updated',
        })
      }

      case 'add_mindmap_task': {
        const { title, parent_id, project_id } = action.params as {
          title: string; parent_id: string; project_id: string
        }
        // 親ノードの存在確認
        const { data: parentNode } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('id', parent_id)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle()

        if (!parentNode) {
          return NextResponse.json({
            success: false,
            message: '❌ 指定された親ノードが見つかりません',
          }, { status: 400 })
        }

        // 現在の最大order_indexを取得
        const { data: maxOrderTask } = await supabase
          .from('tasks')
          .select('order_index')
          .eq('user_id', user.id)
          .eq('parent_task_id', parent_id)
          .is('deleted_at', null)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextTaskOrder = (maxOrderTask?.order_index ?? -1) + 1

        const { error } = await supabase
          .from('tasks')
          .insert({
            title,
            user_id: user.id,
            project_id,
            parent_task_id: parent_id,
            is_group: false,
            status: 'todo',
            stage: 'plan',
            order_index: nextTaskOrder,
          })
        if (error) throw error
        return NextResponse.json({
          success: true,
          message: `✅ 「${parentNode.title}」に「${title}」を追加しました`,
          actionType: 'mindmap_updated',
        })
      }

      case 'delete_mindmap_node': {
        const { node_id, node_title } = action.params as {
          node_id: string; node_title?: string
        }
        // ノードの存在確認（所有者チェック）
        const { data: targetNode } = await supabase
          .from('tasks')
          .select('id, title, is_group')
          .eq('id', node_id)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle()

        if (!targetNode) {
          return NextResponse.json({
            success: false,
            message: '❌ 指定されたノードが見つかりません',
          }, { status: 400 })
        }

        // ソフトデリート（deleted_at を設定）
        const now = new Date().toISOString()
        const { error } = await supabase
          .from('tasks')
          .update({ deleted_at: now })
          .eq('id', node_id)
          .eq('user_id', user.id)

        if (error) throw error

        // グループの場合は子タスクもソフトデリート
        if (targetNode.is_group) {
          await supabase
            .from('tasks')
            .update({ deleted_at: now })
            .eq('parent_task_id', node_id)
            .eq('user_id', user.id)
            .is('deleted_at', null)
        }

        const displayTitle = node_title || targetNode.title
        return NextResponse.json({
          success: true,
          message: `✅ マインドマップから「${displayTitle}」を削除しました`,
          actionType: 'mindmap_updated',
        })
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
