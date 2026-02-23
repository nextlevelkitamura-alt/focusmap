import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getCalendarClient } from '@/lib/google-calendar';
import { classifyCalendarAuthError } from '@/lib/calendar-auth-errors';

function popupReminderMinutes(
  reminders: Array<{ method?: string | null; minutes?: number | null }> | null | undefined
): number[] {
  return (reminders || [])
    .filter((r) => r.method === 'popup')
    .map((r) => r.minutes)
    .filter((minutes): minutes is number => typeof minutes === 'number');
}

/**
 * カレンダーイベントの詳細取得（通知設定確認用）
 * GET /api/calendar/events/[eventId]?googleEventId=xxx&calendarId=yyy
 */
export async function GET(
  request: NextRequest
) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const googleEventId = searchParams.get('googleEventId');
  const calendarId = searchParams.get('calendarId') || 'primary';

  if (!googleEventId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'googleEventId is required'
        }
      },
      { status: 400 }
    );
  }

  try {
    const { calendar } = await getCalendarClient(user.id);

    const response = await calendar.events.get({
      calendarId,
      eventId: googleEventId,
    });

    const event = response.data;
    const reminderOverrides = popupReminderMinutes(event.reminders?.overrides);
    const usesCalendarDefault = event.reminders === undefined || event.reminders?.useDefault === true;
    let calendarDefaultReminders: number[] = [];
    if (usesCalendarDefault && reminderOverrides.length === 0) {
      try {
        const calendarInfo = await calendar.calendarList.get({ calendarId });
        calendarDefaultReminders = popupReminderMinutes(calendarInfo.data.defaultReminders);
      } catch (calendarInfoError) {
        console.warn('[events/get] Failed to fetch calendar default reminders:', {
          calendarId,
          error: calendarInfoError,
        });
      }
    }

    const reminders = reminderOverrides.length > 0
      ? reminderOverrides
      : usesCalendarDefault
        ? calendarDefaultReminders
        : [];

    return NextResponse.json({
      success: true,
      reminders,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const authErrorInfo = classifyCalendarAuthError(errorMessage);
    if (authErrorInfo) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: authErrorInfo.code,
            message: authErrorInfo.message
          }
        },
        { status: authErrorInfo.status }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorMessage || 'Failed to fetch event details'
        }
      },
      { status: 500 }
    );
  }
}

/**
 * カレンダーイベントを削除
 * DELETE /api/calendar/events/[eventId]
 *
 * URLパラメータ:
 *   eventId: 削除するイベントのID
 *
 * クエリパラメータ:
 *   googleEventId: Google Calendar のイベントID
 *   calendarId: カレンダーID（オプション、デフォルトはprimary）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  console.log('[events/delete] Deleting event:', eventId);
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[events/delete] Unauthorized');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  console.log('[events/delete] User authenticated:', user.id);

  // Try query params first, then body
  const searchParams = request.nextUrl.searchParams;
  let googleEventId = searchParams.get('googleEventId');
  let calendarId = searchParams.get('calendarId') || 'primary';

  // If not in query params, try request body
  if (!googleEventId) {
    try {
      const body = await request.json();
      googleEventId = body.googleEventId;
      calendarId = body.calendarId || 'primary';
    } catch {
      // No body or parse error
    }
  }

  if (!googleEventId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'googleEventId is required'
        }
      },
      { status: 400 }
    );
  }

  try {
    // Google Calendar からイベントを削除
    console.log('[events/delete] Deleting from Google Calendar:', googleEventId, 'from calendar:', calendarId);
    const { calendar } = await getCalendarClient(user.id);

    await calendar.events.delete({
      calendarId,
      eventId: googleEventId,
    });

    console.log('[events/delete] Deleted from Google Calendar');

    // DB からも削除
    const { error: dbError } = await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);

    if (dbError) {
      console.error('[events/delete] Failed to delete from database:', dbError);
    } else {
      console.log('[events/delete] Deleted from database');
    }

    // 関連するタスクの google_event_id と calendar_id をクリア
    const { data: relatedTasks } = await supabase
      .from('tasks')
      .select('id, source')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);

    if (relatedTasks && relatedTasks.length > 0) {
      console.log('[events/delete] Found related tasks:', relatedTasks.length);

      const importedTaskIds = relatedTasks
        .filter(task => task.source === 'google_event')
        .map(task => task.id);
      const manualTaskIds = relatedTasks
        .filter(task => task.source !== 'google_event')
        .map(task => task.id);

      if (importedTaskIds.length > 0) {
        const { error: importedTaskDeleteError } = await supabase
          .from('tasks')
          .update({
            deleted_at: new Date().toISOString(),
            is_timer_running: false,
            last_started_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .in('id', importedTaskIds);

        if (importedTaskDeleteError) {
          console.error('[events/delete] Failed to soft-delete imported tasks:', importedTaskDeleteError);
        } else {
          console.log('[events/delete] Soft-deleted imported tasks:', importedTaskIds.length);
        }
      }

      if (manualTaskIds.length > 0) {
        const { error: manualTaskUpdateError } = await supabase
          .from('tasks')
          .update({
            google_event_id: null,
            calendar_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .in('id', manualTaskIds);

        if (manualTaskUpdateError) {
          console.error('[events/delete] Failed to detach manual tasks from deleted event:', manualTaskUpdateError);
        } else {
          console.log('[events/delete] Detached manual tasks from deleted event:', manualTaskIds.length);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error: unknown) {
    console.error('[events/delete] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const authError = classifyCalendarAuthError(errorMessage);
    if (authError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: authError.code,
            message: authError.message
          }
        },
        { status: authError.status }
      );
    }

    // その他のエラー
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorMessage || 'Failed to delete event'
        }
      },
      { status: 500 }
    );
  }
}

/**
 * カレンダーイベントを更新
 * PATCH /api/calendar/events/[eventId]
 *
 * URLパラメータ:
 *   eventId: 更新するイベントのID
 *
 * ボディ:
 *   title: イベントタイトル
 *   start_time: 開始時刻
 *   end_time: 終了時刻
 *   description: 説明（オプション）
 *   location: 場所（オプション）
 *   googleEventId: Google Calendar のイベントID
 *   calendarId: カレンダーID（オプション、デフォルトはprimary）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  console.log('[events/update] Updating event:', eventId);
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[events/update] Unauthorized');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  console.log('[events/update] User authenticated:', user.id);

  try {
    const body = await request.json();
    const { title, start_time, end_time, description, location, googleEventId, calendarId = 'primary', estimated_time, priority, reminders } = body;

    if (!googleEventId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'googleEventId is required'
          }
        },
        { status: 400 }
      );
    }

    // Google Calendar イベントを更新
    console.log('[events/update] Updating Google Calendar event:', googleEventId);
    const { calendar } = await getCalendarClient(user.id);

    const googleEvent: Record<string, unknown> = {
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: {
        dateTime: new Date(start_time).toISOString(),
        timeZone: 'Asia/Tokyo',
      },
      end: {
        dateTime: new Date(end_time).toISOString(),
        timeZone: 'Asia/Tokyo',
      },
    };

    // リマインダー設定をGoogle Calendarに送信
    if (reminders !== undefined) {
      if (Array.isArray(reminders) && reminders.length > 0) {
        googleEvent.reminders = {
          useDefault: false,
          overrides: reminders.map((minutes: number) => ({ method: 'popup', minutes })),
        };
      } else {
        googleEvent.reminders = { useDefault: false, overrides: [] };
      }
    }

    await calendar.events.update({
      calendarId,
      eventId: googleEventId,
      requestBody: googleEvent,
    });

    console.log('[events/update] Updated Google Calendar event');

    // DB も更新
    const { error: dbError } = await supabase
      .from('calendar_events')
      .update({
        title,
        start_time,
        end_time,
        description,
        location,
        updated_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);

    if (dbError) {
      console.error('[events/update] Failed to update database:', dbError);
    } else {
      console.log('[events/update] Updated database');
    }

    // 関連するタスクも更新（google_event_idが一致するタスク）
    const { data: relatedTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);

    let linkedTaskId: string | null = null;

    if (relatedTasks && relatedTasks.length > 0) {
      linkedTaskId = relatedTasks[0].id;
      console.log('[events/update] Found related tasks:', relatedTasks.length, 'taskId:', linkedTaskId);

      // priority 文字列→数値変換
      const priorityMap: Record<string, number> = { high: 3, medium: 2, low: 1 };

      // タスクの全フィールドを更新（タイトル、予定時刻、所要時間、優先度、カレンダーID）
      const taskUpdates: Record<string, unknown> = {
        title,
        scheduled_at: start_time,
        calendar_id: calendarId,
        updated_at: new Date().toISOString()
      };
      if (estimated_time !== undefined && estimated_time !== null) {
        taskUpdates.estimated_time = estimated_time;
      }
      if (priority && priorityMap[priority] !== undefined) {
        taskUpdates.priority = priorityMap[priority];
      }

      const { error: taskUpdateError } = await supabase
        .from('tasks')
        .update(taskUpdates)
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId);

      if (taskUpdateError) {
        console.error('[events/update] Failed to update tasks:', taskUpdateError);
      } else {
        console.log('[events/update] Updated related tasks with:', Object.keys(taskUpdates));
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Event updated successfully',
      task_id: linkedTaskId,
    });

  } catch (error: unknown) {
    console.error('[events/update] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const authError = classifyCalendarAuthError(errorMessage);
    if (authError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: authError.code,
            message: authError.message
          }
        },
        { status: authError.status }
      );
    }

    // その他のエラー
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorMessage || 'Failed to update event'
        }
      },
      { status: 500 }
    );
  }
}
