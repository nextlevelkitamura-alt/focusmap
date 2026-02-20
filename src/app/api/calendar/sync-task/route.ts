import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { syncTaskToCalendar, deleteTaskFromCalendar } from '@/lib/google-calendar';

/**
 * タスクをGoogleカレンダーに同期（新規作成）
 * POST /api/calendar/sync-task
 * Body: { taskId: string, scheduled_at: string, estimated_time: number, calendar_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, scheduled_at, estimated_time, calendar_id } = await request.json();

    console.log('[sync-task POST] Request:', { taskId, scheduled_at, estimated_time, calendar_id });

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    if (!scheduled_at) {
      return NextResponse.json({ error: 'scheduled_at is required' }, { status: 400 });
    }

    if (!estimated_time || estimated_time <= 0) {
      return NextResponse.json({ error: 'estimated_time is required and must be > 0' }, { status: 400 });
    }

    if (!calendar_id) {
      return NextResponse.json({ error: 'calendar_id is required' }, { status: 400 });
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({
        error: 'Task not found',
        details: taskError?.message
      }, { status: 404 });
    }

    // タスクに calendar_id を保存し、stage を 'scheduled' に遷移
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        calendar_id,
        stage: task.status === 'done' ? 'done' : 'scheduled',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[sync-task POST] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }

    // カレンダー連携設定を確認
    const { data: settings, error: settingsError } = await supabase
      .from('user_calendar_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();  // single() → maybeSingle() でデータがない場合もOKに

    console.log('[sync-task POST] Calendar settings:', { settings, settingsError: settingsError?.message });

    // カレンダー連携がされていない場合
    if (settingsError || !settings) {
      console.error('[sync-task POST] Calendar not connected:', settingsError);
      return NextResponse.json(
        { error: 'Google Calendar is not connected. Please connect your Google Calendar first.' },
        { status: 400 }
      );
    }

    if (!settings.is_sync_enabled) {
      return NextResponse.json(
        { error: 'Calendar sync is disabled in settings' },
        { status: 400 }
      );
    }

    // DB上で既に google_event_id がある場合は更新として扱う（重複防止）
    const result = await syncTaskToCalendar(user.id, taskId, {
      title: task.title,
      scheduled_at,
      estimated_time,
      google_event_id: task.google_event_id || undefined,
      calendar_id
    });

    return NextResponse.json({
      success: true,
      googleEventId: result.googleEventId,
    });
  } catch (error: any) {
    console.error('[sync-task POST] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync task' },
      { status: 500 }
    );
  }
}

/**
 * タスクのGoogleカレンダーイベントを更新
 * PATCH /api/calendar/sync-task
 * Body: { taskId: string, scheduled_at: string, estimated_time: number, calendar_id: string }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, scheduled_at, estimated_time, calendar_id } = await request.json();

    console.log('[sync-task PATCH] Request:', { taskId, scheduled_at, estimated_time, calendar_id });

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({
        error: 'Task not found',
        details: taskError?.message
      }, { status: 404 });
    }

    if (!task.google_event_id) {
      return NextResponse.json({ error: 'Task has no google_event_id' }, { status: 400 });
    }

    // Googleカレンダーイベントを更新
    const result = await syncTaskToCalendar(user.id, taskId, {
      title: task.title,
      scheduled_at,
      estimated_time,
      google_event_id: task.google_event_id,
      calendar_id
    });

    return NextResponse.json({
      success: true,
      googleEventId: result.googleEventId,
    });
  } catch (error: any) {
    console.error('[sync-task PATCH] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update task' },
      { status: 500 }
    );
  }
}

/**
 * タスクのGoogleカレンダーイベントを削除
 * DELETE /api/calendar/sync-task
 * Body: { taskId: string, google_event_id: string }
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, google_event_id } = await request.json();

    console.log('[sync-task DELETE] Request:', { taskId, google_event_id });

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    if (!google_event_id) {
      return NextResponse.json({ error: 'google_event_id is required' }, { status: 400 });
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({
        error: 'Task not found',
        details: taskError?.message
      }, { status: 404 });
    }

    // Googleカレンダーからイベントを削除
    await deleteTaskFromCalendar(user.id, taskId, google_event_id, task.calendar_id || undefined);

    // タスクの google_event_id と calendar_id をクリア
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        google_event_id: null,
        calendar_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[sync-task DELETE] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error('[sync-task DELETE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete event' },
      { status: 500 }
    );
  }
}
