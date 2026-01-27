import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';

/**
 * Google OAuth認証URLにリダイレクト
 * GET /api/calendar/connect
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // OAuth2クライアントを作成
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // 認証URLを生成
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // refresh_tokenを取得
    scope: [
      'https://www.googleapis.com/auth/calendar', // カレンダーリスト取得とイベント操作
    ],
    state: user.id, // ユーザーIDをstateに含める（セキュリティ）
  });

  // Google認証ページにリダイレクト
  return NextResponse.redirect(authUrl);
}
