import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deleteTaskFromCalendar } from '@/lib/google-calendar';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * タスクを取得
 * GET /api/tasks/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      task
    });

  } catch (error: unknown) {
    console.error('[tasks/[id]] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to fetch task')
        }
      },
      { status: 500 }
    );
  }
}

/**
 * タスクを削除（関連するGoogleカレンダーイベントも削除）
 * DELETE /api/tasks/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;

    // タスクを取得（google_event_idとcalendar_idを確認するため）
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    // Googleカレンダーイベントを削除（存在する場合）
    if (task.google_event_id) {
      try {
        console.log('[tasks/[id] DELETE] Deleting Google Calendar event:', task.google_event_id);
        await deleteTaskFromCalendar(
          user.id,
          taskId,
          task.google_event_id,
          task.calendar_id || undefined
        );
        console.log('[tasks/[id] DELETE] Google Calendar event deleted');
      } catch (calendarError: unknown) {
        console.error('[tasks/[id] DELETE] Failed to delete Google Calendar event:', calendarError);
        // カレンダー削除が失敗してもタスク削除は続行
      }
    }

    // タスクを削除
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('[tasks/[id] DELETE] Failed to delete task:', deleteError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DELETE_ERROR',
            message: 'Failed to delete task'
          }
        },
        { status: 500 }
      );
    }

    console.log('[tasks/[id] DELETE] Task deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error: unknown) {
    console.error('[tasks/[id] DELETE] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to delete task')
        }
      },
      { status: 500 }
    );
  }
}

/**
 * タスクを更新（関連するGoogleカレンダーイベントも更新）
 * PATCH /api/tasks/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;
    const body = await request.json();

    // タスクを取得（google_event_idとcalendar_idを確認するため）
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    // タスクを更新
    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update({
        ...body,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[tasks/[id] PATCH] Failed to update task:', updateError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UPDATE_ERROR',
            message: 'Failed to update task'
          }
        },
        { status: 500 }
      );
    }

    // Googleカレンダーイベントも更新（存在する場合）
    if (task.google_event_id && updatedTask) {
      try {
        // タイトル、予定時刻、推定時間が変更された場合のみカレンダーも更新
        const shouldUpdateCalendar =
          body.title !== undefined ||
          body.scheduled_at !== undefined ||
          body.estimated_time !== undefined;

        if (shouldUpdateCalendar) {
          console.log('[tasks/[id] PATCH] Updating Google Calendar event:', task.google_event_id);

          const { syncTaskToCalendar } = await import('@/lib/google-calendar');
          await syncTaskToCalendar(user.id, taskId, {
            title: updatedTask.title,
            scheduled_at: updatedTask.scheduled_at,
            estimated_time: updatedTask.estimated_time || 60,
            google_event_id: task.google_event_id,
            calendar_id: task.calendar_id || 'primary'
          });

          console.log('[tasks/[id] PATCH] Google Calendar event updated');
        }
      } catch (calendarError: unknown) {
        console.error('[tasks/[id] PATCH] Failed to update Google Calendar event:', calendarError);
        // カレンダー更新が失敗してもタスク更新は成功とする
      }

      const shouldUpdateLinkedMemo =
        body.title !== undefined ||
        body.scheduled_at !== undefined ||
        body.estimated_time !== undefined;

      if (shouldUpdateLinkedMemo) {
        const memoUpdates: Record<string, unknown> = {
          scheduled_at: updatedTask.scheduled_at,
          duration_minutes: updatedTask.estimated_time || 60,
          memo_status: 'scheduled',
          updated_at: new Date().toISOString(),
        };
        if (body.title !== undefined) {
          memoUpdates.title = updatedTask.title;
        }

        try {
          const { error: memoUpdateError } = await supabase
            .from('ideal_goals')
            .update(memoUpdates)
            .eq('user_id', user.id)
            .eq('google_event_id', task.google_event_id);

          if (memoUpdateError) {
            console.error('[tasks/[id] PATCH] Failed to update linked memo:', memoUpdateError);
          }
        } catch (memoUpdateError) {
          console.error('[tasks/[id] PATCH] Failed to update linked memo:', memoUpdateError);
        }
      }
    }

    console.log('[tasks/[id] PATCH] Task updated successfully');

    return NextResponse.json({
      success: true,
      task: updatedTask,
      message: 'Task updated successfully'
    });

  } catch (error: unknown) {
    console.error('[tasks/[id] PATCH] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to update task')
        }
      },
      { status: 500 }
    );
  }
}
