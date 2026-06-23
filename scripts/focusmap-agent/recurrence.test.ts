import { describe, expect, test } from 'vitest';
import { getNextScheduledAt, nextScheduledAtOrDailyFallback } from './src/recurrence';

describe('focusmap-agent recurrence schedule', () => {
  test('computes the next local minute/hour match after the current minute', () => {
    const next = getNextScheduledAt(
      '30 9 * * *',
      new Date(2026, 5, 23, 9, 29, 10),
    );
    expect([
      next.getFullYear(),
      next.getMonth(),
      next.getDate(),
      next.getHours(),
      next.getMinutes(),
      next.getSeconds(),
    ]).toEqual([2026, 5, 23, 9, 30, 0]);
  });

  test('supports comma-separated day-of-week values', () => {
    const next = getNextScheduledAt(
      '0 9 * * 1,3',
      new Date(2026, 5, 23, 9, 30, 0),
    );
    expect([next.getDay(), next.getHours(), next.getMinutes()]).toEqual([3, 9, 0]);
  });

  test('falls back to the next day when cron parsing fails', () => {
    expect(nextScheduledAtOrDailyFallback(
      'bad cron',
      new Date(2026, 5, 23, 9, 30, 0),
    )).toEqual({
      nextScheduledAt: new Date(2026, 5, 24, 9, 30, 0),
      fallbackReason: 'Invalid cron expression: bad cron',
    });
  });
});
