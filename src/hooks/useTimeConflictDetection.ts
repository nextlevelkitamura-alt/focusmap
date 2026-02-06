import { useMemo } from 'react';
import { Database } from '@/types/database';

type Task = Database['public']['Tables']['tasks']['Row'];
import { CalendarEvent } from '@/types/calendar';
import { isSameDay } from 'date-fns';
import { isOverlapping } from '@/lib/time-utils';

/**
 * 時間の重複情報
 */
export interface TimeConflict {
  time: Date;
  items: Array<{
    type: 'task' | 'event';
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
  }>;
}

/**
 * 時間の重複検出用フック
 */
export function useTimeConflictDetection(
  tasks: Task[],
  events: CalendarEvent[]
) {
  const conflicts = useMemo(() => {
    const conflictMap = new Map<string, TimeConflict>();

    // スケジュール済みタスクを追加
    tasks.forEach(task => {
      if (!task.scheduled_at || task.estimated_time <= 0) return;

      const startTime = new Date(task.scheduled_at);
      const endTime = new Date(startTime.getTime() + task.estimated_time * 60 * 1000);

      const key = `${startTime.toISOString()}-${endTime.toISOString()}`;

      if (!conflictMap.has(key)) {
        conflictMap.set(key, {
          time: startTime,
          items: []
        });
      }

      conflictMap.get(key)!.items.push({
        type: 'task',
        id: task.id,
        title: task.title,
        startTime,
        endTime
      });
    });

    // カレンダーイベントを追加
    events.forEach(event => {
      const startTime = new Date(event.start_time);
      const endTime = new Date(event.end_time);

      const key = `${startTime.toISOString()}-${endTime.toISOString()}`;

      if (!conflictMap.has(key)) {
        conflictMap.set(key, {
          time: startTime,
          items: []
        });
      }

      conflictMap.get(key)!.items.push({
        type: 'event',
        id: event.id,
        title: event.title,
        startTime,
        endTime
      });
    });

    // 重複チェック（同じ時間帯にあるアイテムをグループ化）
    const actualConflicts: TimeConflict[] = [];
    const checkedKeys = new Set<string>();

    for (const [key1, conflict1] of conflictMap.entries()) {
      if (checkedKeys.has(key1)) continue;

      const group = [...conflict1.items];
      checkedKeys.add(key1);

      // 他の時間帯と重複しているかチェック
      for (const [key2, conflict2] of conflictMap.entries()) {
        if (key1 === key2 || checkedKeys.has(key2)) continue;

        const item1 = conflict1.items[0];
        const item2 = conflict2.items[0];

        if (isOverlapping(
          { start: item1.startTime, end: item1.endTime },
          { start: item2.startTime, end: item2.endTime }
        )) {
          group.push(...conflict2.items);
          checkedKeys.add(key2);
        }
      }

      // 重複がある場合のみ追加
      if (group.length > 1) {
        // 重複している全てのアイテムの時間範囲を計算
        const allStartTimes = group.map(item => item.startTime.getTime());
        const allEndTimes = group.map(item => item.endTime.getTime());
        const minStart = Math.min(...allStartTimes);
        const maxEnd = Math.max(...allEndTimes);

        actualConflicts.push({
          time: new Date(minStart),
          items: group
        });
      }
    }

    // 時刻順にソート
    return actualConflicts.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [tasks, events]);

  return {
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}
