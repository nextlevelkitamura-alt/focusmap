import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deleteTaskFromCalendar } from '@/lib/google-calendar';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function normalizeTokyoDateString(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === 'string' || value instanceof Date
    ? new Date(value)
    : new Date();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

async function syncGoogleEventCompletionForTask(
  supabase: SupabaseServerClient,
  userId: string,
  task: {
    google_event_id: string | null;
    calendar_id: string | null;
    scheduled_at: string | null;
    status: string;
  }
) {
  if (!task.google_event_id) return;

  const isCompleted = task.status === 'done';
  const completedDate = normalizeTokyoDateString(task.scheduled_at);
  if (!completedDate) {
    console.warn('[tasks/[id] PATCH] Skip event completion sync: invalid scheduled_at', {
      taskGoogleEventId: task.google_event_id,
      scheduledAt: task.scheduled_at,
    });
    return;
  }

  let updateQuery = supabase
    .from('calendar_events')
    .update({ is_completed: isCompleted })
    .eq('user_id', userId)
    .eq('google_event_id', task.google_event_id);

  if (task.calendar_id) {
    updateQuery = updateQuery.eq('calendar_id', task.calendar_id);
  }

  const updateResult = await updateQuery.select('id, calendar_id');
  let updatedRows = updateResult.data;

  if (updateResult.error) {
    console.error('[tasks/[id] PATCH] Failed to sync calendar_events completion:', updateResult.error);
    return;
  }

  if (task.calendar_id && (!updatedRows || updatedRows.length === 0)) {
    const retry = await supabase
      .from('calendar_events')
      .update({ is_completed: isCompleted })
      .eq('user_id', userId)
      .eq('google_event_id', task.google_event_id)
      .select('id, calendar_id');

    if (retry.error) {
      console.error('[tasks/[id] PATCH] Failed to retry calendar_events completion sync:', retry.error);
      return;
    }

    updatedRows = retry.data;
  }

  const calendarId = updatedRows?.[0]?.calendar_id || task.calendar_id;

  if (isCompleted) {
    if (!calendarId) {
      console.warn('[tasks/[id] PATCH] Skip event completion sidecar: missing calendar_id', {
        google_event_id: task.google_event_id,
        completedDate,
      });
      return;
    }

    const { error } = await supabase
      .from('event_completions')
      .upsert({
        user_id: userId,
        google_event_id: task.google_event_id,
        calendar_id: calendarId,
        completed_date: completedDate,
      }, {
        onConflict: 'user_id,google_event_id,completed_date',
      });

    if (error) {
      console.error('[tasks/[id] PATCH] Failed to upsert event completion sidecar:', error);
    }
    return;
  }

  const { error } = await supabase
    .from('event_completions')
    .delete()
    .eq('user_id', userId)
    .eq('google_event_id', task.google_event_id)
    .eq('completed_date', completedDate);

  if (error) {
    console.error('[tasks/[id] PATCH] Failed to delete event completion sidecar:', error);
  }
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

    const updatePayload = {
      ...body,
      updated_at: new Date().toISOString()
    };

    let updatedTask;
    let updateError;

    if (body.status !== undefined && task.source === 'google_event' && task.google_event_id) {
      const result = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('user_id', user.id)
        .eq('google_event_id', task.google_event_id)
        .is('deleted_at', null)
        .select();

      updateError = result.error;
      updatedTask = result.data?.find(row => row.id === taskId) ?? result.data?.[0] ?? null;
    } else {
      const result = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', taskId)
        .eq('user_id', user.id)
        .select()
        .single();

      updateError = result.error;
      updatedTask = result.data;
    }

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

    if (body.status !== undefined && updatedTask) {
      const linkedMemoStatus = updatedTask.status === 'done'
        ? 'done'
        : (updatedTask.scheduled_at ? 'scheduled' : 'task');

      try {
        const { data: memoLinks, error: memoLinksError } = await supabase
          .from('memo_node_links')
          .select('memo_item_id')
          .eq('user_id', user.id)
          .eq('task_id', taskId)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active');

        if (memoLinksError) {
          console.error('[tasks/[id] PATCH] Failed to load linked memo items:', memoLinksError);
        } else {
          const memoItemIds = Array.from(new Set(
            (memoLinks ?? [])
              .map(link => link.memo_item_id)
              .filter((memoItemId): memoItemId is string => typeof memoItemId === 'string' && memoItemId.length > 0)
          ));

          if (memoItemIds.length > 0) {
            const { error: memoItemUpdateError } = await supabase
              .from('memo_items')
              .update({
                status: linkedMemoStatus,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', user.id)
              .in('id', memoItemIds);

            if (memoItemUpdateError) {
              console.error('[tasks/[id] PATCH] Failed to sync structured memo status:', memoItemUpdateError);
            }
          }
        }
      } catch (memoSyncError) {
        console.error('[tasks/[id] PATCH] Failed to sync structured memo status:', memoSyncError);
      }
    }

    // Googleカレンダーイベントも更新（存在する場合）
    if (task.google_event_id && updatedTask) {
      try {
        if (body.status !== undefined) {
          await syncGoogleEventCompletionForTask(supabase, user.id, {
            google_event_id: task.google_event_id,
            calendar_id: updatedTask.calendar_id ?? task.calendar_id,
            scheduled_at: updatedTask.scheduled_at ?? task.scheduled_at,
            status: updatedTask.status ?? body.status,
          });
        }

        // タイトル、予定時刻、推定時間が変更された場合のみカレンダーも更新
        const shouldUpdateCalendar =
          body.title !== undefined ||
          body.scheduled_at !== undefined ||
          body.estimated_time !== undefined ||
          body.memo !== undefined;

        if (shouldUpdateCalendar) {
          console.log('[tasks/[id] PATCH] Updating Google Calendar event:', task.google_event_id);

          const { syncTaskToCalendar } = await import('@/lib/google-calendar');
          await syncTaskToCalendar(user.id, taskId, {
            title: updatedTask.title,
            scheduled_at: updatedTask.scheduled_at,
            estimated_time: updatedTask.estimated_time || 60,
            google_event_id: task.google_event_id,
            calendar_id: task.calendar_id || 'primary',
            memo: updatedTask.memo
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
