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

  // イベント取得
  const fetchEvents = useCallback(async (forceSync = false) => {
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
      }

      const response = await fetch(`/api/calendar/events/list?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch events');
      }

      const data = await response.json();
      setEvents(data.events || []);
      setLastSyncedAt(new Date(data.syncedAt));
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch calendar events:', err);
    } finally {
      setIsLoading(false);
    }
  }, [options.timeMin, options.timeMax, options.calendarIds]);

  // 自動同期
  useEffect(() => {
    if (!options.autoSync) return;

    fetchEvents();
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
    isLoading,
    error,
    lastSyncedAt,
    syncNow,
    refetch: fetchEvents
  };
}
