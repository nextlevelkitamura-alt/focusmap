import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import { CalendarEvent, GoogleCalendarEvent } from '@/types/calendar';
import { resolveGoogleRedirectUriFromEnv } from '@/lib/google-oauth';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Google Calendar APIクライアントを取得
 * @param injectedClient - オプショナル。REST API v1からservice_roleクライアントを注入する場合に使用
 */
export async function getCalendarClient(userId: string, injectedClient?: SupabaseClient) {
  const supabase = injectedClient ?? await createClient();


  // ユーザーのカレンダー設定を取得
  const { data: settings, error } = await supabase
    .from('user_calendar_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('[getCalendarClient] Error fetching settings:', {
      userId,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details
    });

    if (error.code === 'PGRST116') {
      throw new Error('Calendar not connected. Please connect your Google Calendar first.');
    }
    throw new Error(`Failed to fetch calendar settings: ${error.message}`);
  }

  if (!settings) {
    console.error('[getCalendarClient] No settings found for user:', userId);
    throw new Error('Calendar settings not found. Please connect your Google Calendar.');
  }

  // Debug logging - トークンの長さも表示

  if (!settings.google_access_token || !settings.google_refresh_token) {
    console.error('[getCalendarClient] Missing tokens for user:', userId, {
      hasAccessToken: !!settings.google_access_token,
      hasRefreshToken: !!settings.google_refresh_token,
      accessTokenValue: settings.google_access_token ? '[EXISTS]' : '[NULL]',
      refreshTokenValue: settings.google_refresh_token ? '[EXISTS]' : '[NULL]'
    });
    throw new Error('Google OAuth tokens not found. Please reconnect your Google Calendar.');
  }

  // OAuth2クライアントを作成
  const redirectUri = resolveGoogleRedirectUriFromEnv();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  // トークンをセット（expiry_dateを含めることでgoogleapisが自動リフレッシュできるようにする）
  oauth2Client.setCredentials({
    access_token: settings.google_access_token,
    refresh_token: settings.google_refresh_token,
    expiry_date: settings.google_token_expires_at
      ? new Date(settings.google_token_expires_at).getTime()
      : undefined,
  });

  // トークン更新時のハンドラー
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      // expiry_date は Unix タイムスタンプ (ms) なので直接 Date に変換
      const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString();

      // 新しいトークンをDBに保存（refresh_tokenが返された場合はそれも保存）
      const updateData: Record<string, string> = {
        google_access_token: tokens.access_token,
        google_token_expires_at: expiresAt,
      };
      if (tokens.refresh_token) {
        updateData.google_refresh_token = tokens.refresh_token;
      }

      await supabase
        .from('user_calendar_settings')
        .update(updateData)
        .eq('user_id', userId);
    }
  });

  // アクセストークンが期限切れの場合、事前にリフレッシュを試行
  const isExpired = settings.google_token_expires_at
    ? new Date(settings.google_token_expires_at).getTime() < Date.now()
    : false;

  if (isExpired) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      console.log('[getCalendarClient] Token refreshed successfully for user:', userId);
    } catch (refreshError: any) {
      const errorMessage = refreshError?.message || String(refreshError);
      console.error('[getCalendarClient] Token refresh failed:', {
        userId,
        error: errorMessage,
      });

      // invalid_grant = リフレッシュトークン自体が失効（テストモード7日制限等）
      if (errorMessage.toLowerCase().includes('invalid_grant')) {
        await supabase
          .from('user_calendar_settings')
          .update({
            sync_status: 'disconnected',
            google_access_token: null,
            google_refresh_token: null,
            google_token_expires_at: null,
          })
          .eq('user_id', userId);

        throw new Error(
          'invalid_grant: Googleカレンダーの認証が失効しました。' +
          'OAuth同意画面が「テストモード」の場合、リフレッシュトークンは7日で失効します。' +
          '「再連携」ボタンから再度連携してください。'
        );
      }

      throw new Error(`Token refresh failed: ${errorMessage}`);
    }
  }

  // Calendarクライアントを返す
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return { calendar, oauth2Client };
}

/**
 * タスクをGoogleカレンダーイベントに変換
 */
export function taskToCalendarEvent(
  task: {
    title: string;
    scheduled_at: string | null;
    estimated_time: number;
    reminders?: number[];
  },
  taskId?: string
) {
  if (!task.scheduled_at) {
    throw new Error('Task must have scheduled_at');
  }

  const startDate = new Date(task.scheduled_at);
  const endDate = new Date(startDate.getTime() + task.estimated_time * 60 * 1000);

  // リマインダー設定: 指定があればそれを使用、なければ「予定の時刻」(0分前)
  const reminderOverrides = task.reminders && task.reminders.length > 0
    ? task.reminders.map(minutes => ({ method: 'popup' as const, minutes }))
    : [{ method: 'popup' as const, minutes: 0 }];

  const event: any = {
    summary: task.title,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    reminders: {
      useDefault: false,
      overrides: reminderOverrides,
    },
  };

  // taskId が指定されている場合は Extended Properties に保存
  if (taskId) {
    event.extendedProperties = {
      private: {
        taskId: taskId
      }
    };
  }

  return event;
}

/**
 * タスクをGoogleカレンダーに同期
 */
export async function syncTaskToCalendar(
  userId: string,
  taskId: string,
  task: {
    title: string;
    scheduled_at: string | null;
    estimated_time: number;
    google_event_id?: string | null;
    calendar_id?: string | null;
    reminders?: number[];
  },
  injectedClient?: SupabaseClient,
) {
  const supabase = injectedClient ?? await createClient();
  const { calendar } = await getCalendarClient(userId, injectedClient);

  const { data: settings } = await supabase
    .from('user_calendar_settings')
    .select('default_calendar_id')
    .eq('user_id', userId)
    .single();

  // calendar_id が設定されていればそれを使用、なければデフォルト
  const calendarId = task.calendar_id || settings?.default_calendar_id || 'primary';

  try {
    // taskId を Extended Properties に含める
    const event = taskToCalendarEvent(task, taskId);

    let googleEventId: string;

    if (task.google_event_id) {
      // 既存イベントを更新
      const response = await calendar.events.update({
        calendarId,
        eventId: task.google_event_id,
        requestBody: event,
      });
      googleEventId = response.data.id!;
    } else {
      // べき等性チェック: Extended Properties で既存イベントを検索（リトライ時の重複防止）
      let existingEventId: string | null = null;
      try {
        const searchResult = await calendar.events.list({
          calendarId,
          privateExtendedProperty: [`taskId=${taskId}`],
          maxResults: 1,
          timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          timeMax: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (searchResult.data.items && searchResult.data.items.length > 0) {
          existingEventId = searchResult.data.items[0].id!;
        }
      } catch (searchErr) {
        // 検索失敗をログに記録（重複イベント作成のリスクがあるため）
        console.warn('[syncTaskToCalendar] Extended Properties search failed, proceeding with insert:', searchErr);
      }

      if (existingEventId) {
        // 既存イベントが見つかった → 更新に切り替え（重複防止）
        const response = await calendar.events.update({
          calendarId,
          eventId: existingEventId,
          requestBody: event,
        });
        googleEventId = response.data.id!;
      } else {
        // 既存イベントなし → 新規作成
        const response = await calendar.events.insert({
          calendarId,
          requestBody: event,
        });
        googleEventId = response.data.id!;
      }

      // google_event_id をタスクに保存
      const { error: saveError } = await supabase
        .from('tasks')
        .update({ google_event_id: googleEventId })
        .eq('id', taskId)
        .eq('user_id', userId);
      if (saveError) {
        console.error('[syncTaskToCalendar] Failed to save google_event_id:', saveError);
        // google_event_id が保存されないと次回重複イベントが作成される可能性があるため、
        // 作成したイベントを削除してエラーとする
        try {
          await calendar.events.delete({ calendarId, eventId: googleEventId });
        } catch (cleanupErr) {
          console.error('[syncTaskToCalendar] Cleanup deletion failed:', cleanupErr);
        }
        throw new Error(`Failed to save google_event_id: ${saveError.message}`);
      }
    }

    // 同期ログを記録
    await supabase.from('calendar_sync_log').insert({
      user_id: userId,
      task_id: taskId,
      google_event_id: googleEventId,
      action: task.google_event_id ? 'update' : 'create',
      direction: 'to_calendar',
      status: 'success',
      sync_data: { task, event },
    });

    return { success: true, googleEventId };
  } catch (error: any) {
    // エラーログを記録
    await supabase.from('calendar_sync_log').insert({
      user_id: userId,
      task_id: taskId,
      google_event_id: task.google_event_id,
      action: task.google_event_id ? 'update' : 'create',
      direction: 'to_calendar',
      status: 'error',
      error_message: error.message,
    });

    throw error;
  }
}

/**
 * Googleカレンダーからタスクを削除
 */
export async function deleteTaskFromCalendar(
  userId: string,
  taskId: string,
  googleEventId: string,
  calendarId?: string
) {
  const supabase = await createClient();
  const { calendar } = await getCalendarClient(userId);

  // calendarId が指定されていない場合はデフォルトを取得
  let targetCalendarId = calendarId;
  if (!targetCalendarId) {
    const { data: settings } = await supabase
      .from('user_calendar_settings')
      .select('default_calendar_id')
      .eq('user_id', userId)
      .single();
    targetCalendarId = settings?.default_calendar_id || 'primary';
  }

  try {
    await calendar.events.delete({
      calendarId: targetCalendarId,
      eventId: googleEventId,
    });

    // 同期ログを記録
    await supabase.from('calendar_sync_log').insert({
      user_id: userId,
      task_id: taskId,
      google_event_id: googleEventId,
      action: 'delete',
      direction: 'to_calendar',
      status: 'success',
    });

    return { success: true };
  } catch (error: any) {
    // エラーログを記録
    await supabase.from('calendar_sync_log').insert({
      user_id: userId,
      task_id: taskId,
      google_event_id: googleEventId,
      action: 'delete',
      direction: 'to_calendar',
      status: 'error',
      error_message: error.message,
    });

    throw error;
  }
}

/**
 * Googleカレンダーからイベントを取得
 */
export async function fetchCalendarEvents(
  userId: string,
  options: {
    calendarId?: string;
    timeMin: Date;
    timeMax: Date;
  }
): Promise<Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at' | 'synced_at'>[]> {
  const { calendar } = await getCalendarClient(userId);

  const calendarId = options.calendarId || 'primary';

  try {
    let calendarDefaultReminders: number[] = [];
    try {
      const calendarInfo = await calendar.calendarList.get({ calendarId });
      calendarDefaultReminders = (calendarInfo.data.defaultReminders || [])
        .filter((r: any) => r.method === 'popup')
        .map((r: any) => r.minutes as number);
    } catch (calendarInfoError) {
      console.warn('[fetchCalendarEvents] Failed to fetch calendar default reminders:', {
        calendarId,
        error: calendarInfoError,
      });
    }

    // Google Calendar APIからイベントを取得
    const response = await calendar.events.list({
      calendarId,
      timeMin: options.timeMin.toISOString(),
      timeMax: options.timeMax.toISOString(),
      singleEvents: true, // 繰り返しイベントを個別のインスタンスに展開
      orderBy: 'startTime',
      maxResults: 2500, // 最大2500件
    });

    const events = response.data.items || [];

    // CalendarEvent型に変換
    return events.map((event) => {
      const isAllDay = !!event.start?.date; // dateフィールドがあれば終日イベント

      // リマインダー情報を抽出
      const reminderOverrides = (event.reminders?.overrides || [])
        .filter((r: any) => r.method === 'popup')
        .map((r: any) => r.minutes as number);

      const usesCalendarDefault = event.reminders === undefined || event.reminders?.useDefault === true;
      const reminders: number[] = reminderOverrides.length > 0
        ? reminderOverrides
        : usesCalendarDefault
          ? calendarDefaultReminders
          : [];

      return {
        user_id: userId,
        google_event_id: event.id!,
        calendar_id: calendarId,
        title: event.summary || '(No title)',
        description: event.description || undefined,
        location: event.location || undefined,
        start_time: isAllDay
          ? new Date(event.start!.date!).toISOString()
          : new Date(event.start!.dateTime!).toISOString(),
        end_time: isAllDay
          ? new Date(event.end!.date!).toISOString()
          : new Date(event.end!.dateTime!).toISOString(),
        is_all_day: isAllDay,
        timezone: event.start?.timeZone || 'Asia/Tokyo',
        recurrence: event.recurrence || undefined,
        recurring_event_id: event.recurringEventId || undefined,
        color: event.colorId || undefined,
        // background_color is not available on Event directly
        background_color: undefined,
        google_created_at: event.created || undefined,
        google_updated_at: event.updated || undefined,
        reminders,
      };
    });
  } catch (error: any) {
    console.error('Failed to fetch calendar events:', error);
    throw new Error(`Failed to fetch calendar events: ${error.message}`);
  }
}

/**
 * ユーザーの全カレンダーを取得（共有・チームカレンダー含む）
 */
export async function fetchUserCalendars(
  userId: string
): Promise<{
  googleCalendarId: string;
  name: string;
  description?: string;
  location?: string;
  timezone: string;
  color?: string;
  backgroundColor?: string;
  accessLevel: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary: boolean;
  googleCreatedAt?: string;
  googleUpdatedAt?: string;
}[]> {
  const { calendar } = await getCalendarClient(userId);

  try {
    // 全てのカレンダーを取得（共有・購読含む）
    const response = await calendar.calendarList.list({
      minAccessRole: 'freeBusyReader', // 最小限の権限でも取得
      showHidden: false, // 非表示カレンダーは除外
      maxResults: 250
    });

    const calendars = response.data.items || [];

    // カレンダー情報を変換
    return calendars.map((cal) => {
      // アクセスレベルの判定
      let accessLevel: 'owner' | 'writer' | 'reader' | 'freeBusyReader' = 'reader';
      if (cal.accessRole === 'owner') {
        accessLevel = 'owner';
      } else if (cal.accessRole === 'writer') {
        accessLevel = 'writer';
      } else if (cal.accessRole === 'reader') {
        accessLevel = 'reader';
      } else {
        accessLevel = 'freeBusyReader';
      }

      return {
        googleCalendarId: cal.id!,
        name: cal.summary || 'Untitled',
        description: cal.description || undefined,
        location: cal.location || undefined,
        timezone: cal.timeZone || 'Asia/Tokyo',
        color: cal.foregroundColor || undefined,
        backgroundColor: cal.backgroundColor || undefined,
        accessLevel,
        primary: cal.primary || false,
        googleCreatedAt: undefined,
        googleUpdatedAt: undefined
      };
    });
  } catch (error: any) {
    console.error('Failed to fetch calendars:', error);
    throw new Error(`Failed to fetch calendars: ${error.message}`);
  }
}

/**
 * 複数のカレンダーからイベントを並列取得
 */
export async function fetchMultipleCalendarEvents(
  userId: string,
  calendarIds: string[],
  options: {
    timeMin: Date;
    timeMax: Date;
  }
): Promise<Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at' | 'synced_at'>[]> {
  // 並列で各カレンダーのイベントを取得
  const eventsPromises = calendarIds.map(calendarId =>
    fetchCalendarEvents(userId, {
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax
    })
  );

  const allEvents = await Promise.all(eventsPromises);

  // 全てのイベントをフラットに結合
  return allEvents.flat();
}
