import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { syncTaskToCalendar } from '@/lib/google-calendar';

/**
 * タスクをGoogleカレンダーに同期
 * POST /api/calendar/sync-task
 * Body: { taskId: string, scheduledAt: string, estimatedTime?: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, scheduledAt, estimatedTime } = await request.json();

    console.log('[sync-task] Request:', { taskId, scheduledAt, estimatedTime });

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    if (!scheduledAt) {
      return NextResponse.json({ error: 'scheduledAt is required' }, { status: 400 });
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    console.log('[sync-task] Task found:', task ? task.id : 'null', 'Error:', taskError);

    if (taskError || !task) {
      return NextResponse.json({
        error: 'Task not found',
        details: taskError?.message
      }, { status: 404 });
    }

    // カレンダーへのドロップ時は1分間のイベントを作成
    // estimated_time が指定されていない場合、または既存のタスクに時間がない場合は1分を使用
    const finalEstimatedTime = estimatedTime || (!task.estimated_time ? 1 : task.estimated_time);

    // タスクの scheduled_at と estimated_time を更新
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        scheduled_at: scheduledAt,
        estimated_time: finalEstimatedTime,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[sync-task] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }

    // 更新されたタスクを再取得
    const { data: updatedTask } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (!updatedTask) {
      return NextResponse.json({ error: 'Failed to fetch updated task' }, { status: 500 });
    }

    // カレンダー連携が有効か確認
    const { data: settings } = await supabase
      .from('user_calendar_settings')
      .select('is_sync_enabled')
      .eq('user_id', user.id)
      .single();

    if (!settings?.is_sync_enabled) {
      return NextResponse.json(
        { error: 'Calendar sync is not enabled' },
        { status: 400 }
      );
    }

    // Googleカレンダーに同期
    const result = await syncTaskToCalendar(user.id, taskId, task);

    return NextResponse.json({
      success: true,
      googleEventId: result.googleEventId,
    });
  } catch (error: any) {
    console.error('Sync task error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync task' },
      { status: 500 }
    );
  }
}
