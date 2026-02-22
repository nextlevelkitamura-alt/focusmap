'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CalendarEvent } from '@/types/calendar';

interface UseCalendarEventsOptions {
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[];
  autoSync?: boolean;
  syncInterval?: number;  // ミリ秒（デフォルト: 600000 = 10分）
}

// --- Module-level cache (shared across all hook instances) ---
interface CacheEntry {
  events: CalendarEvent[];
  syncedAt: Date;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes（ゴーストイベント残留を最小化）
const inflightRequests = new Map<string, Promise<CalendarEvent[]>>();

// Backoff state for quota errors
let quotaErrorCount = 0;
let quotaBackoffUntil = 0;

function getCacheKey(timeMin: Date, timeMax: Date, calendarIds?: string[]): string {
  const ids = calendarIds && calendarIds.length > 0 ? calendarIds.sort().join(',') : 'primary';
  return `${timeMin.toISOString()}-${timeMax.toISOString()}-${ids}`;
}

/** キャッシュを全クリア（削除・更新後に呼び出す） */
export function invalidateCalendarCache() {
  cache.clear();
  inflightRequests.clear();
}

function isQuotaError(error: any): boolean {
  return error?.message?.includes('Quota exceeded') ||
         error?.message?.includes('quota') ||
         error?.message?.includes('rate limit');
}

async function fetchEventsShared(
  timeMin: Date,
  timeMax: Date,
  calendarIds?: string[],
  forceSync = false
): Promise<CalendarEvent[]> {
  const cacheKey = getCacheKey(timeMin, timeMax, calendarIds);

  // Check backoff
  if (Date.now() < quotaBackoffUntil) {
    const waitTime = Math.ceil((quotaBackoffUntil - Date.now()) / 1000);
    throw new Error(`API quota exceeded. Please wait ${waitTime} seconds before retrying.`);
  }

  // Return cache if fresh and not forced
  if (!forceSync) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.events;
    }
  }

  // Deduplicate in-flight requests
  const inflight = inflightRequests.get(cacheKey);
  if (inflight && !forceSync) {
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

      const response = await fetch(`/api/calendar/events/list?${params}`);

      // 503 = トークンリフレッシュ済み、リトライ可能
      if (response.status === 503) {
        await new Promise(r => setTimeout(r, 1000));
        // Retry once
        const retryResponse = await fetch(`/api/calendar/events/list?${params}`);
        if (!retryResponse.ok) {
          throw new Error('Failed to fetch events after token refresh');
        }
        const retryData = await retryResponse.json();
        return retryData.events || [];
      }

      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        let errorMessage = 'Failed to fetch events';
        try {
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
          } else {
            errorMessage = await response.text();
          }
        } catch (e) {
          // Ignore parsing errors
        }

        // Handle quota errors with exponential backoff
        if (isQuotaError({ message: errorMessage })) {
          quotaErrorCount++;
          const backoffTime = Math.min(60000 * Math.pow(2, quotaErrorCount - 1), 300000); // Max 5 minutes
          quotaBackoffUntil = Date.now() + backoffTime;
          console.error(`[useCalendarEvents] Quota error, backing off for ${backoffTime}ms`);
        }

        throw new Error(errorMessage);
      }

      let events: CalendarEvent[] = [];
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        events = data.events || [];
      }

      // Reset quota error count on success
      quotaErrorCount = 0;

      // Update cache
      cache.set(cacheKey, {
        events,
        syncedAt: new Date(),
        expiresAt: Date.now() + CACHE_TTL
      });

      return events;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export function useCalendarEvents(options: UseCalendarEventsOptions) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Use ref to track previous calendarIds to prevent unnecessary refetches
  const prevCalendarIdsRef = useRef<string>();
  const calendarIdsKey = useMemo(() =>
    options.calendarIds?.sort().join(',') || '',
    [options.calendarIds]
  );

  // Stable key for timeMin/timeMax to prevent unnecessary refetches
  const timeRangeKey = useMemo(() =>
    `${options.timeMin.toISOString()}-${options.timeMax.toISOString()}`,
    [options.timeMin, options.timeMax]
  );

  // Fetch events with proper caching
  const fetchEvents = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchEventsShared(
        options.timeMin,
        options.timeMax,
        options.calendarIds,
        forceSync
      );
      setEvents(result);
      setLastSyncedAt(new Date());
    } catch (err) {
      setError(err as Error);
      console.error('[useCalendarEvents] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [timeRangeKey, calendarIdsKey]);

  // Initial fetch + calendarIds/timeMin/timeMax change detection
  useEffect(() => {
    fetchEvents(false); // Use cache first
  }, [fetchEvents]);

  // Auto-sync (10 minutes interval by default)
  useEffect(() => {
    if (!options.autoSync) return;

    const interval = setInterval(
      () => {
        fetchEvents(false); // Use cache first, only fetch if expired
      },
      options.syncInterval || 600000 // 10 minutes
    );

    return () => clearInterval(interval);
  }, [options.autoSync, options.syncInterval, fetchEvents]);

  // Manual sync (force refresh)
  const syncNow = useCallback(() => {
    return fetchEvents(true);
  }, [fetchEvents]);

  // Optimistic event: add immediately to UI, then sync will replace with real data
  const addOptimisticEvent = useCallback((event: CalendarEvent) => {
    setEvents(prev => [...prev, event]);
  }, []);

  const removeOptimisticEvent = useCallback((eventId: string, googleEventId?: string) => {
    setEvents(prev => prev.filter(e => {
      // googleEventId が指定された場合はそれで削除、そうでなければ eventId で削除
      if (googleEventId) return e.google_event_id !== googleEventId;
      return e.id !== eventId;
    }));
  }, []);

  return {
    events,
    setEvents,
    isLoading,
    error,
    lastSyncedAt,
    syncNow,
    refetch: fetchEvents,
    addOptimisticEvent,
    removeOptimisticEvent,
  };
}
