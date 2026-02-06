import { useState, useEffect, useCallback } from 'react';
import type { NotificationSetting } from '@/types/calendar';

interface UseNotificationSettingsReturn {
  settings: NotificationSetting[];
  isLoading: boolean;
  error: Error | null;
  updateSetting: (notificationType: string, updates: Partial<NotificationSetting>) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // 設定取得
  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/notifications/settings');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch settings');
      }

      const data = await response.json();
      setSettings(data.settings || []);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch notification settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // 設定更新
  const updateSetting = useCallback(async (
    notificationType: string,
    updates: Partial<NotificationSetting>
  ) => {
    // Optimistic Update
    const prevSettings = [...settings];
    setSettings(prev => prev.map(setting =>
      setting.notification_type === notificationType
        ? { ...setting, ...updates }
        : setting
    ));

    try {
      const response = await fetch('/api/notifications/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationType, ...updates })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update setting');
      }
    } catch (err) {
      // Rollback
      setSettings(prevSettings);
      setError(err as Error);
      throw err;
    }
  }, [settings]);

  return {
    settings,
    isLoading,
    error,
    updateSetting,
    refetch: fetchSettings
  };
}
