import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import {
  encodeCalendarOAuthState,
  registerDesktopCalendarOAuthSession,
  resolveGoogleRedirectUriFromRequest,
  resolveOriginFromRequest,
} from '@/lib/google-oauth';

function htmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function desktopOAuthLaunchPage(authUrl: string) {
  const safeUrl = htmlEscape(authUrl);
  const scriptUrl = JSON.stringify(authUrl);
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google認証を開いています</title>
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
      <h1>Google認証をブラウザで開いています</h1>
      <p>認証が終わったら、このFocusmapアプリに戻ってください。</p>
      <a href="${safeUrl}" target="_blank" rel="noreferrer">ブラウザで開けない場合はこちら</a>
    </main>
    <script>
      const authUrl = ${scriptUrl};
      if (window.focusmapDesktop?.openExternal) {
        window.focusmapDesktop.openExternal(authUrl);
      } else {
        window.location.href = authUrl;
      }
    </script>
  </body>
</html>`;
}

function appOAuthLaunchPage(authUrl: string) {
  const safeUrl = htmlEscape(authUrl);
  const scriptUrl = JSON.stringify(authUrl);
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google認証を開いています</title>
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
      <h1>Google認証をSafariで開いています</h1>
      <p>認証が終わるとFocusmapアプリへ戻ります。</p>
      <a href="${safeUrl}" target="_blank" rel="noreferrer">Safariで開けない場合はこちら</a>
    </main>
    <script>
      const authUrl = ${scriptUrl};
      if (window.ReactNativeWebView?.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'focusmap:openExternal', url: authUrl }));
      } else {
        window.location.href = authUrl;
      }
    </script>
  </body>
</html>`;
}

/**
 * Google OAuth認証URLにリダイレクト
 * GET /api/calendar/connect
 */
export async function GET(request: NextRequest) {
  console.log('[Calendar Connect] Route hit. Starting OAuth flow...');
  const supabase = await createClient();
  const nextPath = request.nextUrl.searchParams.get('next') || '/dashboard';
  const desktopOAuth = request.nextUrl.searchParams.get('desktop_oauth') === '1';
  const appOAuth = request.nextUrl.searchParams.get('app_oauth') === 'ios';

  // ログインユーザーを確認
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.error('[Calendar Connect] User not authenticated:', error?.message);
    const origin = resolveOriginFromRequest(request);
    return NextResponse.redirect(
      new URL('/login?redirect=/dashboard&calendar_error=not_authenticated', origin)
    );
  }

  const redirectUri = resolveGoogleRedirectUriFromRequest(request);
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!googleClientId || !googleClientSecret) {
    console.error('[Calendar Connect] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    const origin = resolveOriginFromRequest(request);
    return NextResponse.redirect(
      new URL('/dashboard?calendar_error=google_oauth_not_configured', origin)
    );
  }

  console.log('[Calendar Connect] Resolved redirect_uri:', redirectUri);
  console.log('[Calendar Connect] Environment check:', {
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ? '[SET]' : '[NOT SET]',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ? '[SET]' : '[NOT SET]',
    xForwardedHost: request.headers.get('x-forwarded-host') || '[NOT SET]',
    xForwardedProto: request.headers.get('x-forwarded-proto') || '[NOT SET]',
    requestUrlOrigin: new URL(request.url).origin,
  });

  // OAuth2クライアントを作成
  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    redirectUri
  );

  const state = encodeCalendarOAuthState(user.id, nextPath, {
    desktop: desktopOAuth,
    app: appOAuth ? 'ios' : undefined,
  });

  if (desktopOAuth || appOAuth) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      const origin = resolveOriginFromRequest(request);
      return NextResponse.redirect(
        new URL('/dashboard?calendar_error=external_session_missing', origin)
      );
    }
    registerDesktopCalendarOAuthSession(state, {
      userId: user.id,
      accessToken: session.access_token,
      next: nextPath,
    });
  }

  // 認証URLを生成
  // hl=en: OAuth同意画面を英語表示に強制する（OAuth verification審査要件）
  const authUrl = oauth2Client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline', // refresh_tokenを取得
    prompt: 'consent', // 強制的に同意画面を表示してrefresh_tokenを再取得
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      // 連携アカウントの表示用（メール/名前/picture）。non-sensitiveなのでOAuth verification申請不要
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      // 注: Gmail / Drive / Sheets 等の sensitive scope は Google OAuth verification が必要なため、
      //     ここに追加せず、 外部 MCPサーバ (Composio / Zapier MCP 等) 経由で連携する方針。
      //     詳細: docs/plans/mcp-integration.md
    ],
    state,
    hl: 'en',
  });

  console.log('[Calendar Connect] Generated Auth URL:', authUrl);

  if (desktopOAuth) {
    return new NextResponse(desktopOAuthLaunchPage(authUrl), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  if (appOAuth) {
    return new NextResponse(appOAuthLaunchPage(authUrl), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  // Google認証ページにリダイレクト
  return NextResponse.redirect(authUrl);
}
