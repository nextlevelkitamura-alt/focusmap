import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import { encodeCalendarOAuthState, resolveGoogleRedirectUriFromRequest } from '@/lib/google-oauth';

/**
 * Google OAuth認証URLにリダイレクト
 * GET /api/calendar/connect
 */
export async function GET(request: NextRequest) {
  console.log('[Calendar Connect] Route hit. Starting OAuth flow...');
  const supabase = await createClient();
  const nextPath = request.nextUrl.searchParams.get('next') || '/dashboard';

  // ログインユーザーを確認
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.error('[Calendar Connect] User not authenticated:', error?.message);
    return NextResponse.redirect(
      new URL('/login?redirect=/dashboard&calendar_error=not_authenticated', request.url)
    );
  }

  const redirectUri = resolveGoogleRedirectUriFromRequest(request);

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
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  // 認証URLを生成
  const authUrl = oauth2Client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline', // refresh_tokenを取得
    prompt: 'consent', // 強制的に同意画面を表示してrefresh_tokenを再取得
    scope: [
      'https://www.googleapis.com/auth/calendar', // カレンダーリスト取得とイベント操作
    ],
    state: encodeCalendarOAuthState(user.id, nextPath),
  });

  console.log('[Calendar Connect] Generated Auth URL:', authUrl);

  // Google認証ページにリダイレクト
  return NextResponse.redirect(authUrl);
}
