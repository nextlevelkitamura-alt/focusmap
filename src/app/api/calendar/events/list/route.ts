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
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

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
    // forceSync=false の場合、キャッシュをチェック
    if (!forceSync) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const { data: cachedEvents, error: cacheError } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('user_id', user.id)
        .gte('start_time', timeMin.toISOString())
        .lte('end_time', timeMax.toISOString())
        .gte('synced_at', fiveMinutesAgo.toISOString());

      // キャッシュが新しい場合はそれを返す
      if (!cacheError && cachedEvents && cachedEvents.length > 0) {
        // 最新のsynced_atを取得
        const latestSyncedAt = cachedEvents.reduce((latest, event) => {
          const eventSyncedAt = new Date(event.synced_at);
          return eventSyncedAt > latest ? eventSyncedAt : latest;
        }, new Date(0));

        return NextResponse.json({
          success: true,
          events: cachedEvents,
          syncedAt: latestSyncedAt.toISOString(),
          fromCache: true
        });
      }
    }

    // Google Calendar APIからイベントを取得
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

    // DBにupsert（google_event_idで重複チェック）
    const now = new Date().toISOString();
    const eventsWithSyncTime = googleEvents.map(event => ({
      ...event,
      synced_at: now
    }));

    if (eventsWithSyncTime.length > 0) {
      const { error: upsertError } = await supabase
        .from('calendar_events')
        .upsert(eventsWithSyncTime, {
          onConflict: 'user_id,google_event_id',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error('Failed to upsert calendar events:', upsertError);
        throw new Error(`Failed to save events to database: ${upsertError.message}`);
      }
    }

    // DBから最新データを取得
    const { data: events, error: fetchError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_time', timeMin.toISOString())
      .lte('end_time', timeMax.toISOString())
      .order('start_time', { ascending: true });

    if (fetchError) {
      console.error('Failed to fetch events from database:', fetchError);
      throw new Error(`Failed to fetch events from database: ${fetchError.message}`);
    }

    return NextResponse.json({
      success: true,
      events: events || [],
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
