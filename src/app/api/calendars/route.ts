import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { fetchUserCalendars } from '@/lib/google-calendar';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * ユーザーの全カレンダーを取得
 * GET /api/calendars
 *
 * Query Parameters:
 *   forceSync?: boolean - trueの場合、Google APIから再取得
 *
 * Response:
 *   {
 *     success: true,
 *     calendars: [...],
 *     syncedAt: string
 *   }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const forceSync = searchParams.get('forceSync') === 'true';

    // Google Calendar APIからカレンダーを取得
    let googleCalendars;
    try {
      console.log('[calendars] Fetching calendars from Google API:', { userId: user.id, forceSync });
      googleCalendars = await fetchUserCalendars(user.id);
      console.log('[calendars] Fetched calendars from Google API:', {
        count: googleCalendars.length,
        calendars: googleCalendars.map(c => ({ name: c.name, id: c.googleCalendarId, primary: c.primary }))
      });
    } catch (error: unknown) {
      console.error('[calendars] Failed to fetch from Google API:', error);

      // Google APIエラーの場合、キャッシュから返す
      const { data: cachedCalendars } = await supabase
        .from('user_calendars')
        .select('*')
        .eq('user_id', user.id);

      if (!cachedCalendars || cachedCalendars.length === 0) {
        throw error; // キャッシュもない場合はエラーを返す
      }

      return NextResponse.json({
        success: true,
        calendars: cachedCalendars,
        syncedAt: new Date().toISOString(),
        fromCache: true
      });
    }

    // データベースと同期
    console.log('[calendars] Syncing calendars to database...');
    const syncedCalendars = [];
    const liveGoogleCalendarIds = new Set(googleCalendars.map(cal => cal.googleCalendarId));

    for (const googleCal of googleCalendars) {
      const { data: existing, error } = await supabase
        .from('user_calendars')
        .select('*')
        .eq('user_id', user.id)
        .eq('google_calendar_id', googleCal.googleCalendarId)
        .single();

      if (error && error.code === 'PGRST116') {
        // 新規カレンダーを作成
        console.log('[calendars] Inserting new calendar:', googleCal.name);
        const { data: newCal, error: insertError } = await supabase
          .from('user_calendars')
          .insert({
            user_id: user.id,
            google_calendar_id: googleCal.googleCalendarId,
            name: googleCal.name,
            description: googleCal.description,
            location: googleCal.location,
            timezone: googleCal.timezone,
            color: googleCal.color,
            background_color: googleCal.backgroundColor,
            access_level: googleCal.accessLevel,
            is_primary: googleCal.primary,
            google_created_at: googleCal.googleCreatedAt,
            google_updated_at: googleCal.googleUpdatedAt,
            synced_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) {
          console.error('[calendars] Insert error:', insertError);
          throw insertError;
        }
        syncedCalendars.push(newCal);
      } else if (existing) {
        // 既存カレンダーを更新
        console.log('[calendars] Updating existing calendar:', googleCal.name);
        const { data: updatedCal, error: updateError } = await supabase
          .from('user_calendars')
          .update({
            name: googleCal.name,
            description: googleCal.description,
            location: googleCal.location,
            timezone: googleCal.timezone,
            color: googleCal.color,
            background_color: googleCal.backgroundColor,
            access_level: googleCal.accessLevel,
            is_primary: googleCal.primary,
            google_updated_at: googleCal.googleUpdatedAt,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError) {
          console.error('[calendars] Update error:', updateError);
          throw updateError;
        }
        syncedCalendars.push(updatedCal);
      } else if (error) {
        // その他のエラー
        console.error('[calendars] Database query error:', error);
        throw error;
      }
    }
    console.log('[calendars] Synced', syncedCalendars.length, 'calendars to database');

    // 選択状態を維持して返す（既存の設定を尊重）
    const { data: allCalendars, error: selectError } = await supabase
      .from('user_calendars')
      .select('*')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })
      .order('name');

    if (selectError) {
      console.error('[calendars] Failed to select from database:', selectError);
      throw new Error(`Failed to fetch calendars from database: ${selectError.message}`);
    }

    const staleCalendars = (allCalendars || []).filter(cal => !liveGoogleCalendarIds.has(cal.google_calendar_id));
    if (staleCalendars.length > 0) {
      console.log('[calendars] Marking stale calendars as unselected:', staleCalendars.map(cal => cal.google_calendar_id));
      const staleUpdateResults = await Promise.all(
        staleCalendars.map(cal =>
          supabase
            .from('user_calendars')
            .update({
              selected: false,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id)
            .eq('id', cal.id)
        )
      );
      const staleUpdateError = staleUpdateResults.find(result => result.error)?.error;
      if (staleUpdateError) {
        console.error('[calendars] Failed to mark stale calendars:', staleUpdateError);
      }
    }

    const liveCalendars = (allCalendars || []).filter(cal => liveGoogleCalendarIds.has(cal.google_calendar_id));

    console.log('[calendars] Returning calendars:', {
      count: liveCalendars.length,
      staleCount: staleCalendars.length,
      calendars: liveCalendars.map(c => ({ name: c.name, id: c.google_calendar_id, selected: c.selected, primary: c.is_primary }))
    });

    return NextResponse.json({
      success: true,
      calendars: liveCalendars,
      syncedAt: new Date().toISOString(),
      removedCalendarIds: staleCalendars.map(cal => cal.google_calendar_id)
    });
  } catch (error: unknown) {
    console.error('[calendars] Error:', error);
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to fetch calendars') },
      { status: 500 }
    );
  }
}
