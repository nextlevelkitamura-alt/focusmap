import { useState, useCallback } from 'react';
import { Database } from '@/types/database';

type Task = Database['public']['Tables']['tasks']['Row'];

/**
 * タスクのスケジュール管理用フック
 */
export function useTaskScheduling() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * タスクをカレンダーにスケジュール
   */
  const scheduleTask = useCallback(async (
    taskId: string,
    scheduledAt: Date,
    calendarId?: string,
    createCalendarEvent = true
  ): Promise<{ task: Task; eventId?: string }> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: scheduledAt.toISOString(),
          calendarId,
          createCalendarEvent
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to schedule task');
      }

      const data = await response.json();
      return {
        task: data.task,
        eventId: data.event?.id
      };
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * タスクのスケジュールを解除
   */
  const unscheduleTask = useCallback(async (
    taskId: string,
    deleteCalendarEvent = true
  ): Promise<Task> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/schedule`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteCalendarEvent })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to unschedule task');
      }

      const data = await response.json();
      return data.task;
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * タスクの所要時間を設定
   */
  const setTaskDuration = useCallback(async (
    taskId: string,
    estimatedDuration: number
  ): Promise<Task> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/time`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedDuration })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to set task duration');
      }

      const data = await response.json();
      return data.task;
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    scheduleTask,
    unscheduleTask,
    setTaskDuration,
    isLoading,
    error
  };
}
