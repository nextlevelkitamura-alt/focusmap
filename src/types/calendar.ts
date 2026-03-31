/**
 * カレンダー関連の型定義
 */

// ============================================================
// Calendar Event (Googleカレンダーイベント)
// ============================================================

export interface CalendarEvent {
  id: string;
  user_id: string;
  google_event_id: string;
  calendar_id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  timezone: string;
  recurrence?: string[];
  recurring_event_id?: string;
  color?: string;
  background_color?: string;
  google_created_at?: string;
  google_updated_at?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
  task_id?: string; // タスクに紐付いているカレンダーイベントの場合のタスクID
  priority?: 'high' | 'medium' | 'low'; // タスクの優先度（タスク紐付き時のみ）
  estimated_time?: number; // 所要時間（分）（タスク紐付き時のみ）
  reminders?: number[]; // リマインダー（分単位、Google Calendarから取得）
  is_completed?: boolean; // イベントの完了状態
}

// ============================================================
// User Calendar (ユーザーのカレンダー設定)
// ============================================================

export interface UserCalendar {
  id: string;
  user_id: string;
  google_calendar_id: string;
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  background_color?: string;
  is_visible: boolean;
  is_primary: boolean;
  access_role?: 'owner' | 'writer' | 'reader';
  google_created_at?: string;
  google_updated_at?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// API Request/Response Types
// ============================================================

export interface FetchEventsOptions {
  calendarId?: string;
  timeMin: Date;
  timeMax: Date;
  forceSync?: boolean;
}

export interface FetchEventsResponse {
  success: boolean;
  events: CalendarEvent[];
  syncedAt: string;
}

export interface CreateEventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  timezone?: string;
  color?: string;
}

export interface UpdateEventInput {
  id: string;
  calendarId: string;
  googleEventId: string;
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  color?: string;
}

export interface DeleteEventInput {
  id: string;
  calendarId: string;
  googleEventId: string;
}

// ============================================================
// Google Calendar API Types
// ============================================================

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  recurrence?: string[];
  recurringEventId?: string;
  colorId?: string;
  backgroundColor?: string;
  created?: string;
  updated?: string;
}

// ============================================================
// Notification Types
// ============================================================

export interface NotificationSetting {
  id: string;
  user_id: string;
  notification_type: 'task_start' | 'task_due' | 'event_start';
  is_enabled: boolean;
  advance_minutes: number;
  sound_enabled: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationQueue {
  id: string;
  user_id: string;
  target_type: 'task' | 'event';
  target_id: string;
  notification_type: 'task_start' | 'task_due' | 'event_start';
  title: string;
  body: string;
  icon_url?: string;
  action_url?: string;
  scheduled_at: string;
  sent_at?: string;
  is_sent: boolean;
  retry_count: number;
  last_error?: string;
  created_at: string;
}
