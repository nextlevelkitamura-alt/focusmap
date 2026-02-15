'use client';

import { useState, useCallback, useEffect } from 'react';

export interface UserCalendar {
  id: string;
  user_id: string;
  google_calendar_id: string;
  name: string;
  description: string | null;
  location: string | null;
  timezone: string;
  color: string | null;
  background_color: string | null;
  selected: boolean;
  access_level: string | null;
  is_primary: boolean;
  google_created_at: string | null;
  google_updated_at: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

// --- Module-level cache (shared across all hook instances) ---
let cachedCalendars: UserCalendar[] | null = null;
let cacheTimestamp = 0;
let inflight: Promise<UserCalendar[]> | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const listeners = new Set<(calendars: UserCalendar[]) => void>();

function notifyListeners(calendars: UserCalendar[]) {
  listeners.forEach(fn => fn(calendars));
}

async function fetchCalendarsShared(forceSync: boolean): Promise<UserCalendar[]> {
  // Return cache if fresh and not forced
  if (!forceSync && cachedCalendars && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedCalendars;
  }

  // Deduplicate in-flight requests
  if (inflight && !forceSync) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch(`/api/calendars${forceSync ? '?forceSync=true' : ''}`);
      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        let errorMessage = 'Failed to fetch calendars';
        try {
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } else {
            errorMessage = await response.text();
          }
        } catch {
          // Ignore parsing mismatch
        }
        throw new Error(errorMessage);
      }

      let data = { calendars: [] as UserCalendar[] };
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
      }

      const calendars = data.calendars || [];
      cachedCalendars = calendars;
      cacheTimestamp = Date.now();
      notifyListeners(calendars);

      // Save to localStorage
      try {
        localStorage.setItem('calendar-selection', JSON.stringify(
          calendars.reduce((acc: Record<string, boolean>, cal: UserCalendar) => {
            acc[cal.google_calendar_id] = cal.selected;
            return acc;
          }, {})
        ));
      } catch {
        // Ignore localStorage errors
      }

      return calendars;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * カレンダーリストの管理用フック（モジュールレベルキャッシュで高速化）
 */
export function useCalendars() {
  const [calendars, setCalendars] = useState<UserCalendar[]>(cachedCalendars || []);
  const [isLoading, setIsLoading] = useState(!cachedCalendars);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to cache updates from other instances
  useEffect(() => {
    const listener = (cals: UserCalendar[]) => setCalendars(cals);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  // カレンダーリストを取得
  const fetchCalendars = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchCalendarsShared(forceSync);
      setCalendars(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回取得（キャッシュがあれば即座に返る）
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  // カレンダーの表示/非表示を切り替え
  const toggleCalendar = useCallback(async (id: string, selected: boolean) => {
    // Optimistic Update (local + cache)
    const updateFn = (cals: UserCalendar[]) => cals.map(cal =>
      cal.id === id ? { ...cal, selected } : cal
    );
    setCalendars(updateFn);
    if (cachedCalendars) cachedCalendars = updateFn(cachedCalendars);

    try {
      const response = await fetch(`/api/calendars/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle calendar');
      }
    } catch (err) {
      // Rollback (local + cache)
      const rollbackFn = (cals: UserCalendar[]) => cals.map(cal =>
        cal.id === id ? { ...cal, selected: !selected } : cal
      );
      setCalendars(rollbackFn);
      if (cachedCalendars) cachedCalendars = rollbackFn(cachedCalendars);
      setError(err as Error);
      throw err;
    }
  }, []);

  // 全選択/全解除
  const toggleAll = useCallback(async (selected: boolean) => {
    const prevCalendars = cachedCalendars ? [...cachedCalendars] : calendars;

    // Optimistic Update (local + cache)
    const updateFn = (cals: UserCalendar[]) => cals.map(cal => ({ ...cal, selected }));
    setCalendars(updateFn);
    if (cachedCalendars) cachedCalendars = updateFn(cachedCalendars);

    try {
      await Promise.all(
        prevCalendars.map(cal =>
          fetch(`/api/calendars/${cal.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selected })
          })
        )
      );
    } catch (err) {
      // Rollback
      fetchCalendars(true);
      setError(err as Error);
    }
  }, [calendars, fetchCalendars]);

  // 選択されたカレンダーのIDリストを返す
  const selectedCalendarIds = calendars
    .filter(c => c.selected)
    .map(c => c.google_calendar_id);

  return {
    calendars,
    isLoading,
    error,
    fetchCalendars,
    toggleCalendar,
    toggleAll,
    selectedCalendarIds
  };
}
