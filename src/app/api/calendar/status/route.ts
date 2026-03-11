import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { google } from 'googleapis';
import { resolveGoogleRedirectUriFromEnv } from '@/lib/google-oauth';

/**
 * カレンダー連携状態を取得
 * GET /api/calendar/status
 */
export async function GET() {
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
      .select('is_sync_enabled, sync_status, last_synced_at, sync_direction, default_calendar_id, google_access_token, google_refresh_token, google_token_expires_at, google_account_name, google_account_email, google_account_picture')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      throw error;
    }

    // トークンの有無を確認
    const hasAccessToken = !!settings?.google_access_token;
    const hasRefreshToken = !!settings?.google_refresh_token;
    const hasTokens = hasAccessToken && hasRefreshToken;

    // リフレッシュトークンがない場合は即座に再連携必要
    const needsReconnect = !hasRefreshToken && !!settings;

    // トークンの有効期限を確認
    let tokenExpired = false;
    if (settings?.google_token_expires_at) {
      const expiresAt = new Date(settings.google_token_expires_at);
      tokenExpired = expiresAt < new Date();
    }

    // sync_status が disconnected の場合も再連携必要
    const isDisconnected = settings?.sync_status === 'disconnected';

    let linkedAccount = settings?.google_account_email
      ? {
          name: settings.google_account_name || null,
          email: settings.google_account_email,
          picture: settings.google_account_picture || null,
        }
      : null;

    if (hasTokens && !linkedAccount) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          resolveGoogleRedirectUriFromEnv()
        );

        oauth2Client.setCredentials({
          access_token: settings?.google_access_token || undefined,
          refresh_token: settings?.google_refresh_token || undefined,
          expiry_date: settings?.google_token_expires_at
            ? new Date(settings.google_token_expires_at).getTime()
            : undefined,
        });

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const profile = await oauth2.userinfo.get();
        const name = profile.data.name || null;
        const email = profile.data.email || null;
        const picture = profile.data.picture || null;

        if (email) {
          linkedAccount = { name, email, picture };
          await supabase
            .from('user_calendar_settings')
            .update({
              google_account_name: name,
              google_account_email: email,
              google_account_picture: picture,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);
        }
      } catch (profileError) {
        console.warn('[Calendar Status] Failed to fetch linked account profile:', profileError);
      }
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
      isConnected: !!settings && hasTokens && !isDisconnected,
      isSyncEnabled: settings?.is_sync_enabled || false,
      syncStatus: settings?.sync_status || 'idle',
      lastSyncedAt: settings?.last_synced_at || null,
      syncDirection: settings?.sync_direction || 'bidirectional',
      defaultCalendarId: settings?.default_calendar_id || 'primary',
      hasTokens,
      tokenExpired,
      tokenExpiresAt: settings?.google_token_expires_at || null,
      linkedAccount,
      needsReconnect: needsReconnect || isDisconnected,
      reconnectReason: isDisconnected
        ? 'authorization_expired'
        : needsReconnect
          ? 'missing_refresh_token'
          : tokenExpired
            ? 'token_expired'
            : null,
      // デバッグ情報
      debug: {
        settingsFound: !!settings,
        hasAccessToken,
        hasRefreshToken,
        isDisconnected,
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get calendar status';
    console.error('Get calendar status error:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
