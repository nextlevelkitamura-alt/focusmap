import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';

/**
 * Google OAuth認証後のコールバック
 * GET /api/calendar/callback?code=xxx&state=user_id
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // user_id

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=missing_params', request.url)
    );
  }

  const supabase = await createClient();

  // ユーザーIDを検証
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user || user.id !== state) {
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=unauthorized', request.url)
    );
  }

  try {
    // OAuth2クライアントを作成
    console.log('[Calendar Callback] OAuth2 config:', {
      client_id: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
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
    const { error: upsertError } = await supabase
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
      );

    if (upsertError) {
      console.error('Failed to save tokens:', upsertError);
      throw upsertError;
    }

    // ダッシュボードにリダイレクト（成功）
    return NextResponse.redirect(
      new URL('/dashboard?calendar_connected=true', request.url)
    );
  } catch (error: any) {
    console.error('Calendar callback error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?calendar_error=${encodeURIComponent(error.message)}`, request.url)
    );
  }
}
