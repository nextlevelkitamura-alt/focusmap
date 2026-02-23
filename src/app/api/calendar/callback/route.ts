import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import { decodeCalendarOAuthState, resolveGoogleRedirectUriFromRequest, resolveOriginFromRequest } from '@/lib/google-oauth';

/**
 * Google OAuth認証後のコールバック
 * GET /api/calendar/callback?code=xxx&state=user_id
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const origin = resolveOriginFromRequest(request);

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=missing_params', origin)
    );
  }

  const supabase = await createClient();

  const { userId: stateUserId, next: nextPath } = decodeCalendarOAuthState(state);

  // ユーザーIDを検証
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user || user.id !== stateUserId) {
    console.error('[Calendar Callback] Auth failed:', {
      authError: authError?.message || null,
      hasUser: !!user,
      userId: user?.id || 'none',
      stateParam: stateUserId,
      match: user?.id === stateUserId,
    });
    const reason = authError ? 'auth_error' : !user ? 'no_session' : 'user_mismatch';
    return NextResponse.redirect(
      new URL(`/dashboard?calendar_error=unauthorized&reason=${reason}`, origin)
    );
  }

  try {
    const redirectUri = resolveGoogleRedirectUriFromRequest(request);

    // OAuth2クライアントを作成
    console.log('[Calendar Callback] OAuth2 config:', {
      client_id: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing',
      redirect_uri: redirectUri
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // 認証コードをトークンに交換
    console.log('[Calendar Callback] Exchanging code for tokens. Code length:', code?.length);
    const { tokens } = await oauth2Client.getToken(code);

    console.log('[Calendar Callback] Tokens received:', {
      access_token: tokens.access_token ? 'Present' : 'Missing',
      refresh_token: tokens.refresh_token ? 'Present' : 'Missing',
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
      scope: tokens.scope
    });

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('[Calendar Callback] Missing tokens:', tokens);
      throw new Error('Failed to get tokens');
    }

    // トークンの有効期限を計算
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // デフォルト1時間

    // Supabaseにトークンを保存
    console.log('[Calendar Callback] Saving tokens to database for user:', user.id);
    const { data: upsertData, error: upsertError } = await supabase
      .from('user_calendar_settings')
      .upsert(
        {
          user_id: user.id,
          google_access_token: tokens.access_token,
          google_refresh_token: tokens.refresh_token,
          google_token_expires_at: expiresAt.toISOString(),
          is_sync_enabled: true,
          sync_status: 'idle',
        },
        {
          onConflict: 'user_id',
        }
      )
      .select();

    if (upsertError) {
      console.error('[Calendar Callback] Failed to save tokens:', upsertError);
      throw upsertError;
    }

    console.log('[Calendar Callback] Tokens saved successfully:', {
      userId: user.id,
      dataReturned: !!upsertData,
      recordCount: upsertData?.length || 0
    });

    // 保存されたデータを確認
    const { data: verifyData, error: verifyError } = await supabase
      .from('user_calendar_settings')
      .select('google_access_token, google_refresh_token, google_token_expires_at')
      .eq('user_id', user.id)
      .single();

    console.log('[Calendar Callback] Verification check:', {
      verifyError: verifyError?.message || null,
      hasAccessToken: !!verifyData?.google_access_token,
      hasRefreshToken: !!verifyData?.google_refresh_token,
      expiresAt: verifyData?.google_token_expires_at
    });

    // ダッシュボードにリダイレクト（成功）
    const successUrl = new URL(nextPath || '/dashboard', origin);
    successUrl.searchParams.set('calendar_connected', 'true');
    return NextResponse.redirect(successUrl);
  } catch (error: any) {
    console.error('Calendar callback error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?calendar_error=${encodeURIComponent(error.message)}`, origin)
    );
  }
}
