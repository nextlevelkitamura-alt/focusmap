import { google } from 'googleapis';
import { createClient } from '@/utils/supabase/server';
import { CalendarEvent, GoogleCalendarEvent } from '@/types/calendar';

/**
 * Google Calendar APIクライアントを取得
 */
export async function getCalendarClient(userId: string) {
  const supabase = await createClient();

  // ユーザーのカレンダー設定を取得
  const { data: settings, error } = await supabase
    .from('user_calendar_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !settings) {
    throw new Error('Calendar settings not found');
  }

  if (!settings.google_access_token || !settings.google_refresh_token) {
    throw new Error('Google OAuth tokens not found');
  }

  // OAuth2クライアントを作成
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // トークンをセット
  oauth2Client.setCredentials({
    access_token: settings.google_access_token,
    refresh_token: settings.google_refresh_token,
  });

  // トークン更新時のハンドラー
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      // 新しいアクセストークンをDBに保存
      await supabase
        .from('user_calendar_settings')
        .update({
          google_access_token: tokens.access_token,
          google_token_expires_at: new Date(Date.now() + (tokens.expiry_date || 3600) * 1000).toISOString(),
        })
        .eq('user_id', userId);
    }
  });

  // Calendarクライアントを返す
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return { calendar, oauth2Client };
}

/**
 * タスクをGoogleカレンダーイベントに変換
 */
export function taskToCalendarEvent(task: {
  title: string;
  scheduled_at: string | null;
  estimated_time: number;
}) {
  if (!task.scheduled_at) {
    throw new Error('Task must have scheduled_at');
  }

  const startDate = new Date(task.scheduled_at);
  const endDate = new Date(startDate.getTime() + task.estimated_time * 60 * 1000);

  return {
    summary: task.title,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    // 通知設定（15分前にポップアップ）
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 15 }
      ]
    },
  };
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
    target_calendar_id?: string | null;
  }
) {
  const supabase = await createClient();
  const { calendar } = await getCalendarClient(userId);

  const { data: settings } = await supabase
    .from('user_calendar_settings')
    .select('default_calendar_id')
    .eq('user_id', userId)
    .single();

  // target_calendar_id が設定されていればそれを使用、なければデフォルト
  const calendarId = task.target_calendar_id || settings?.default_calendar_id || 'primary';

  try {
    const event = taskToCalendarEvent(task);

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
      // 新規イベントを作成
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      googleEventId = response.data.id!;

      // google_event_id をタスクに保存
      await supabase
        .from('tasks')
        .update({ google_event_id: googleEventId })
        .eq('id', taskId);
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
  googleEventId: string
) {
  const supabase = await createClient();
  const { calendar } = await getCalendarClient(userId);

  const { data: settings } = await supabase
    .from('user_calendar_settings')
    .select('default_calendar_id')
    .eq('user_id', userId)
    .single();

  const calendarId = settings?.default_calendar_id || 'primary';

  try {
    await calendar.events.delete({
      calendarId,
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
