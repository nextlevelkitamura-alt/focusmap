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

/**
 * カレンダーリストの管理用フック
 */
export function useCalendars() {
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // カレンダーリストを取得
  const fetchCalendars = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

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
        } catch (e) {
          // Ignore parsing mismatch
        }
        throw new Error(errorMessage);
      }

      let data = { calendars: [] };
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
      }
      setCalendars(data.calendars || []);

      // ローカルストレージにも保存
      try {
        localStorage.setItem('calendar-selection', JSON.stringify(
          data.calendars.reduce((acc: Record<string, boolean>, cal: UserCalendar) => {
            acc[cal.google_calendar_id] = cal.selected;
            return acc;
          }, {})
        ));
      } catch (e) {
        // ローカルストレージへの保存は失敗しても無視
        console.warn('Failed to save calendar selection to localStorage:', e);
      }
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回取得
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  // カレンダーの表示/非表示を切り替え
  const toggleCalendar = useCallback(async (id: string, selected: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal =>
      cal.id === id ? { ...cal, selected } : cal
    ));

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

      // ローカルストレージを更新
      try {
        const stored = JSON.parse(localStorage.getItem('calendar-selection') || '{}');
        const calendar = calendars.find(c => c.id === id);
        if (calendar) {
          stored[calendar.google_calendar_id] = selected;
          localStorage.setItem('calendar-selection', JSON.stringify(stored));
        }
      } catch (e) {
        console.warn('Failed to update localStorage:', e);
      }
    } catch (err) {
      // Rollback
      setCalendars(prev => prev.map(cal =>
        cal.id === id ? { ...cal, selected: !selected } : cal
      ));
      setError(err as Error);
      throw err;
    }
  }, [calendars]);

  // 全選択/全解除
  const toggleAll = useCallback(async (selected: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal => ({ ...cal, selected })));

    try {
      // 各カレンダーを個別に更新
      await Promise.all(
        calendars.map(cal =>
          fetch(`/api/calendars/${cal.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selected })
          })
        )
      );

      // ローカルストレージを更新
      try {
        const stored = calendars.reduce((acc, cal) => {
          acc[cal.google_calendar_id] = selected;
          return acc;
        }, {} as Record<string, boolean>);
        localStorage.setItem('calendar-selection', JSON.stringify(stored));
      } catch (e) {
        console.warn('Failed to update localStorage:', e);
      }
    } catch (err) {
      // Rollback
      fetchCalendars();
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
