/**
 * Google Calendar / Gmail API クライアント (focusmap-agent側)
 *
 * - Supabase の user_calendar_settings から OAuth token を取得
 * - googleapis ライブラリで自動 token refresh
 * - 新 token は Supabase に書き戻し
 *
 * 既存 /src/lib/google-calendar.ts のパターンを agent 用に簡素化して移植。
 */

import { google, type Auth } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { info, warn, error as logError } from './logger.js';

interface CalendarSettings {
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expires_at: string | null;
}

export class GoogleAuthError extends Error {}

/**
 * Supabase から OAuth token を取得し、 google-auth OAuth2 client を返す
 * - access_token expired なら自動 refresh
 * - refresh時に Supabase の token を update
 */
export async function getGoogleAuthClient(
  supabase: SupabaseClient,
  userId: string,
): Promise<Auth.OAuth2Client> {
  const { data: settings, error } = await supabase
    .from('user_calendar_settings')
    .select('google_access_token, google_refresh_token, google_token_expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new GoogleAuthError(`user_calendar_settings 読み込み失敗: ${error.message}`);
  }
  if (!settings) {
    throw new GoogleAuthError(
      `user ${userId} の Google 連携が未設定です。Web上で /api/calendar/connect から連携してください。`,
    );
  }

  const s = settings as CalendarSettings;
  if (!s.google_access_token || !s.google_refresh_token) {
    throw new GoogleAuthError('access_token / refresh_token が欠落しています。再連携してください。');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です。 .env.local を確認してください。',
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({
    access_token: s.google_access_token,
    refresh_token: s.google_refresh_token,
    expiry_date: s.google_token_expires_at
      ? new Date(s.google_token_expires_at).getTime()
      : undefined,
  });

  // Token refresh時に Supabase へ書き戻し
  oauth2.on('tokens', (tokens) => {
    void (async () => {
      try {
        const update: Record<string, string> = {};
        if (tokens.access_token) update.google_access_token = tokens.access_token;
        if (tokens.refresh_token) update.google_refresh_token = tokens.refresh_token;
        if (tokens.expiry_date) {
          update.google_token_expires_at = new Date(tokens.expiry_date).toISOString();
        }
        if (Object.keys(update).length > 0) {
          await supabase.from('user_calendar_settings').update(update).eq('user_id', userId);
          info(`[google-calendar] token refreshed for user ${userId}`);
        }
      } catch (e) {
        warn('[google-calendar] token refresh save failed', e);
      }
    })();
  });

  return oauth2;
}

/**
 * 今日の Google Calendar 予定を取得
 */
export async function fetchTodayEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ start: string; end: string; title: string; calendarId?: string }>> {
  const auth = await getGoogleAuthClient(supabase, userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return (res.data.items ?? []).map((e) => {
    const startStr =
      e.start?.dateTime?.slice(11, 16) ?? e.start?.date ?? '--:--';
    const endStr = e.end?.dateTime?.slice(11, 16) ?? e.end?.date ?? '--:--';
    return {
      start: startStr,
      end: endStr,
      title: e.summary ?? '(無題)',
      calendarId: 'primary',
    };
  });
}

/**
 * Gmail の最近の未読メールを取得 (要 gmail.readonly scope)
 */
export async function fetchUnreadEmails(
  supabase: SupabaseClient,
  userId: string,
  options: { maxResults?: number; lookbackHours?: number } = {},
): Promise<Array<{ subject: string; from: string; snippet: string; receivedAt: string }>> {
  const auth = await getGoogleAuthClient(supabase, userId);
  const gmail = google.gmail({ version: 'v1', auth });

  const lookbackHours = options.lookbackHours ?? 24;
  const maxResults = Math.min(options.maxResults ?? 20, 50);
  const after = Math.floor((Date.now() - lookbackHours * 60 * 60 * 1000) / 1000);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `is:unread after:${after}`,
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  const results: Array<{ subject: string; from: string; snippet: string; receivedAt: string }> = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    });
    const headers = detail.data.payload?.headers ?? [];
    const getHeader = (name: string): string =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    results.push({
      subject: getHeader('Subject'),
      from: getHeader('From'),
      snippet: detail.data.snippet ?? '',
      receivedAt: getHeader('Date'),
    });
  }

  return results;
}
