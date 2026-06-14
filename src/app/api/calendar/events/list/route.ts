import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { fetchCalendarEvents, fetchMultipleCalendarEventsWithStatus, getCalendarClient } from '@/lib/google-calendar';
import { classifyCalendarAuthError, shouldAttemptTokenRefresh } from '@/lib/calendar-auth-errors';
import { buildCalendarReauthUrl } from '@/lib/google-oauth';
import type { CalendarEvent } from '@/types/calendar';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type CalendarEventRow = {
  id: string;
  user_id: string;
  google_event_id: string | null;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  timezone: string;
  recurrence: string[] | null;
  recurring_event_id: string | null;
  color: string | null;
  background_color: string | null;
  google_created_at: string | null;
  google_updated_at: string | null;
  reminders: number[] | null;
  is_completed: boolean | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

type UserCalendarRow = {
  google_calendar_id: string;
  background_color: string | null;
  name: string | null;
};

type CalendarResponseEvent = CalendarEvent & {
  google_event_id: string;
};

function getCompletionKey(calendarId: string, googleEventId: string): string {
  return `${calendarId}::${googleEventId}`;
}

function toTokyoDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return year && month && day
    ? `${year}-${month}-${day}`
    : date.toISOString().slice(0, 10);
}

function numericPriorityToString(p: number | null | undefined): 'high' | 'medium' | 'low' | undefined {
  if (p === null || p === undefined) return undefined;
  if (p >= 3) return 'high';
  if (p >= 2) return 'medium';
  return 'low';
}

function getMostRecentSyncedAt(events: Array<{ synced_at?: string | null }>): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;
  for (const event of events) {
    if (!event.synced_at) continue;
    const syncedAtMs = new Date(event.synced_at).getTime();
    if (Number.isFinite(syncedAtMs) && syncedAtMs > latestMs) {
      latestMs = syncedAtMs;
      latestIso = event.synced_at;
    }
  }
  return latestIso;
}

function buildCalendarColorMap(userCalendars: UserCalendarRow[]) {
  const calendarColorMap = new Map<string, string>();
  userCalendars.forEach(cal => {
    if (cal.background_color) {
      calendarColorMap.set(cal.google_calendar_id, cal.background_color);
    }
  });
  return calendarColorMap;
}

function buildHolidayCalendarIds(userCalendars: UserCalendarRow[]) {
  return new Set(
    userCalendars
      .filter(cal => {
        const name = (cal.name || '').toLowerCase();
        return (
          name.includes('祝日') ||
          name.includes('holidays in') ||
          name.includes('japanese holidays')
        );
      })
      .map(cal => cal.google_calendar_id)
  );
}

function normalizeDbEventForResponse(event: CalendarEventRow): CalendarResponseEvent {
  return {
    ...event,
    id: event.google_event_id ? getCompletionKey(event.calendar_id, event.google_event_id) : event.id,
    google_event_id: event.google_event_id || '',
    description: event.description || undefined,
    location: event.location || undefined,
    recurrence: event.recurrence || undefined,
    recurring_event_id: event.recurring_event_id || undefined,
    color: event.color || undefined,
    background_color: event.background_color || undefined,
    google_created_at: event.google_created_at || undefined,
    google_updated_at: event.google_updated_at || undefined,
    reminders: event.reminders || undefined,
    is_completed: !!event.is_completed,
  };
}

async function loadUserCalendars(supabase: SupabaseServerClient, userId: string): Promise<UserCalendarRow[]> {
  const { data, error } = await supabase
    .from('user_calendars')
    .select('google_calendar_id, background_color, name')
    .eq('user_id', userId);

  if (error) {
    console.error('[events/list] Failed to load user calendars:', error);
    return [];
  }

  return (data || []) as UserCalendarRow[];
}

async function loadDbCalendarEvents(
  supabase: SupabaseServerClient,
  userId: string,
  timeMin: Date,
  timeMax: Date,
  calendarIds?: string[]
): Promise<CalendarEventRow[]> {
  let query = supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .lt('start_time', timeMax.toISOString())
    .gt('end_time', timeMin.toISOString());

  if (calendarIds && calendarIds.length > 0) {
    query = query.in('calendar_id', calendarIds);
  }

  const { data, error } = await query.order('start_time', { ascending: true });
  if (error) {
    console.error('[events/list] Failed to load cached DB events:', error);
    return [];
  }

  return (data || []) as CalendarEventRow[];
}

async function enrichEventsForResponse(
  supabase: SupabaseServerClient,
  userId: string,
  events: CalendarResponseEvent[],
  dbEvents: CalendarEventRow[],
  userCalendars: UserCalendarRow[],
  timeMin: Date,
  timeMax: Date
) {
  const calendarColorMap = buildCalendarColorMap(userCalendars);
  const holidayCalendarIds = buildHolidayCalendarIds(userCalendars);

  const eventIdsToCheck = events
    .map(event => event.google_event_id)
    .filter((id): id is string => !!id);

  const taskMap = new Map<string, { id: string; priority: number | null; estimated_time: number | null }>();
  if (eventIdsToCheck.length > 0) {
    const { data: tasksWithEvents } = await supabase
      .from('tasks')
      .select('id, google_event_id, calendar_id, priority, estimated_time')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('google_event_id', eventIdsToCheck)
      .not('google_event_id', 'is', null);

    if (tasksWithEvents) {
      tasksWithEvents.forEach(task => {
        if (task.google_event_id && task.calendar_id) {
          taskMap.set(getCompletionKey(task.calendar_id, task.google_event_id), {
            id: task.id,
            priority: task.priority,
            estimated_time: task.estimated_time
          });
        }
      });
    }
  }

  const completionDateMin = toTokyoDateString(timeMin);
  const completionDateMax = toTokyoDateString(timeMax);
  const { data: eventCompletions, error: eventCompletionError } = await supabase
    .from('event_completions')
    .select('google_event_id, calendar_id, completed_date')
    .eq('user_id', userId)
    .gte('completed_date', completionDateMin)
    .lte('completed_date', completionDateMax);

  if (eventCompletionError) {
    console.error('[events/list] Failed to load event completions:', eventCompletionError);
  }

  const completionMap = new Map<string, boolean>();
  const setCompleted = (calendarId: string | null | undefined, googleEventId: string | null | undefined) => {
    if (!googleEventId) return;
    if (calendarId) {
      completionMap.set(getCompletionKey(calendarId, googleEventId), true);
    }
  };
  const isEventCompleted = (event: { calendar_id?: string | null; google_event_id?: string | null }) => {
    if (!event.google_event_id) return false;
    if (event.calendar_id && completionMap.get(getCompletionKey(event.calendar_id, event.google_event_id))) {
      return true;
    }
    return false;
  };

  dbEvents.forEach(event => {
    if (event.google_event_id && event.is_completed) {
      setCompleted(event.calendar_id, event.google_event_id);
    }
  });
  (eventCompletions || []).forEach(completion => {
    setCompleted(completion.calendar_id, completion.google_event_id);
  });

  return events
    .filter(event => !holidayCalendarIds.has(event.calendar_id))
    .map(event => {
      const taskInfo = event.google_event_id ? taskMap.get(getCompletionKey(event.calendar_id, event.google_event_id)) : undefined;
      const calendarColor = calendarColorMap.get(event.calendar_id);
      return {
        ...event,
        task_id: taskInfo?.id,
        priority: numericPriorityToString(taskInfo?.priority),
        estimated_time: taskInfo?.estimated_time ?? undefined,
        is_completed: event.is_completed || isEventCompleted(event),
        background_color: calendarColor || event.background_color,
      };
    });
}

/**
 * Googleカレンダーからイベントを取得
 * GET /api/calendar/events/list?timeMin=xxx&timeMax=xxx&calendarId=xxx,xxx&forceSync=true
 *
 * calendarId: カンマ区切りで複数のカレンダーIDを指定可能
 */
export async function GET(request: NextRequest) {
  console.log('[events/list] API called');
  const reauthUrl = buildCalendarReauthUrl(request, '/dashboard');
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[events/list] Unauthorized');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized', reauthUrl } },
      { status: 401 }
    );
  }

  console.log('[events/list] User authenticated:', user.id);

  // クエリパラメータの取得
  const searchParams = request.nextUrl.searchParams;
  const timeMinStr = searchParams.get('timeMin');
  const timeMaxStr = searchParams.get('timeMax');
  const calendarIdParam = searchParams.get('calendarId');
  const forceSync = searchParams.get('forceSync') === 'true';

  // 複数のカレンダーIDをパース
  const calendarIds = calendarIdParam
    ? calendarIdParam.split(',').map(id => id.trim()).filter(id => id.length > 0)
    : undefined;

  // バリデーション
  if (!timeMinStr || !timeMaxStr) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'timeMin and timeMax are required'
        }
      },
      { status: 400 }
    );
  }

  const timeMin = new Date(timeMinStr);
  const timeMax = new Date(timeMaxStr);

  if (isNaN(timeMin.getTime()) || isNaN(timeMax.getTime())) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid date format for timeMin or timeMax'
        }
      },
      { status: 400 }
    );
  }

  try {
    const cachedUserCalendars = await loadUserCalendars(supabase, user.id);
    const cachedDbEvents = await loadDbCalendarEvents(supabase, user.id, timeMin, timeMax, calendarIds);

    if (!forceSync && cachedDbEvents.length > 0) {
      const syncedAt = getMostRecentSyncedAt(cachedDbEvents) || new Date().toISOString();
      // DB cache is a fast first paint, not the source of truth. Always ask the
      // client to revalidate it silently so partial cache rows cannot hide real
      // Google Calendar events for the rest of the session.
      const needsRefresh = true;
      const cachedEvents = cachedDbEvents.map(normalizeDbEventForResponse);
      const eventsWithColor = await enrichEventsForResponse(
        supabase,
        user.id,
        cachedEvents,
        cachedDbEvents,
        cachedUserCalendars,
        timeMin,
        timeMax
      );

      console.log('[events/list] Returning cached DB events:', {
        total: eventsWithColor.length,
        syncedAt,
        needsRefresh,
      });

      return NextResponse.json({
        success: true,
        events: eventsWithColor,
        syncedAt,
        fromCache: true,
        needsRefresh,
      });
    }

    // 常に Google Calendar API から最新のイベントを取得（キャッシュチェックを削除）
    // Google カレンダーを正確性のソースとして扱う
    let googleEvents;
    const authoritativeCalendarIds = new Set<string>();
    if (calendarIds && calendarIds.length > 0) {
      // 複数カレンダーから並列取得
      const fetchResult = await fetchMultipleCalendarEventsWithStatus(user.id, calendarIds, {
        timeMin,
        timeMax,
      });
      googleEvents = fetchResult.events;
      fetchResult.successfulCalendarIds.forEach(id => authoritativeCalendarIds.add(id));
      if (fetchResult.failedCalendarIds.length > 0) {
        console.warn('[events/list] Skipping orphan cleanup for failed calendars:', fetchResult.failedCalendarIds);
      }
    } else {
      // 単一カレンダー（デフォルトはprimary）
      googleEvents = await fetchCalendarEvents(user.id, {
        calendarId: undefined,
        timeMin,
        timeMax,
      });
      googleEvents.forEach(event => authoritativeCalendarIds.add(event.calendar_id));
    }

    // カレンダーの色情報を取得
    const { data: userCalendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id, background_color, name')
      .eq('user_id', user.id);

    // カレンダーIDから色へのマップを作成
    const calendarColorMap = new Map<string, string>();
    userCalendars?.forEach(cal => {
      if (cal.background_color) {
        calendarColorMap.set(cal.google_calendar_id, cal.background_color);
      }
    });

    // Holiday calendars are display-noise in timeline UI, so filter their events out.
    const holidayCalendarIds = new Set(
      (userCalendars || [])
        .filter(cal => {
          const name = (cal.name || '').toLowerCase();
          return (
            name.includes('祝日') ||
            name.includes('holidays in') ||
            name.includes('japanese holidays')
          );
        })
        .map(cal => cal.google_calendar_id)
    );

    console.log('[events/list] Calendar color map:', Object.fromEntries(calendarColorMap));
    console.log('[events/list] Google Calendar API events:', googleEvents.length);

    // Google Calendar API のイベントに id を付与し、重複を排除
    // event_id はカレンダー間で衝突しうるため、calendar_id と組み合わせて扱う。
    const seenGoogleEventKeys = new Set<string>();
    const googleEventsWithId = googleEvents
      .map(event => ({
        ...event,
        id: getCompletionKey(event.calendar_id, event.google_event_id)
      }))
      .filter(event => {
        const key = getCompletionKey(event.calendar_id, event.google_event_id);
        if (seenGoogleEventKeys.has(key)) {
          return false; // 重複を排除
        }
        seenGoogleEventKeys.add(key);
        return true;
      });

    // Google Calendar API のイベントを Set に格納（重複チェック用）
    const googleEventKeys = seenGoogleEventKeys;

    // DB からすべてのイベントを取得（google_event_id の有無に関わらず）
    let allDbEventsQuery = supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_time', timeMin.toISOString())
      .lte('end_time', timeMax.toISOString());

    // カレンダーIDでフィルタ（指定がある場合）
    if (calendarIds && calendarIds.length > 0) {
      allDbEventsQuery = allDbEventsQuery.in('calendar_id', calendarIds);
    }

    const { data: allDbEvents } = await allDbEventsQuery;

    console.log('[events/list] All DB events:', allDbEvents?.length || 0);

    // Google Calendar API に存在しない DB イベントを抽出
    // google_event_id 付きで Google に存在しない = 削除済み孤児 → 除外
    // google_event_id なし = ローカル限定イベント → 表示
    const localOnlyEvents = (allDbEvents || []).filter(event => {
      if (!event.google_event_id) {
        return true; // ローカル限定イベント（Google連携なし）
      }
      return false; // google_event_id付きはGoogle APIの結果のみを信頼
    });

    // 孤児イベントを非同期でDBからクリーンアップ（Google Calendarに存在しないDB行）
    const orphanDbEvents = (allDbEvents || [])
      .filter(e =>
        e.google_event_id &&
        authoritativeCalendarIds.has(e.calendar_id) &&
        !googleEventKeys.has(getCompletionKey(e.calendar_id, e.google_event_id))
      );
    const orphanGoogleEventIds = Array.from(new Set(
      orphanDbEvents
        .map(e => e.google_event_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ));
    if (orphanDbEvents.length > 0) {
      console.log('[events/list] Cleaning up orphan DB events:', orphanDbEvents.length);
      const orphanDeleteResults = await Promise.all(
        orphanDbEvents.map(event =>
          supabase
            .from('calendar_events')
            .delete()
            .eq('user_id', user.id)
            .eq('calendar_id', event.calendar_id)
            .eq('google_event_id', event.google_event_id)
        )
      );
      const orphanDelErr = orphanDeleteResults.find(result => result.error)?.error;
      if (orphanDelErr) console.error('[events/list] Orphan cleanup failed:', orphanDelErr);

      // Google Calendarに存在しないイベントに対応する取り込みタスクはsoft-deleteする。
      const importedTaskOrphanResults = await Promise.all(orphanDbEvents.map(event =>
        supabase
          .from('tasks')
          .update({
            deleted_at: new Date().toISOString(),
            is_timer_running: false,
            last_started_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('source', 'google_event')
          .eq('calendar_id', event.calendar_id)
          .eq('google_event_id', event.google_event_id)
          .is('deleted_at', null)
      ));
      const importedTaskOrphanErr = importedTaskOrphanResults.find(result => result.error)?.error;
      if (importedTaskOrphanErr) {
        console.error('[events/list] Orphan imported task cleanup failed:', importedTaskOrphanErr);
      } else {
        console.log('[events/list] Soft-deleted orphan imported tasks for', orphanDbEvents.length, 'calendar events');
      }

      // 手動/マインドマップ由来タスクはタスク自体を残し、予定リンクだけ外す。
      // scheduled_at/calendar_id を残すと自動同期でGoogle予定を復活させるため、Google削除を正にする。
      const manualTaskOrphanResults = await Promise.all(orphanDbEvents.map(event =>
        supabase
          .from('tasks')
          .update({
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: null,
            scheduled_at: null,
            stage: 'plan',
            is_timer_running: false,
            last_started_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .neq('source', 'google_event')
          .eq('calendar_id', event.calendar_id)
          .eq('google_event_id', event.google_event_id)
          .is('deleted_at', null)
      ));
      const manualTaskOrphanErr = manualTaskOrphanResults.find(result => result.error)?.error;
      if (manualTaskOrphanErr) {
        console.error('[events/list] Orphan manual task detach failed:', manualTaskOrphanErr);
      }

      // 孤児イベントの完了記録もクリーンアップ
      const completionResults = await Promise.all(orphanDbEvents.map(event =>
        supabase
          .from('event_completions')
          .delete()
          .eq('user_id', user.id)
          .eq('calendar_id', event.calendar_id)
          .eq('google_event_id', event.google_event_id)
      ));
      const completionErr = completionResults.find(result => result.error)?.error;
      if (completionErr) {
        console.error('[events/list] Orphan event_completions cleanup failed:', completionErr);
      }

      // メモ予定もGoogle側削除を正として未予定へ戻す。
      const liveGoogleEventIds = new Set(googleEventsWithId.map(event => event.google_event_id));
      const memoSafeOrphanGoogleEventIds = orphanGoogleEventIds.filter(id => !liveGoogleEventIds.has(id));
      if (memoSafeOrphanGoogleEventIds.length > 0) {
        const { error: memoOrphanErr } = await supabase
          .from('ideal_goals')
          .update({
            scheduled_at: null,
            google_event_id: null,
            memo_status: 'unsorted',
            is_today: false,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .in('google_event_id', memoSafeOrphanGoogleEventIds);
        if (memoOrphanErr) {
          console.error('[events/list] Orphan memo detach failed:', memoOrphanErr);
        }
      }
    }

    console.log('[events/list] Local-only events (no google_event_id):', localOnlyEvents.length);

    // タスクテーブルから google_event_id に対応するタスクIDを取得
    const eventIdsToCheck = [
      ...googleEventsWithId.map(e => e.google_event_id),
      ...localOnlyEvents.map(e => e.google_event_id).filter(Boolean)
    ];

    const taskMap = new Map<string, { id: string; priority: number | null; estimated_time: number | null }>();
    if (eventIdsToCheck.length > 0) {
      const { data: tasksWithEvents } = await supabase
        .from('tasks')
        .select('id, google_event_id, calendar_id, priority, estimated_time')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .in('google_event_id', eventIdsToCheck)
        .not('google_event_id', 'is', null);

      if (tasksWithEvents) {
        tasksWithEvents.forEach(task => {
          if (task.google_event_id && task.calendar_id) {
            taskMap.set(getCompletionKey(task.calendar_id, task.google_event_id), {
              id: task.id,
              priority: task.priority,
              estimated_time: task.estimated_time
            });
          }
        });
      }
      console.log('[events/list] Task map size:', taskMap.size);
    }

    const completionDateMin = toTokyoDateString(timeMin);
    const completionDateMax = toTokyoDateString(timeMax);
    const { data: eventCompletions, error: eventCompletionError } = await supabase
      .from('event_completions')
      .select('google_event_id, calendar_id, completed_date')
      .eq('user_id', user.id)
      .gte('completed_date', completionDateMin)
      .lte('completed_date', completionDateMax);

    if (eventCompletionError) {
      console.error('[events/list] Failed to load event completions:', eventCompletionError);
    }

    // Build is_completed map from DB event cache and completion sidecar records.
    const completionMap = new Map<string, boolean>();
    const setCompleted = (calendarId: string | null | undefined, googleEventId: string | null | undefined) => {
      if (!googleEventId) return;
      if (calendarId) {
        completionMap.set(getCompletionKey(calendarId, googleEventId), true);
      }
    };
    const isEventCompleted = (event: { calendar_id?: string | null; google_event_id?: string | null }) => {
      if (!event.google_event_id) return false;
      if (event.calendar_id && completionMap.get(getCompletionKey(event.calendar_id, event.google_event_id))) {
        return true;
      }
      return false;
    };

    if (allDbEvents) {
      allDbEvents.forEach(event => {
        if (event.google_event_id && event.is_completed) {
          setCompleted(event.calendar_id, event.google_event_id);
        }
      });
    }
    (eventCompletions || []).forEach(completion => {
      setCompleted(completion.calendar_id, completion.google_event_id);
    });

    // Google Calendar API のイベントとローカルのみのイベントをマージ（task_id, priority, estimated_time, is_completed を追加）
    const allEvents = [
      ...googleEventsWithId.map(event => {
        const taskInfo = taskMap.get(getCompletionKey(event.calendar_id, event.google_event_id));
        return {
          ...event,
          task_id: taskInfo?.id,
          priority: numericPriorityToString(taskInfo?.priority),
          estimated_time: taskInfo?.estimated_time ?? undefined,
          is_completed: isEventCompleted(event),
        };
      }),
      ...localOnlyEvents.map(event => {
        const taskInfo = event.google_event_id ? taskMap.get(getCompletionKey(event.calendar_id, event.google_event_id)) : undefined;
        return {
          ...event,
          task_id: taskInfo?.id,
          priority: numericPriorityToString(taskInfo?.priority),
          estimated_time: taskInfo?.estimated_time ?? undefined,
          is_completed: event.is_completed || isEventCompleted(event),
        };
      })
    ];

    const visibleEvents = allEvents.filter(event => !holidayCalendarIds.has(event.calendar_id));

    // 色マッピングを追加
    const eventsWithColor = visibleEvents.map(event => {
      const calendarColor = calendarColorMap.get(event.calendar_id);

      // calendar color only: event.colorId / event individual color は使わない
      if (!calendarColor) {
        console.log('[events/list] No color found for event:', {
          eventId: event.google_event_id,
          calendarId: event.calendar_id,
          title: event.title
        });
      }

      return {
        ...event,
        background_color: calendarColor
      };
    });

    console.log('[events/list] Events with color:', {
      total: eventsWithColor.length,
      fromGoogle: googleEvents.length,
      fromLocal: localOnlyEvents.length,
      filteredHoliday: allEvents.length - visibleEvents.length,
      withMappedColor: eventsWithColor.filter(e => calendarColorMap.has(e.calendar_id)).length,
      withMissingColor: eventsWithColor.filter(e => !e.background_color).length,
    });

    // DBに非同期で保存（エラーがあっても返却をブロックしない）
    const now = new Date().toISOString();
    // id は UUID カラム（DB が自動生成）のため除外する。
    // google_event_id は UUID 形式ではないため id に渡すと PostgreSQL の型エラーで
    // INSERT が失敗し、新規行が一切 upsert されない原因となっていた。
    const eventsWithSyncTime = googleEventsWithId.map((eventWithId) => {
      const event = { ...eventWithId };
      delete (event as Partial<typeof event>).id;
      return {
        ...event,
        // Google Calendar API は is_completed を返さないため、DB の値で明示的に保護
        is_completed: isEventCompleted(event),
        synced_at: now
      };
    });

    // DBに保存（エラーがあってもレスポンスはブロックしないが、awaitでDB整合性を確保）
    if (eventsWithSyncTime.length > 0) {
      const { error: upsertErr } = await supabase
        .from('calendar_events')
        .upsert(eventsWithSyncTime, {
          onConflict: 'user_id,calendar_id,google_event_id',
          ignoreDuplicates: false
        });
      if (upsertErr) {
        console.error('[events/list] Failed to upsert calendar events:', upsertErr);
      } else {
        console.log('[events/list] Successfully upserted', eventsWithSyncTime.length, 'events to database');
      }
    }

    // 30日以上前のイベントを DB からクリーンアップ（レスポンスをブロックしない）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .lt('end_time', thirtyDaysAgo.toISOString())
      .then(({ error: cleanupErr }) => {
        if (cleanupErr) console.error('[events/list] Old event cleanup failed:', cleanupErr);
      });

    return NextResponse.json({
      success: true,
      events: eventsWithColor,
      syncedAt: now,
      fromCache: false
    });

  } catch (error: unknown) {
    console.error('Calendar events list error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const initialAuthError = classifyCalendarAuthError(errorMessage);

    // Access tokenの一時的失効が疑われる場合のみ、手動リフレッシュを試みる
    if (shouldAttemptTokenRefresh(errorMessage)) {
      try {
        console.log('[events/list] Token expired, attempting manual refresh...');
        const { oauth2Client } = await getCalendarClient(user.id);
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (credentials.access_token) {
          console.log('[events/list] Token refreshed successfully, retrying...');
          // tokens イベントハンドラでDBに保存される
          // クライアントにリトライを促す
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'TOKEN_REFRESHED',
                message: 'Token was refreshed. Please retry the request.'
              }
            },
            { status: 503 }
          );
        }
      } catch (refreshError: unknown) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
        console.error('[events/list] Token refresh failed:', {
          refreshMessage,
          initialMessage: errorMessage,
        });
        const refreshAuthError = classifyCalendarAuthError(refreshMessage);
        if (refreshAuthError) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: refreshAuthError.code,
                message: refreshAuthError.message,
                reauthUrl,
              }
            },
            { status: refreshAuthError.status }
          );
        }
      }
    }

    if (initialAuthError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: initialAuthError.code,
            message: initialAuthError.message,
            reauthUrl,
          }
        },
        { status: initialAuthError.status }
      );
    }

    // その他のエラー
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: errorMessage || 'Failed to fetch calendar events'
        }
      },
      { status: 500 }
    );
  }
}
