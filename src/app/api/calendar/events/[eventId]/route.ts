import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getCalendarClient } from '@/lib/google-calendar';
import { classifyCalendarAuthError } from '@/lib/calendar-auth-errors';

function isMissingCalendarEventError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return status === 404 || code === 404;
}

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
 * カレンダーイベントを作成
 * POST /api/calendar/events/[eventId]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const {
      calendarId = 'primary',
      title,
      description,
      location,
      start_time,
      end_time,
      is_all_day = false,
      timezone = 'Asia/Tokyo',
      reminders,
    } = body;

    if (!title || !start_time || !end_time) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'title, start_time and end_time are required' } },
        { status: 400 }
      );
    }

    const { calendar } = await getCalendarClient(user.id);
    const googleEvent: Record<string, unknown> = {
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: {
        dateTime: new Date(start_time).toISOString(),
        timeZone: timezone,
      },
      end: {
        dateTime: new Date(end_time).toISOString(),
        timeZone: timezone,
      },
    };

    if (reminders !== undefined) {
      googleEvent.reminders = Array.isArray(reminders) && reminders.length > 0
        ? {
            useDefault: false,
            overrides: reminders.map((minutes: number) => ({ method: 'popup', minutes })),
          }
        : { useDefault: false, overrides: [] };
    }

    const created = await calendar.events.insert({
      calendarId,
      requestBody: googleEvent,
    });
    const googleEventId = created.data.id;
    if (!googleEventId) {
      throw new Error('Google Calendar did not return an event id');
    }

    const eventPayload: Record<string, unknown> = {
      user_id: user.id,
      google_event_id: googleEventId,
      calendar_id: calendarId,
      title,
      description: description || null,
      location: location || null,
      start_time,
      end_time,
      is_all_day,
      timezone,
      recurrence: body.recurrence || null,
      recurring_event_id: body.recurring_event_id || null,
      color: body.color || null,
      background_color: body.background_color || null,
      google_created_at: created.data.created || new Date().toISOString(),
      google_updated_at: created.data.updated || new Date().toISOString(),
      synced_at: new Date().toISOString(),
      reminders: Array.isArray(reminders) ? reminders : null,
      is_completed: body.is_completed ?? false,
    };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
      eventPayload.id = eventId;
    }

    const { data: event, error: dbError } = await supabase
      .from('calendar_events')
      .upsert(eventPayload)
      .select()
      .single();

    if (dbError) {
      try {
        await calendar.events.delete({ calendarId, eventId: googleEventId });
      } catch (cleanupError) {
        console.error('[events/create] Cleanup deletion failed:', cleanupError);
      }
      throw dbError;
    }

    return NextResponse.json({
      success: true,
      event,
      googleEventId,
    });
  } catch (error: unknown) {
    console.error('[events/create] Error:', error);
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

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorMessage || 'Failed to create event'
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
  let deleteScope = searchParams.get('deleteScope') === 'series' ? 'series' : 'this';
  let recurringEventId = searchParams.get('recurringEventId');

  // If not in query params, try request body
  if (!googleEventId || !searchParams.has('deleteScope') || !recurringEventId) {
    try {
      const body = await request.json();
      googleEventId = googleEventId || body.googleEventId;
      calendarId = body.calendarId || calendarId || 'primary';
      deleteScope = body.deleteScope === 'series' ? 'series' : deleteScope;
      recurringEventId = recurringEventId || body.recurringEventId;
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
    const targetGoogleEventId = deleteScope === 'series' && recurringEventId
      ? recurringEventId
      : googleEventId;

    const { data: targetCalendar, error: calendarLookupError } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, access_level')
      .eq('user_id', user.id)
      .eq('google_calendar_id', calendarId)
      .maybeSingle();
    if (calendarLookupError) throw calendarLookupError;

    if (targetCalendar && !['owner', 'writer'].includes(targetCalendar.access_level || '')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'READ_ONLY_CALENDAR',
            message: 'このカレンダーは閲覧専用のため削除できません'
          }
        },
        { status: 403 }
      );
    }

    // Google Calendar からイベントを削除
    console.log('[events/delete] Deleting from Google Calendar:', targetGoogleEventId, 'from calendar:', calendarId);
    const { calendar } = await getCalendarClient(user.id);

    let deletedFromGoogle = false;
    try {
      await calendar.events.delete({
        calendarId,
        eventId: targetGoogleEventId,
      });
      deletedFromGoogle = true;
      console.log('[events/delete] Deleted from Google Calendar');
    } catch (error) {
      if (!isMissingCalendarEventError(error)) throw error;
      console.log('[events/delete] Event already missing on Google Calendar, cleaning local state');
    }

    // DB からも削除
    let dbDeleteQuery = supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('calendar_id', calendarId);

    dbDeleteQuery = deleteScope === 'series'
      ? dbDeleteQuery.or(`google_event_id.eq.${targetGoogleEventId},recurring_event_id.eq.${targetGoogleEventId}`)
      : dbDeleteQuery.eq('google_event_id', googleEventId);

    const { error: dbError } = await dbDeleteQuery;

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
      .eq('calendar_id', calendarId)
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

    // 連動: 同じ google_event_id を持つメモ（ideal_goals）の予定状態をリセット。
    // 「今日する」から「未予定」に戻し、開始時刻をクリア。所要時間は保持。
    const { error: memoResetError } = await supabase
      .from('ideal_goals')
      .update({
        scheduled_at: null,
        google_event_id: null,
        memo_status: 'unsorted',
        is_today: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);
    if (memoResetError) {
      console.error('[events/delete] Failed to reset linked memo:', memoResetError);
    }

    return NextResponse.json({
      success: true,
      message: deletedFromGoogle
        ? 'Event deleted successfully'
        : 'Event was already missing on Google Calendar; local state cleaned',
      notFoundOnGoogle: !deletedFromGoogle
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

    // メモ（WishlistView）は ideal_goals に保存されているため、同じ Google Event ID で予定情報を同期する
    const computedDurationMinutes = Math.max(
      1,
      Math.round((new Date(end_time).getTime() - new Date(start_time).getTime()) / 60000)
    );
    const memoUpdates: Record<string, unknown> = {
      title,
      scheduled_at: start_time,
      duration_minutes: estimated_time ?? computedDurationMinutes,
      memo_status: 'scheduled',
      updated_at: new Date().toISOString(),
    };
    if (description !== undefined) {
      memoUpdates.description = description || null;
    }

    try {
      const { error: memoUpdateError } = await supabase
        .from('ideal_goals')
        .update(memoUpdates)
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId);

      if (memoUpdateError) {
        console.error('[events/update] Failed to update linked memo:', memoUpdateError);
      }
    } catch (memoUpdateError) {
      console.error('[events/update] Failed to update linked memo:', memoUpdateError);
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
