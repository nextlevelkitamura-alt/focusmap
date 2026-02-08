import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * カレンダー連携状態を取得
 * GET /api/calendar/status
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // カレンダー設定を取得（トークン情報も含む）
    const { data: settings, error } = await supabase
      .from('user_calendar_settings')
      .select('is_sync_enabled, sync_status, last_synced_at, sync_direction, default_calendar_id, google_access_token, google_refresh_token, google_token_expires_at')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      throw error;
    }

    // トークンの有無を確認
    const hasTokens = !!(settings?.google_access_token && settings?.google_refresh_token);

    // トークンの有効期限を確認
    let tokenExpired = false;
    if (settings?.google_token_expires_at) {
      const expiresAt = new Date(settings.google_token_expires_at);
      tokenExpired = expiresAt < new Date();
    }

    // デバッグログ
    console.log('[Calendar Status] User:', user.id, {
      settingsExists: !!settings,
      hasAccessToken: !!settings?.google_access_token,
      hasRefreshToken: !!settings?.google_refresh_token,
      tokenExpired,
      expiresAt: settings?.google_token_expires_at
    });

    return NextResponse.json({
      isConnected: !!settings && hasTokens,
      isSyncEnabled: settings?.is_sync_enabled || false,
      syncStatus: settings?.sync_status || 'idle',
      lastSyncedAt: settings?.last_synced_at || null,
      syncDirection: settings?.sync_direction || 'bidirectional',
      defaultCalendarId: settings?.default_calendar_id || 'primary',
      hasTokens,
      tokenExpired,
      tokenExpiresAt: settings?.google_token_expires_at || null,
      // デバッグ情報
      debug: {
        settingsFound: !!settings,
        hasAccessToken: !!settings?.google_access_token,
        hasRefreshToken: !!settings?.google_refresh_token,
      }
    });
  } catch (error: any) {
    console.error('Get calendar status error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get calendar status' },
      { status: 500 }
    );
  }
}
