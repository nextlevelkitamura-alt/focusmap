import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { fetchCalendarEvents, fetchMultipleCalendarEvents } from '@/lib/google-calendar';

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

    // Google Calendar API のイベントに id を付与（google_event_id を id として使用）
    const googleEventsWithId = googleEvents.map(event => ({
      ...event,
      id: event.google_event_id // google_event_id を id として使用
    }));

    // Google Calendar API のイベントを Set に格納（重複チェック用）
    const googleEventIds = new Set<string>();
    googleEventsWithId.forEach(event => {
      if (event.google_event_id) {
        googleEventIds.add(event.google_event_id);
      }
    });

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

    // Google Calendar API に存在しない DB のイベントのみを追加
    const localOnlyEvents = (allDbEvents || []).filter(event => {
      // google_event_id がないものはすべてローカルのみ
      if (!event.google_event_id) {
        return true;
      }
      // google_event_id があるが、Google Calendar API に存在しないもの
      return !googleEventIds.has(event.google_event_id);
    });

    console.log('[events/list] Local-only events (not in Google Calendar):', localOnlyEvents.length);

    // Google Calendar API のイベントとローカルのみのイベントをマージ
    const allEvents = [...googleEventsWithId, ...localOnlyEvents];

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

    // 非同期でDBに保存（エラーがあってもログだけ出して続行）
    if (eventsWithSyncTime.length > 0) {
      supabase
        .from('calendar_events')
        .upsert(eventsWithSyncTime, {
          onConflict: 'user_id,google_event_id',
          ignoreDuplicates: false
        })
        .then(({ error }) => {
          if (error) {
            console.error('[events/list] Failed to upsert calendar events (non-blocking):', error);
          } else {
            console.log('[events/list] Successfully upserted', eventsWithSyncTime.length, 'events to database');
          }
        });
    }

    return NextResponse.json({
      success: true,
      events: eventsWithColor,
      syncedAt: now,
      fromCache: false
    });

  } catch (error: any) {
    console.error('Calendar events list error:', error);

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
          message: error.message || 'Failed to fetch calendar events'
        }
      },
      { status: 500 }
    );
  }
}
