import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { fetchCalendarEvents, fetchMultipleCalendarEvents, getCalendarClient } from '@/lib/google-calendar';

/**
 * Googleカレンダーからイベントを取得
 * GET /api/calendar/events/list?timeMin=xxx&timeMax=xxx&calendarId=xxx,xxx&forceSync=true
 *
 * calendarId: カンマ区切りで複数のカレンダーIDを指定可能
 */
export async function GET(request: NextRequest) {
  console.log('[events/list] API called');
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[events/list] Unauthorized');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  console.log('[events/list] User authenticated:', user.id);

  // クエリパラメータの取得
  const searchParams = request.nextUrl.searchParams;
  const timeMinStr = searchParams.get('timeMin');
  const timeMaxStr = searchParams.get('timeMax');
  const calendarIdParam = searchParams.get('calendarId');
  const forceSync = searchParams.get('forceSync') === 'true';

  // 複数のカレンダーIDをパース
  const calendarIds = calendarIdParam
    ? calendarIdParam.split(',').map(id => id.trim()).filter(id => id.length > 0)
    : undefined;

  // バリデーション
  if (!timeMinStr || !timeMaxStr) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'timeMin and timeMax are required'
        }
      },
      { status: 400 }
    );
  }

  const timeMin = new Date(timeMinStr);
  const timeMax = new Date(timeMaxStr);

  if (isNaN(timeMin.getTime()) || isNaN(timeMax.getTime())) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid date format for timeMin or timeMax'
        }
      },
      { status: 400 }
    );
  }

  try {
    // 常に Google Calendar API から最新のイベントを取得（キャッシュチェックを削除）
    // Google カレンダーを正確性のソースとして扱う
    let googleEvents;
    if (calendarIds && calendarIds.length > 0) {
      // 複数カレンダーから並列取得
      googleEvents = await fetchMultipleCalendarEvents(user.id, calendarIds, {
        timeMin,
        timeMax,
      });
    } else {
      // 単一カレンダー（デフォルトはprimary）
      googleEvents = await fetchCalendarEvents(user.id, {
        calendarId: undefined,
        timeMin,
        timeMax,
      });
    }

    // カレンダーの色情報を取得
    const { data: userCalendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, background_color')
      .eq('user_id', user.id);

    // カレンダーIDから色へのマップを作成
    const calendarColorMap = new Map<string, string>();
    userCalendars?.forEach(cal => {
      if (cal.background_color) {
        calendarColorMap.set(cal.google_calendar_id, cal.background_color);
      }
    });

    console.log('[events/list] Calendar color map:', Object.fromEntries(calendarColorMap));
    console.log('[events/list] Google Calendar API events:', googleEvents.length);

    // Google Calendar API のイベントに id を付与し、重複を排除
    // 複数カレンダーから同じイベント（同じ google_event_id）が返される場合があるため
    const seenGoogleEventIds = new Set<string>();
    const googleEventsWithId = googleEvents
      .map(event => ({
        ...event,
        id: event.google_event_id // google_event_id を id として使用
      }))
      .filter(event => {
        if (seenGoogleEventIds.has(event.google_event_id)) {
          return false; // 重複を排除
        }
        seenGoogleEventIds.add(event.google_event_id);
        return true;
      });

    // Google Calendar API のイベントを Set に格納（重複チェック用）
    const googleEventIds = seenGoogleEventIds;

    // DB からすべてのイベントを取得（google_event_id の有無に関わらず）
    let allDbEventsQuery = supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_time', timeMin.toISOString())
      .lte('end_time', timeMax.toISOString());

    // カレンダーIDでフィルタ（指定がある場合）
    if (calendarIds && calendarIds.length > 0) {
      allDbEventsQuery = allDbEventsQuery.in('calendar_id', calendarIds);
    }

    const { data: allDbEvents } = await allDbEventsQuery;

    console.log('[events/list] All DB events:', allDbEvents?.length || 0);

    // Google Calendar API に存在しない DB イベントを抽出
    // google_event_id 付きで Google に存在しない = 削除済み孤児 → 除外
    // google_event_id なし = ローカル限定イベント → 表示
    const localOnlyEvents = (allDbEvents || []).filter(event => {
      if (!event.google_event_id) {
        return true; // ローカル限定イベント（Google連携なし）
      }
      return false; // google_event_id付きはGoogle APIの結果のみを信頼
    });

    // 孤児イベントを非同期でDBからクリーンアップ（Google Calendarに存在しないDB行）
    const orphanGoogleEventIds = (allDbEvents || [])
      .filter(e => e.google_event_id && !googleEventIds.has(e.google_event_id))
      .map(e => e.google_event_id);
    if (orphanGoogleEventIds.length > 0) {
      console.log('[events/list] Cleaning up orphan DB events:', orphanGoogleEventIds.length);
      const { error: orphanDelErr } = await supabase
        .from('calendar_events')
        .delete()
        .eq('user_id', user.id)
        .in('google_event_id', orphanGoogleEventIds);
      if (orphanDelErr) {
        console.error('[events/list] Orphan cleanup failed:', orphanDelErr);
      }

      // Google Calendarに存在しないイベントに対応するタスクもsoft-delete + タイマーリセット
      const { error: taskOrphanErr } = await supabase
        .from('tasks')
        .update({
          deleted_at: new Date().toISOString(),
          is_timer_running: false,
          last_started_at: null,
        })
        .eq('user_id', user.id)
        .eq('source', 'google_event')
        .is('deleted_at', null)
        .in('google_event_id', orphanGoogleEventIds);
      if (taskOrphanErr) {
        console.error('[events/list] Orphan task cleanup failed:', taskOrphanErr);
      } else {
        console.log('[events/list] Soft-deleted orphan tasks for', orphanGoogleEventIds.length, 'google events');
      }

      // 孤児イベントの完了記録もクリーンアップ
      const { error: completionErr } = await supabase
        .from('event_completions')
        .delete()
        .eq('user_id', user.id)
        .in('google_event_id', orphanGoogleEventIds);
      if (completionErr) {
        console.error('[events/list] Orphan event_completions cleanup failed:', completionErr);
      }
    }

    console.log('[events/list] Local-only events (no google_event_id):', localOnlyEvents.length);

    // タスクテーブルから google_event_id に対応するタスクIDを取得
    const eventIdsToCheck = [
      ...googleEventsWithId.map(e => e.google_event_id),
      ...localOnlyEvents.map(e => e.google_event_id).filter(Boolean)
    ];

    // priority 数値→文字列変換ヘルパー
    function numericPriorityToString(p: number | null | undefined): 'high' | 'medium' | 'low' | undefined {
      if (p === null || p === undefined) return undefined;
      if (p >= 3) return 'high';
      if (p >= 2) return 'medium';
      return 'low';
    }

    let taskMap = new Map<string, { id: string; priority: number | null; estimated_time: number | null }>();
    if (eventIdsToCheck.length > 0) {
      const { data: tasksWithEvents } = await supabase
        .from('tasks')
        .select('id, google_event_id, priority, estimated_time')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .in('google_event_id', eventIdsToCheck)
        .not('google_event_id', 'is', null);

      if (tasksWithEvents) {
        tasksWithEvents.forEach(task => {
          if (task.google_event_id) {
            taskMap.set(task.google_event_id, {
              id: task.id,
              priority: task.priority,
              estimated_time: task.estimated_time
            });
          }
        });
      }
      console.log('[events/list] Task map size:', taskMap.size);
    }

    // Google Calendar API のイベントとローカルのみのイベントをマージ（task_id, priority, estimated_time を追加）
    const allEvents = [
      ...googleEventsWithId.map(event => {
        const taskInfo = taskMap.get(event.google_event_id);
        return {
          ...event,
          task_id: taskInfo?.id,
          priority: numericPriorityToString(taskInfo?.priority),
          estimated_time: taskInfo?.estimated_time ?? undefined,
        };
      }),
      ...localOnlyEvents.map(event => {
        const taskInfo = event.google_event_id ? taskMap.get(event.google_event_id) : undefined;
        return {
          ...event,
          task_id: taskInfo?.id,
          priority: numericPriorityToString(taskInfo?.priority),
          estimated_time: taskInfo?.estimated_time ?? undefined,
        };
      })
    ];

    // 色マッピングを追加
    const eventsWithColor = allEvents.map(event => {
      const mappedColor = calendarColorMap.get(event.calendar_id);
      const finalColor = mappedColor || event.background_color || '#039BE5';

      // 色マッピングが見つからないイベントをログ
      if (!mappedColor && !event.background_color) {
        console.log('[events/list] No color found for event:', {
          eventId: event.google_event_id,
          calendarId: event.calendar_id,
          title: event.title
        });
      }

      return {
        ...event,
        background_color: finalColor
      };
    });

    console.log('[events/list] Events with color:', {
      total: eventsWithColor.length,
      fromGoogle: googleEvents.length,
      fromLocal: localOnlyEvents.length,
      withMappedColor: eventsWithColor.filter(e => calendarColorMap.has(e.calendar_id)).length,
      withOwnColor: eventsWithColor.filter(e => e.background_color && e.background_color !== '#039BE5').length,
      withDefaultColor: eventsWithColor.filter(e => e.background_color === '#039BE5').length
    });

    // DBに非同期で保存（エラーがあっても返却をブロックしない）
    const now = new Date().toISOString();
    const eventsWithSyncTime = googleEventsWithId.map(event => ({
      ...event,
      synced_at: now
    }));

    // DBに保存（エラーがあってもレスポンスはブロックしないが、awaitでDB整合性を確保）
    if (eventsWithSyncTime.length > 0) {
      const { error: upsertErr } = await supabase
        .from('calendar_events')
        .upsert(eventsWithSyncTime, {
          onConflict: 'user_id,google_event_id',
          ignoreDuplicates: false
        });
      if (upsertErr) {
        console.error('[events/list] Failed to upsert calendar events:', upsertErr);
      } else {
        console.log('[events/list] Successfully upserted', eventsWithSyncTime.length, 'events to database');
      }
    }

    return NextResponse.json({
      success: true,
      events: eventsWithColor,
      syncedAt: now,
      fromCache: false
    });

  } catch (error: any) {
    console.error('Calendar events list error:', error);

    // トークン期限切れの場合、手動リフレッシュを試みる
    if (error.message.includes('invalid_grant') || error.message.includes('Token')) {
      try {
        console.log('[events/list] Token expired, attempting manual refresh...');
        const { oauth2Client } = await getCalendarClient(user.id);
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (credentials.access_token) {
          console.log('[events/list] Token refreshed successfully, retrying...');
          // tokens イベントハンドラでDBに保存される
          // クライアントにリトライを促す
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'TOKEN_REFRESHED',
                message: 'Token was refreshed. Please retry the request.'
              }
            },
            { status: 503 }
          );
        }
      } catch (refreshError) {
        console.error('[events/list] Token refresh failed:', refreshError);
      }

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
          message: error.message || 'Failed to fetch calendar events'
        }
      },
      { status: 500 }
    );
  }
}
