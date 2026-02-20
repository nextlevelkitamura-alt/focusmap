import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { syncTaskToCalendar, deleteTaskFromCalendar } from '@/lib/google-calendar';

/**
 * タスクをカレンダーにスケジュール
 * POST /api/tasks/:id/schedule
 *
 * Body: {
 *   scheduledAt: string,        // ISO 8601形式
 *   calendarId?: string,        // GoogleカレンダーID（省略時はプライマリ）
 *   createCalendarEvent?: boolean  // デフォルト: true
 * }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: taskId } = await context.params;
    const body = await request.json();
    const { scheduledAt, calendarId, createCalendarEvent = true } = body;

    if (!scheduledAt) {
      return NextResponse.json(
        { error: 'scheduledAt is required' },
        { status: 400 }
      );
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: 'Task not found', details: taskError?.message },
        { status: 404 }
      );
    }

    // scheduled_at を更新し、stage を 'scheduled' に遷移
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        scheduled_at: scheduledAt,
        stage: task.status === 'done' ? 'done' : 'scheduled',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[schedule] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update task' },
        { status: 500 }
      );
    }

    let eventData: any = null;

    // カレンダーイベントを作成
    if (createCalendarEvent && task.estimated_time > 0) {
      // カレンダー連携が有効か確認
      const { data: settings } = await supabase
        .from('user_calendar_settings')
        .select('is_sync_enabled, default_calendar_id')
        .eq('user_id', user.id)
        .single();

      if (settings?.is_sync_enabled) {
        try {
          // Googleカレンダーに同期
          const result = await syncTaskToCalendar(user.id, taskId, {
            title: task.title,
            scheduled_at: scheduledAt,
            estimated_time: task.estimated_time,
            google_event_id: task.google_event_id,
            calendar_id: calendarId || settings?.default_calendar_id
          });

          // calendar_events テーブルにも作成
          const startDate = new Date(scheduledAt);
          const endDate = new Date(startDate.getTime() + task.estimated_time * 60 * 1000);

          const { data: calendarEvent, error: eventError } = await supabase
            .from('calendar_events')
            .upsert({
              user_id: user.id,
              google_event_id: result.googleEventId,
              calendar_id: calendarId || settings?.default_calendar_id || 'primary',
              title: `🎯 ${task.title}`,
              start_time: startDate.toISOString(),
              end_time: endDate.toISOString(),
              is_all_day: false,
              timezone: 'Asia/Tokyo',
              synced_at: new Date().toISOString()
            })
            .select()
            .single();

          if (!eventError && calendarEvent) {
            // calendar_event_id を設定
            await supabase
              .from('tasks')
              .update({ calendar_event_id: calendarEvent.id })
              .eq('id', taskId);

            eventData = {
              id: calendarEvent.id,
              googleEventId: result.googleEventId,
              title: calendarEvent.title,
              startTime: calendarEvent.start_time,
              endTime: calendarEvent.end_time
            };
          }
        } catch (syncError: any) {
          console.error('[schedule] Sync error:', syncError);
          // 同期エラーでもタスク自体は更新済みなので続行
        }
      }
    }

    // 更新後のタスクを取得
    const { data: updatedTask } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    return NextResponse.json({
      success: true,
      task: updatedTask,
      event: eventData
    });
  } catch (error: any) {
    console.error('[schedule] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to schedule task' },
      { status: 500 }
    );
  }
}

/**
 * タスクのスケジュールを解除
 * DELETE /api/tasks/:id/schedule
 *
 * Body: {
 *   deleteCalendarEvent?: boolean  // デフォルト: true
 * }
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: taskId } = await context.params;
    const body = await request.json();
    const { deleteCalendarEvent = true } = body;

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // カレンダーイベントを削除
    if (deleteCalendarEvent && task.google_event_id) {
      try {
        await deleteTaskFromCalendar(user.id, taskId, task.google_event_id);
      } catch (deleteError: any) {
        console.error('[unschedule] Delete calendar error:', deleteError);
        // 削除エラーがあってもタスクのスケジュール解除は続行
      }

      // ローカル calendar_events の削除
      if (task.calendar_event_id) {
        await supabase
          .from('calendar_events')
          .delete()
          .eq('id', task.calendar_event_id);
      }
    }

    // scheduled_at と calendar_event_id をクリアし、stage を 'plan' に戻す
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        scheduled_at: null,
        calendar_event_id: null,
        stage: task.status === 'done' ? 'done' : 'plan',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[unschedule] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to unschedule task' },
        { status: 500 }
      );
    }

    // 更新後のタスクを取得
    const { data: updatedTask } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    return NextResponse.json({
      success: true,
      task: updatedTask
    });
  } catch (error: any) {
    console.error('[unschedule] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to unschedule task' },
      { status: 500 }
    );
  }
}
