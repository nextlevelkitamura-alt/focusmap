import { useState, useEffect, useCallback } from 'react';
import { CalendarEvent } from '@/types/calendar';

interface UseCalendarEventsOptions {
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[];
  autoSync?: boolean;
  syncInterval?: number;  // ミリ秒（デフォルト: 300000 = 5分）
}

export function useCalendarEvents(options: UseCalendarEventsOptions) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // イベント取得（常に forceSync=true で Google Calendar API から最新のイベントを取得）
  const fetchEvents = useCallback(async (forceSync = true) => {
    console.log('[useCalendarEvents] Fetching events with calendarIds:', options.calendarIds, 'forceSync:', forceSync);
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        forceSync: forceSync.toString(),
      });

      if (options.calendarIds && options.calendarIds.length > 0) {
        params.append('calendarId', options.calendarIds.join(','));
        console.log('[useCalendarEvents] Added calendarId param:', options.calendarIds.join(','));
      } else {
        console.log('[useCalendarEvents] No calendarIds specified, fetching all events');
      }

      console.log('[useCalendarEvents] Fetching URL:', `/api/calendar/events/list?${params}`);

      const response = await fetch(`/api/calendar/events/list?${params}`);

      console.log('[useCalendarEvents] Response status:', response.status);

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
        console.error('[useCalendarEvents] Error response:', errorMessage);
        throw new Error(errorMessage);
      }

      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        console.log('[useCalendarEvents] Received events:', data.events?.length || 0);
        setEvents(data.events || []);
        setLastSyncedAt(new Date(data.syncedAt));
      } else {
        // Fallback or empty
        console.log('[useCalendarEvents] Non-JSON response');
        setEvents([]);
      }
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch calendar events:', err);
    } finally {
      setIsLoading(false);
    }
  }, [options.timeMin, options.timeMax, options.calendarIds]);

  // calendarIds の変更を監視して再取得
  useEffect(() => {
    console.log('[useCalendarEvents] calendarIds changed, refetching...');
    fetchEvents();
  }, [options.calendarIds]); // calendarIds 自体を依存配列に追加

  // 自動同期
  useEffect(() => {
    if (!options.autoSync) return;

    const interval = setInterval(
      () => fetchEvents(),
      options.syncInterval || 300000
    );

    return () => clearInterval(interval);
  }, [fetchEvents, options.autoSync, options.syncInterval]);

  // 手動同期
  const syncNow = useCallback(() => {
    return fetchEvents(true);
  }, [fetchEvents]);

  return {
    events,
    setEvents,
    isLoading,
    error,
    lastSyncedAt,
    syncNow,
    refetch: fetchEvents
  };
}
