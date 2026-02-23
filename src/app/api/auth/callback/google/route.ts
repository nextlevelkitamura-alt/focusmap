import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import { decodeCalendarOAuthState, resolveGoogleRedirectUriFromRequest } from '@/lib/google-oauth';

/**
 * Google OAuth認証後のコールバック
 * GET /api/calendar/callback?code=xxx&state=user_id
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=missing_params', request.url)
    );
  }

  const { userId: stateUserId, next: nextPath } = decodeCalendarOAuthState(state);

  const supabase = await createClient();

  // ユーザーIDを検証
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user || user.id !== stateUserId) {
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=unauthorized', request.url)
    );
  }

  try {
    const redirectUri = resolveGoogleRedirectUriFromRequest(request);

    // OAuth2クライアントを作成
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // 認証コードをトークンに交換
    const { tokens } = await oauth2Client.getToken(code);

    console.log('[Google Auth Callback] Tokens received:', {
      access_token: tokens.access_token ? 'Present' : 'Missing',
      refresh_token: tokens.refresh_token ? 'Present' : 'Missing',
      expiry_date: tokens.expiry_date
    });

    if (!tokens.access_token) {
      console.error('[Google Auth Callback] Missing access_token:', tokens);
      throw new Error('Failed to get access token');
    }

    // トークンの有効期限を計算
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // デフォルト1時間

    // 更新データを作成
    const upsertData: any = {
      user_id: user.id,
      google_access_token: tokens.access_token,
      google_token_expires_at: expiresAt.toISOString(),
      is_sync_enabled: true,
      sync_status: 'idle',
    };

    // refresh_tokenがあれば更新（なければ既存を維持したいが、prompt: consentなら必ずあるはず）
    if (tokens.refresh_token) {
      upsertData.google_refresh_token = tokens.refresh_token;
    } else {
      console.warn('[Google Auth Callback] No refresh_token received. User might not have been prompted for consent.');
    }

    // Supabaseにトークンを保存
    const { error: upsertError } = await supabase
      .from('user_calendar_settings')
      .upsert(
        upsertData,
        {
          onConflict: 'user_id',
        }
      );

    if (upsertError) {
      console.error('Failed to save tokens:', upsertError);
      throw upsertError;
    }

    // ダッシュボードにリダイレクト（成功）
    const successUrl = new URL(nextPath || '/dashboard', request.url);
    successUrl.searchParams.set('calendar_connected', 'true');
    return NextResponse.redirect(
      successUrl
    );
  } catch (error: any) {
    console.error('Calendar callback error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?calendar_error=${encodeURIComponent(error.message)}`, request.url)
    );
  }
}
