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
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const STARTUP_CACHE_TTL = 12 * 60 * 60 * 1000;
const CALENDAR_SELECTION_STORAGE_KEY = 'calendar-selection';
const CALENDAR_LIST_STORAGE_KEY = 'focusmap:calendars:list';
const listeners = new Set<(calendars: UserCalendar[]) => void>();

type CalendarListCachePayload = {
  calendars?: UserCalendar[];
  cachedAt?: number;
};

function readStoredCalendarList(): { calendars: UserCalendar[]; cachedAt: number } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CALENDAR_LIST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalendarListCachePayload;
    if (!Array.isArray(parsed.calendars) || typeof parsed.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > STARTUP_CACHE_TTL) return null;
    return { calendars: parsed.calendars, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

function readStoredSelectedCalendarIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CALENDAR_SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return Object.entries(parsed)
      .filter(([, selected]) => selected)
      .map(([calendarId]) => calendarId);
  } catch {
    return [];
  }
}

function writeStoredCalendars(calendars: UserCalendar[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CALENDAR_LIST_STORAGE_KEY, JSON.stringify({
      calendars,
      cachedAt: Date.now(),
    }));
    localStorage.setItem(CALENDAR_SELECTION_STORAGE_KEY, JSON.stringify(
      calendars.reduce((acc: Record<string, boolean>, cal: UserCalendar) => {
        acc[cal.google_calendar_id] = cal.selected;
        return acc;
      }, {})
    ));
  } catch {
    // Ignore localStorage errors.
  }
}

const storedCalendarList = readStoredCalendarList();
let cachedCalendars: UserCalendar[] | null = storedCalendarList?.calendars ?? null;
let cachedSelectedCalendarIds = cachedCalendars
  ? cachedCalendars.filter(c => c.selected).map(c => c.google_calendar_id)
  : readStoredSelectedCalendarIds();
let cacheTimestamp = storedCalendarList?.cachedAt ?? 0;
let inflight: Promise<UserCalendar[]> | null = null;
let inflightForceSync = false;

function notifyListeners(calendars: UserCalendar[]) {
  listeners.forEach(fn => fn(calendars));
}

async function fetchCalendarsShared(forceSync: boolean): Promise<UserCalendar[]> {
  // Return cache if fresh and not forced
  if (!forceSync && cachedCalendars && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedCalendars;
  }

  // Deduplicate in-flight requests
  if (inflight && (!forceSync || inflightForceSync)) return inflight;
  inflightForceSync = forceSync;

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
      cachedSelectedCalendarIds = calendars
        .filter(cal => cal.selected)
        .map(cal => cal.google_calendar_id);
      cacheTimestamp = Date.now();
      notifyListeners(calendars);
      writeStoredCalendars(calendars);

      return calendars;
    } finally {
      inflight = null;
      inflightForceSync = false;
    }
  })();

  return inflight;
}

export function invalidateCalendarsCache() {
  cachedCalendars = null;
  cachedSelectedCalendarIds = [];
  cacheTimestamp = 0;
  inflight = null;
  inflightForceSync = false;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CALENDAR_LIST_STORAGE_KEY);
      localStorage.removeItem(CALENDAR_SELECTION_STORAGE_KEY);
    } catch {
      // Ignore localStorage errors.
    }
  }
  notifyListeners([]);
}

/**
 * カレンダーリストの管理用フック（モジュールレベルキャッシュで高速化）
 */
export function useCalendars() {
  const [calendars, setCalendars] = useState<UserCalendar[]>(cachedCalendars || []);
  const [isLoading, setIsLoading] = useState(!cachedCalendars && cachedSelectedCalendarIds.length === 0);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to cache updates from other instances
  useEffect(() => {
    const listener = (cals: UserCalendar[]) => setCalendars(cals);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  // カレンダーリストを取得
  const fetchCalendars = useCallback(async (forceSync = false) => {
    const hasLocalCalendarData = calendars.length > 0 || cachedSelectedCalendarIds.length > 0;
    setIsLoading(!hasLocalCalendarData);
    setError(null);

    try {
      const result = await fetchCalendarsShared(forceSync);
      setCalendars(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [calendars.length]);

  // 初回取得（キャッシュがあれば即座に返る）
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  // Startup cache is only for first paint. Revalidate against Google in the
  // background so removed/hidden calendars do not linger for the full TTL.
  useEffect(() => {
    if (!cachedCalendars || cachedCalendars.length === 0) return;
    let cancelled = false;
    fetchCalendarsShared(true)
      .then(result => {
        if (!cancelled) setCalendars(result);
      })
      .catch(err => {
        if (!cancelled) setError(err as Error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // カレンダーの表示/非表示を切り替え
  const toggleCalendar = useCallback(async (id: string, selected: boolean) => {
    // Optimistic Update (local + cache)
    const updateFn = (cals: UserCalendar[]) => cals.map(cal =>
      cal.id === id ? { ...cal, selected } : cal
    );
    setCalendars(updateFn);
    if (cachedCalendars) {
      cachedCalendars = updateFn(cachedCalendars);
      cachedSelectedCalendarIds = cachedCalendars
        .filter(cal => cal.selected)
        .map(cal => cal.google_calendar_id);
      writeStoredCalendars(cachedCalendars);
    }

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
      if (cachedCalendars) {
        cachedCalendars = rollbackFn(cachedCalendars);
        cachedSelectedCalendarIds = cachedCalendars
          .filter(cal => cal.selected)
          .map(cal => cal.google_calendar_id);
        writeStoredCalendars(cachedCalendars);
      }
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
    if (cachedCalendars) {
      cachedCalendars = updateFn(cachedCalendars);
      cachedSelectedCalendarIds = cachedCalendars
        .filter(cal => cal.selected)
        .map(cal => cal.google_calendar_id);
      writeStoredCalendars(cachedCalendars);
    }

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
  const effectiveSelectedCalendarIds = calendars.length > 0
    ? selectedCalendarIds
    : cachedSelectedCalendarIds;

  return {
    calendars,
    isLoading,
    error,
    fetchCalendars,
    toggleCalendar,
    toggleAll,
    selectedCalendarIds: effectiveSelectedCalendarIds
  };
}
