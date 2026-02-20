import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deleteTaskFromCalendar } from '@/lib/google-calendar';

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

  } catch (error: any) {
    console.error('[tasks/[id]] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to fetch task'
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
      // tasks テーブルに見つからない場合、task_groups テーブル（旧スキーマ）を確認
      console.log('[tasks/[id] DELETE] Task not found in tasks table, checking task_groups (legacy):', taskId);
      try {
        const { data: legacyGroup } = await supabase
          .from('task_groups')
          .select('id')
          .eq('id', taskId)
          .single();

        if (legacyGroup) {
          // task_groups から削除
          const { error: legacyDeleteError } = await supabase
            .from('task_groups')
            .delete()
            .eq('id', taskId);

          if (legacyDeleteError) {
            console.error('[tasks/[id] DELETE] Failed to delete from task_groups:', legacyDeleteError);
            return NextResponse.json(
              { success: false, error: { code: 'DELETE_ERROR', message: 'Failed to delete legacy group' } },
              { status: 500 }
            );
          }

          // task_groups に紐づく子タスクも削除（group_id で参照しているもの）
          await supabase.from('tasks').delete().eq('group_id', taskId);

          console.log('[tasks/[id] DELETE] Legacy group deleted from task_groups:', taskId);
          return NextResponse.json({ success: true, message: 'Legacy group deleted successfully' });
        }
      } catch (legacyError) {
        console.error('[tasks/[id] DELETE] Error checking task_groups:', legacyError);
      }

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
      } catch (calendarError: any) {
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

    // task_groups テーブルにも同じIDのレコードがあれば削除（マイグレーション済みデータの重複クリーンアップ）
    try {
      await supabase.from('task_groups').delete().eq('id', taskId);
    } catch {
      // task_groups にレコードがなくてもエラーは無視
    }

    console.log('[tasks/[id] DELETE] Task deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error: any) {
    console.error('[tasks/[id] DELETE] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to delete task'
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
      } catch (calendarError: any) {
        console.error('[tasks/[id] PATCH] Failed to update Google Calendar event:', calendarError);
        // カレンダー更新が失敗してもタスク更新は成功とする
      }
    }

    console.log('[tasks/[id] PATCH] Task updated successfully');

    return NextResponse.json({
      success: true,
      task: updatedTask,
      message: 'Task updated successfully'
    });

  } catch (error: any) {
    console.error('[tasks/[id] PATCH] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to update task'
        }
      },
      { status: 500 }
    );
  }
}
