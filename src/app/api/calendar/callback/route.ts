import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import {
  consumeDesktopCalendarOAuthSession,
  decodeCalendarOAuthState,
  resolveGoogleRedirectUriFromRequest,
  resolveOriginFromRequest,
} from '@/lib/google-oauth';

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA';

function createUserAccessTokenClient(accessToken: string): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function desktopOAuthDonePage(nextPath: string) {
  const deepLink = new URL('focusmap://calendar-connected');
  deepLink.searchParams.set('next', nextPath || '/dashboard');
  const safeDeepLink = escapeHtmlAttribute(deepLink.toString());
  const scriptDeepLink = JSON.stringify(deepLink.toString());

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google連携完了</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050505; color: #f4f4f5; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(460px, calc(100vw - 32px)); border: 1px solid #282828; border-radius: 12px; background: #0d0d0f; padding: 22px; }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0; color: #a1a1aa; }
    </style>
  </head>
  <body>
    <main>
      <h1>Google Calendar を連携しました</h1>
      <p>Focusmapアプリへ戻っています。</p>
      <a href="${safeDeepLink}">アプリへ戻る</a>
    </main>
    <script>
      setTimeout(() => { window.location.href = ${scriptDeepLink}; }, 300);
      setTimeout(() => window.close(), 1600);
    </script>
  </body>
</html>`;
}

function appOAuthDonePage(nextPath: string) {
  const deepLink = new URL('focusmap://calendar-connected');
  deepLink.searchParams.set('next', nextPath || '/dashboard');
  const safeDeepLink = deepLink.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const scriptDeepLink = JSON.stringify(deepLink.toString());

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google連携完了</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050505; color: #f4f4f5; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(460px, calc(100vw - 32px)); border: 1px solid #282828; border-radius: 12px; background: #0d0d0f; padding: 22px; }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0 0 14px; color: #a1a1aa; }
      a { color: #34d399; }
    </style>
  </head>
  <body>
    <main>
      <h1>Google Calendar を連携しました</h1>
      <p>Focusmapアプリへ戻っています。</p>
      <a href="${safeDeepLink}">アプリへ戻る</a>
    </main>
    <script>
      setTimeout(() => { window.location.href = ${scriptDeepLink}; }, 300);
    </script>
  </body>
</html>`;
}

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

  const { userId: stateUserId, next: nextPath, desktop, app } = decodeCalendarOAuthState(state);

  // ユーザーIDを検証
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  let activeUserId = user?.id || null;
  let writeClient: SupabaseClient = supabase;
  let desktopCallback = false;

  if (authError || !user || user.id !== stateUserId) {
    const desktopSession = desktop || app ? consumeDesktopCalendarOAuthSession(state) : null;
    if (desktopSession?.userId === stateUserId) {
      activeUserId = desktopSession.userId;
      writeClient = createUserAccessTokenClient(desktopSession.accessToken);
      desktopCallback = true;
    }
  }

  if (!activeUserId || activeUserId !== stateUserId) {
    console.error('[Calendar Callback] Auth failed:', {
      authError: authError?.message || null,
      hasUser: !!user,
      userId: user?.id || 'none',
      stateParam: stateUserId,
      match: user?.id === stateUserId,
      desktop,
      app,
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

    oauth2Client.setCredentials(tokens);

    let googleAccountName: string | null = null;
    let googleAccountEmail: string | null = null;
    let googleAccountPicture: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const profile = await oauth2.userinfo.get();
      googleAccountName = profile.data.name || null;
      googleAccountEmail = profile.data.email || null;
      googleAccountPicture = profile.data.picture || null;
    } catch (profileError) {
      console.warn('[Calendar Callback] Failed to fetch Google account profile:', profileError);
    }

    // トークンの有効期限を計算
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // デフォルト1時間

    // Supabaseにトークンを保存
    console.log('[Calendar Callback] Saving tokens to database for user:', activeUserId);
    const { data: upsertData, error: upsertError } = await writeClient
      .from('user_calendar_settings')
      .upsert(
        {
          user_id: activeUserId,
          google_access_token: tokens.access_token,
          google_refresh_token: tokens.refresh_token,
          google_token_expires_at: expiresAt.toISOString(),
          google_account_name: googleAccountName,
          google_account_email: googleAccountEmail,
          google_account_picture: googleAccountPicture,
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
      userId: activeUserId,
      dataReturned: !!upsertData,
      recordCount: upsertData?.length || 0
    });

    // 保存されたデータを確認
    const { data: verifyData, error: verifyError } = await writeClient
      .from('user_calendar_settings')
      .select('google_access_token, google_refresh_token, google_token_expires_at')
      .eq('user_id', activeUserId)
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
    if (app === 'ios') {
      return new NextResponse(appOAuthDonePage(nextPath || '/dashboard'), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    }
    if (desktop || desktopCallback) {
      return new NextResponse(desktopOAuthDonePage(nextPath || '/dashboard'), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    }
    return NextResponse.redirect(successUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calendar callback error:', error);
    return NextResponse.redirect(
      new URL(`/dashboard?calendar_error=${encodeURIComponent(message)}`, origin)
    );
  }
}
