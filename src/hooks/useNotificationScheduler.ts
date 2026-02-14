import { useCallback } from 'react';

interface ScheduleNotificationInput {
  targetType: 'task' | 'event';
  targetId: string;
  notificationType: 'task_start' | 'task_due' | 'event_start';
  scheduledAt: Date;
  title: string;
  body: string;
  actionUrl?: string;
}

interface UseNotificationSchedulerReturn {
  scheduleNotification: (input: ScheduleNotificationInput) => Promise<string | null>;
  cancelNotifications: (targetType: 'task' | 'event', targetId: string) => Promise<number>;
}

export function useNotificationScheduler(): UseNotificationSchedulerReturn {
  const scheduleNotification = useCallback(async (input: ScheduleNotificationInput) => {
    try {
      const response = await fetch('/api/notifications/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          scheduledAt: input.scheduledAt.toISOString()
        })
      });

      if (!response.ok) {
        // notification_queueテーブル未作成等のエラーは警告のみでスキップ
        console.warn('[Notification] Schedule failed:', response.status);
        return null;
      }

      const data = await response.json();
      return data.notificationId;
    } catch (error) {
      console.warn('[Notification] Schedule error (non-blocking):', error);
      return null;
    }
  }, []);

  const cancelNotifications = useCallback(async (
    targetType: 'task' | 'event',
    targetId: string
  ) => {
    try {
      const response = await fetch('/api/notifications/cancel', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId })
      });

      if (!response.ok) {
        // notification_queueテーブル未作成等のエラーは警告のみでスキップ
        console.warn('[Notification] Cancel failed:', response.status);
        return 0;
      }

      const data = await response.json();
      return data.canceledCount;
    } catch (error) {
      console.warn('[Notification] Cancel error (non-blocking):', error);
      return 0;
    }
  }, []);

  return {
    scheduleNotification,
    cancelNotifications
  };
}
