import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getCalendarClient } from '@/lib/google-calendar';

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
      .select('id')
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);

    if (relatedTasks && relatedTasks.length > 0) {
      console.log('[events/delete] Found related tasks:', relatedTasks.length);

      const { error: taskUpdateError } = await supabase
        .from('tasks')
        .update({
          google_event_id: null,
          calendar_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('google_event_id', googleEventId);

      if (taskUpdateError) {
        console.error('[events/delete] Failed to update tasks:', taskUpdateError);
      } else {
        console.log('[events/delete] Cleared google_event_id from tasks');
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error: any) {
    console.error('[events/delete] Error:', error);

    // トークン期限切れのエラー
    if (error.message.includes('invalid_grant') || error.message.includes('Token')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Calendar access token expired. Please reconnect.'
          }
        },
        { status: 401 }
      );
    }

    // その他のエラー
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to delete event'
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
    const { title, start_time, end_time, description, location, googleEventId, calendarId = 'primary', estimated_time, priority } = body;

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

    const googleEvent = {
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
      const taskUpdates: Record<string, any> = {
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

  } catch (error: any) {
    console.error('[events/update] Error:', error);

    // トークン期限切れのエラー
    if (error.message.includes('invalid_grant') || error.message.includes('Token')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Calendar access token expired. Please reconnect.'
          }
        },
        { status: 401 }
      );
    }

    // その他のエラー
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to update event'
        }
      },
      { status: 500 }
    );
  }
}
