'use client';

import { useState, useEffect, useCallback, useMemo, type SetStateAction } from 'react';
import { CalendarEvent } from '@/types/calendar';

interface UseCalendarEventsOptions {
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[];
  enabled?: boolean;
  autoSync?: boolean;
  syncInterval?: number;  // ミリ秒（デフォルト: 120000 = 2分）
}

type CalendarFetchError = Error & { code?: string; reauthUrl?: string };

// --- Module-level cache (shared across all hook instances) ---
interface CacheEntry {
  events: CalendarEvent[];
  syncedAt: Date;
  staleAt: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_DISPLAY_TTL_MS = 5 * 60 * 1000;
const CACHE_REVALIDATE_AFTER_MS = 60 * 1000;
const DEFAULT_SYNC_INTERVAL_MS = 120 * 1000;
const SYNC_INTERVAL_JITTER_RATIO = 0.25;
const SESSION_CACHE_PREFIX = 'focusmap:calendar-events:';
const OPTIMISTIC_EVENT_KEEP_MS = 60 * 1000;
const inflightRequests = new Map<string, Promise<CacheEntry>>();

// Backoff state for quota errors
let quotaErrorCount = 0;
let quotaBackoffUntil = 0;

function getCacheKey(timeMin: Date, timeMax: Date, calendarIds?: string[]): string {
  const ids = calendarIds && calendarIds.length > 0 ? [...calendarIds].sort().join(',') : 'primary';
  return `${timeMin.toISOString()}-${timeMax.toISOString()}-${ids}`;
}

function getSessionCacheKey(cacheKey: string): string {
  return `${SESSION_CACHE_PREFIX}${cacheKey}`;
}

function removeSessionCacheEntry(cacheKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(getSessionCacheKey(cacheKey));
  } catch {
    // Ignore storage access errors.
  }
}

function writeCacheEntry(cacheKey: string, entry: CacheEntry) {
  cache.set(cacheKey, entry);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(getSessionCacheKey(cacheKey), JSON.stringify({
      ...entry,
      syncedAt: entry.syncedAt.toISOString(),
    }));
  } catch {
    // Calendar data is still available in memory even if sessionStorage is full/blocked.
  }
}

function readSessionCacheEntry(cacheKey: string): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(getSessionCacheKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      events?: CalendarEvent[];
      syncedAt?: string;
      staleAt?: number;
      expiresAt?: number;
    };
    if (!Array.isArray(parsed.events) || !parsed.syncedAt || !parsed.expiresAt || !parsed.staleAt) return null;
    const syncedAt = new Date(parsed.syncedAt);
    if (Number.isNaN(syncedAt.getTime())) return null;
    return {
      events: parsed.events,
      syncedAt,
      staleAt: parsed.staleAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function getUsableCacheEntry(cacheKey: string): CacheEntry | null {
  const now = Date.now();
  const memoryEntry = cache.get(cacheKey);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > now) return memoryEntry;
    cache.delete(cacheKey);
  }

  const sessionEntry = readSessionCacheEntry(cacheKey);
  if (!sessionEntry) return null;
  if (sessionEntry.expiresAt <= now) {
    removeSessionCacheEntry(cacheKey);
    return null;
  }

  cache.set(cacheKey, sessionEntry);
  return sessionEntry;
}

function shouldRevalidate(entry: CacheEntry | null): boolean {
  return !entry || Date.now() >= entry.staleAt;
}

function createCacheEntry(events: CalendarEvent[], syncedAt = new Date()): CacheEntry {
  const now = Date.now();
  return {
    events,
    syncedAt,
    staleAt: now + CACHE_REVALIDATE_AFTER_MS,
    expiresAt: now + CACHE_DISPLAY_TTL_MS,
  };
}

function clearSessionCache() {
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(SESSION_CACHE_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access errors.
  }
}

/** キャッシュを全クリア（削除・更新後に呼び出す） */
export function invalidateCalendarCache() {
  cache.clear();
  inflightRequests.clear();
  clearSessionCache();
}

const CALENDAR_SYNC_EVENT = 'focusmap:calendar-sync-request';
const EVENT_COMPLETION_EVENT = 'focusmap:event-completion-changed';
const CALENDAR_EVENT_TIME_UPDATE_EVENT = 'focusmap:calendar-event-time-update';
const CALENDAR_OPTIMISTIC_EVENT_ADD = 'focusmap:calendar-optimistic-event-add';
const CALENDAR_OPTIMISTIC_EVENT_REMOVE = 'focusmap:calendar-optimistic-event-remove';

/** 全 useCalendarEvents インスタンスにキャッシュ再取得を通知 */
export function broadcastCalendarSync() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CALENDAR_SYNC_EVENT));
  }
}

/** カレンダーイベントを全 useCalendarEvents インスタンスに即時追加する */
export function broadcastCalendarOptimisticEvent(event: CalendarEvent) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CALENDAR_OPTIMISTIC_EVENT_ADD, {
      detail: { event },
    }));
  }
}

/** 楽観追加したカレンダーイベントを全 useCalendarEvents インスタンスから削除する */
export function broadcastCalendarOptimisticEventRemoval(eventId: string, googleEventId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CALENDAR_OPTIMISTIC_EVENT_REMOVE, {
      detail: { eventId, googleEventId },
    }));
  }
}

/** イベント完了状態の変更を即時ブロードキャスト（API ラウンドトリップ不要） */
export function broadcastEventCompletion(eventId: string, isCompleted: boolean) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_COMPLETION_EVENT, {
      detail: { eventId, isCompleted },
    }));
  }
}

/** イベントの時刻変更を全インスタンスに即時ブロードキャスト（ドラッグ楽観UI用） */
export function broadcastCalendarEventTimeUpdate(
  eventId: string,
  startTime: string,
  endTime: string,
) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CALENDAR_EVENT_TIME_UPDATE_EVENT, {
      detail: { eventId, startTime, endTime },
    }));
  }
}

export { EVENT_COMPLETION_EVENT, CALENDAR_EVENT_TIME_UPDATE_EVENT };

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : String(error));
  return message.includes('Quota exceeded') ||
         message.includes('quota') ||
         message.includes('rate limit');
}

function buildEventsListUrl(params: URLSearchParams): string {
  // Browser fetch should stay same-origin (avoid hardcoded base URLs)
  return `/api/calendar/events/list?${params.toString()}`;
}

function sortEventsByStartTime(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
}

function mergeOptimisticEvent(events: CalendarEvent[], event: CalendarEvent): CalendarEvent[] {
  const next = events.filter(existing => {
    if (existing.id === event.id) return false;
    if (event.google_event_id && existing.google_event_id === event.google_event_id) return false;
    return true;
  });
  return sortEventsByStartTime([...next, event]);
}

function removeEvent(events: CalendarEvent[], eventId: string, googleEventId?: string): CalendarEvent[] {
  return events.filter(event => {
    if (googleEventId) return event.google_event_id !== googleEventId;
    return event.id !== eventId;
  });
}

function mergeRecentOptimisticEvents(fetchedEvents: CalendarEvent[], previousEvents: CalendarEvent[]): CalendarEvent[] {
  const now = Date.now();
  const fetchedKeys = new Set(
    fetchedEvents.map(event => `${event.calendar_id}::${event.google_event_id || event.id}`)
  );
  const survivors = previousEvents.filter(event => {
    if (event.sync_status !== 'pending' && event.sync_status !== 'confirmed') return false;

    const createdAt = new Date(event.created_at).getTime();
    if (Number.isFinite(createdAt) && now - createdAt > OPTIMISTIC_EVENT_KEEP_MS) return false;

    const key = `${event.calendar_id}::${event.google_event_id || event.id}`;
    if (fetchedKeys.has(key)) return false;
    if (event.google_event_id && fetchedEvents.some(fetched => fetched.google_event_id === event.google_event_id)) return false;
    return true;
  });

  return sortEventsByStartTime([...fetchedEvents, ...survivors]);
}

async function fetchEventsShared(
  timeMin: Date,
  timeMax: Date,
  calendarIds?: string[],
  forceSync = false
): Promise<CacheEntry> {
  const cacheKey = getCacheKey(timeMin, timeMax, calendarIds);

  // Check backoff
  if (Date.now() < quotaBackoffUntil) {
    const waitTime = Math.ceil((quotaBackoffUntil - Date.now()) / 1000);
    throw new Error(`API quota exceeded. Please wait ${waitTime} seconds before retrying.`);
  }

  // Return cache if fresh and not forced. Stale-but-usable entries are shown by
  // the hook immediately, then refreshed in the background.
  if (!forceSync) {
    const cached = getUsableCacheEntry(cacheKey);
    if (cached && Date.now() < cached.staleAt) {
      return cached;
    }
  }

  // Deduplicate in-flight requests
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const requestPromise = (async () => {
    try {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        forceSync: forceSync.toString(),
      });

      if (calendarIds && calendarIds.length > 0) {
        params.append('calendarId', calendarIds.join(','));
      }

      const url = buildEventsListUrl(params);
      console.info('[useCalendarEvents] fetching', {
        url,
        forceSync,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        calendarIds,
      });

      const response = await fetch(url);

      // 503 = トークンリフレッシュ済み、リトライ可能
      if (response.status === 503) {
        await new Promise(r => setTimeout(r, 1000));
        // Retry once
        const retryResponse = await fetch(url);
        if (!retryResponse.ok) {
          throw new Error('Failed to fetch events after token refresh');
        }
        const retryData = await retryResponse.json();
        const entry = createCacheEntry(retryData.events || []);
        writeCacheEntry(cacheKey, entry);
        return entry;
      }

      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        let errorMessage = 'Failed to fetch events';
        let errorCode: string | undefined;
        let errorReauthUrl: string | undefined;
        try {
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
            errorCode = errorData.error?.code;
            errorReauthUrl = errorData.error?.reauthUrl;
          } else {
            errorMessage = await response.text();
          }
        } catch {
          // Ignore parsing errors
        }

        // Handle quota errors with exponential backoff
        if (isQuotaError({ message: errorMessage })) {
          quotaErrorCount++;
          const backoffTime = Math.min(60000 * Math.pow(2, quotaErrorCount - 1), 300000); // Max 5 minutes
          quotaBackoffUntil = Date.now() + backoffTime;
          console.error(`[useCalendarEvents] Quota error, backing off for ${backoffTime}ms`);
        }

        const err: CalendarFetchError = new Error(errorMessage);
        if (errorCode) {
          err.code = errorCode;
        }
        if (errorReauthUrl) {
          err.reauthUrl = errorReauthUrl;
        }
        throw err;
      }

      let events: CalendarEvent[] = [];
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        events = data.events || [];
      }

      // Reset quota error count on success
      quotaErrorCount = 0;

      const entry = createCacheEntry(events);
      writeCacheEntry(cacheKey, entry);

      return entry;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export function useCalendarEvents(options: UseCalendarEventsOptions) {
  const calendarIdsKey = useMemo(() =>
    options.calendarIds ? [...options.calendarIds].sort().join(',') : '',
    [options.calendarIds]
  );

  // Stable key for timeMin/timeMax to prevent unnecessary refetches
  const timeRangeKey = useMemo(() =>
    `${options.timeMin.toISOString()}-${options.timeMax.toISOString()}`,
    [options.timeMin, options.timeMax]
  );
  const cacheKey = useMemo(
    () => getCacheKey(options.timeMin, options.timeMax, options.calendarIds),
    // calendarIds is often rebuilt as a new array with the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeRangeKey, calendarIdsKey]
  );
  const initialCacheEntry = options.enabled === false ? null : getUsableCacheEntry(cacheKey);

  const [events, setEventsState] = useState<CalendarEvent[]>(() => initialCacheEntry?.events ?? []);
  const [isLoading, setIsLoading] = useState(() => options.enabled !== false && !initialCacheEntry);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => initialCacheEntry?.syncedAt ?? null);

  const commitEvents = useCallback((
    update: SetStateAction<CalendarEvent[]>,
    cacheSource?: CacheEntry
  ) => {
    setEventsState(prev => {
      const next = typeof update === 'function'
        ? (update as (previous: CalendarEvent[]) => CalendarEvent[])(prev)
        : update;
      const existing = getUsableCacheEntry(cacheKey);
      writeCacheEntry(cacheKey, {
        events: next,
        syncedAt: cacheSource?.syncedAt ?? existing?.syncedAt ?? new Date(),
        staleAt: cacheSource?.staleAt ?? existing?.staleAt ?? Date.now() + CACHE_REVALIDATE_AFTER_MS,
        expiresAt: cacheSource?.expiresAt ?? Math.max(existing?.expiresAt ?? 0, Date.now() + CACHE_DISPLAY_TTL_MS),
      });
      return next;
    });
  }, [cacheKey]);

  const setEvents = useCallback((update: SetStateAction<CalendarEvent[]>) => {
    commitEvents(update);
  }, [commitEvents]);

  // Fetch events with proper caching
  const fetchEvents = useCallback(async (
    forceSyncOrOptions: boolean | { forceSync?: boolean; silent?: boolean } = false
  ) => {
    if (options.enabled === false) {
      setIsLoading(false);
      return;
    }

    const forceSync = typeof forceSyncOrOptions === 'boolean'
      ? forceSyncOrOptions
      : !!forceSyncOrOptions.forceSync;
    const silent = typeof forceSyncOrOptions === 'boolean'
      ? false
      : !!forceSyncOrOptions.silent;

    const cached = getUsableCacheEntry(cacheKey);
    if (!silent && !cached) {
      setIsLoading(true);
    }
    if (silent) {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const entry = await fetchEventsShared(
        options.timeMin,
        options.timeMax,
        options.calendarIds,
        forceSync
      );
      commitEvents(prev => mergeRecentOptimisticEvents(entry.events, prev), entry);
      setLastSyncedAt(entry.syncedAt);
    } catch (err) {
      setError(err as Error);
      const error = err instanceof Error ? err : new Error(String(err));
      const calendarError = error as CalendarFetchError;
      console.error('[useCalendarEvents] Error:', {
        name: error.name,
        message: error.message,
        code: calendarError.code,
        reauthUrl: calendarError.reauthUrl,
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
      if (silent) {
        setIsRefreshing(false);
      }
    }
  // calendarIds is often rebuilt as a new array with the same values, so use
  // stable primitive keys to prevent refetch loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRangeKey, calendarIdsKey, cacheKey, options.enabled, commitEvents]);

  // Initial fetch + calendarIds/timeMin/timeMax change detection. If a cached
  // entry exists, render it immediately and refresh only in the background.
  useEffect(() => {
    if (options.enabled === false) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    const cached = getUsableCacheEntry(cacheKey);
    if (cached) {
      setEventsState(cached.events);
      setLastSyncedAt(cached.syncedAt);
      setIsLoading(false);
      if (shouldRevalidate(cached)) {
        fetchEvents({ forceSync: true, silent: true });
      }
      return;
    }

    setEventsState([]);
    setLastSyncedAt(null);
    fetchEvents(false);
  }, [cacheKey, fetchEvents, options.enabled]);

  // Auto-sync while visible. Default is 120s with +/-25% jitter to avoid
  // synchronized Calendar API traffic spikes.
  useEffect(() => {
    const autoSync = options.autoSync ?? true;
    if (!autoSync || options.enabled === false) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const baseInterval = options.syncInterval ?? DEFAULT_SYNC_INTERVAL_MS;
    const nextInterval = () => {
      const jitter = 1 - SYNC_INTERVAL_JITTER_RATIO + Math.random() * SYNC_INTERVAL_JITTER_RATIO * 2;
      return Math.round(baseInterval * jitter);
    };

    const schedule = () => {
      timeout = setTimeout(() => {
        if (cancelled) return;
        const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
        if (isVisible) {
          fetchEvents({ forceSync: true, silent: true });
        }
        schedule();
      }, nextInterval());
    };

    schedule();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [options.autoSync, options.syncInterval, options.enabled, fetchEvents]);

  // Refresh on tab/window return only when the cached data is older than 60s.
  useEffect(() => {
    if (typeof window === 'undefined' || options.enabled === false) return;

    const refreshIfStale = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const cached = getUsableCacheEntry(cacheKey);
      if (shouldRevalidate(cached)) {
        fetchEvents({ forceSync: true, silent: true });
      }
    };

    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [cacheKey, fetchEvents, options.enabled]);

  // Cross-instance sync: listen for broadcast events from other panels
  useEffect(() => {
    if (typeof window === 'undefined' || options.enabled === false) return;

    const handler = () => {
      fetchEvents({ forceSync: true, silent: true });
    };

    window.addEventListener(CALENDAR_SYNC_EVENT, handler);
    return () => window.removeEventListener(CALENDAR_SYNC_EVENT, handler);
  }, [fetchEvents, options.enabled]);

  // Cross-instance optimistic event add/remove. This makes the calendar respond
  // immediately to drops/creates that happen outside the current calendar panel.
  useEffect(() => {
    if (typeof window === 'undefined' || options.enabled === false) return;

    const isInRangeAndCalendar = (event: CalendarEvent) => {
      const start = new Date(event.start_time);
      const end = new Date(event.end_time);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
      if (!(end > options.timeMin && start < options.timeMax)) return false;
      if (options.calendarIds && options.calendarIds.length > 0) {
        return options.calendarIds.includes(event.calendar_id);
      }
      return true;
    };

    const addHandler = (event: Event) => {
      const optimisticEvent = (event as CustomEvent<{ event: CalendarEvent }>).detail?.event;
      if (!optimisticEvent || !isInRangeAndCalendar(optimisticEvent)) return;

      commitEvents(prev => {
        return mergeOptimisticEvent(prev, optimisticEvent);
      });
    };

    const removeHandler = (event: Event) => {
      const { eventId, googleEventId } = (event as CustomEvent<{ eventId: string; googleEventId?: string }>).detail ?? {};
      if (!eventId) return;
      commitEvents(prev => removeEvent(prev, eventId, googleEventId));
    };

    window.addEventListener(CALENDAR_OPTIMISTIC_EVENT_ADD, addHandler);
    window.addEventListener(CALENDAR_OPTIMISTIC_EVENT_REMOVE, removeHandler);
    return () => {
      window.removeEventListener(CALENDAR_OPTIMISTIC_EVENT_ADD, addHandler);
      window.removeEventListener(CALENDAR_OPTIMISTIC_EVENT_REMOVE, removeHandler);
    };
  // See fetchEvents deps above: the stable keys intentionally stand in for the
  // Date objects and calendarIds array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRangeKey, calendarIdsKey, options.enabled]);

  // Manual sync (force refresh)
  const syncNow = useCallback((options?: { silent?: boolean }) => {
    return fetchEvents({ forceSync: true, silent: !!options?.silent });
  }, [fetchEvents]);

  // Optimistic event: add immediately to UI, then sync will replace with real data
  const addOptimisticEvent = useCallback((event: CalendarEvent) => {
    commitEvents(prev => mergeOptimisticEvent(prev, event));
  }, [commitEvents]);

  const removeOptimisticEvent = useCallback((eventId: string, googleEventId?: string) => {
    commitEvents(prev => removeEvent(prev, eventId, googleEventId));
  }, [commitEvents]);

  return {
    events,
    setEvents,
    isLoading,
    isRefreshing,
    error,
    lastSyncedAt,
    syncNow,
    refetch: fetchEvents,
    addOptimisticEvent,
    removeOptimisticEvent,
  };
}
