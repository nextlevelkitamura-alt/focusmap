import { useState, useCallback } from 'react';
import { WorkingHours } from '@/lib/time-utils';

/**
 * 空き時間スロット
 */
export interface FreeSlot {
  start: Date;
  end: Date;
  duration: number; // 分単位
}

/**
 * 空き時間検索用フック
 */
export function useFreeTimeSlots() {
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 空き時間を検索
   */
  const findFreeSlots = useCallback(async (
    date: Date,
    duration: number,
    workingHours?: WorkingHours
  ): Promise<FreeSlot[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/find-free-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date.toISOString(),
          duration,
          workingHours
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to find free time');
      }

      const data = await response.json();
      const freeSlots = data.freeSlots.map((slot: any) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
        duration: slot.duration
      }));

      setSlots(freeSlots);
      return freeSlots;
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    slots,
    isLoading,
    error,
    findFreeSlots
  };
}
