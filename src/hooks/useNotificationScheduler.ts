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
    const response = await fetch('/api/notifications/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        scheduledAt: input.scheduledAt.toISOString()
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to schedule notification');
    }

    const data = await response.json();
    return data.notificationId;
  }, []);

  const cancelNotifications = useCallback(async (
    targetType: 'task' | 'event',
    targetId: string
  ) => {
    const response = await fetch('/api/notifications/cancel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to cancel notifications');
    }

    const data = await response.json();
    return data.canceledCount;
  }, []);

  return {
    scheduleNotification,
    cancelNotifications
  };
}
