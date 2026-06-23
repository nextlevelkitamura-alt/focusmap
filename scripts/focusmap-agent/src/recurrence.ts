const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseCronNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function partMatches(value: number, part: string): boolean {
  if (part === '*') return true;
  const values = part.split(',').map(parseCronNumber);
  return values.some(item => item === value);
}

export function getNextScheduledAt(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpr}`);

  const [minutePart, hourPart, , , dowPart] = parts;
  const cursor = new Date(from.getTime() + ONE_MINUTE_MS);
  cursor.setSeconds(0, 0);
  const limit = new Date(from.getTime() + 8 * ONE_DAY_MS);

  while (cursor < limit) {
    const minute = cursor.getMinutes();
    const hour = cursor.getHours();
    const dow = cursor.getDay();

    if (
      partMatches(minute, minutePart) &&
      partMatches(hour, hourPart) &&
      partMatches(dow, dowPart)
    ) {
      return new Date(cursor);
    }
    cursor.setTime(cursor.getTime() + ONE_MINUTE_MS);
  }

  throw new Error(`Could not compute next run for cron: ${cronExpr}`);
}

export function nextScheduledAtOrDailyFallback(cronExpr: string, from: Date): {
  nextScheduledAt: Date;
  fallbackReason?: string;
} {
  try {
    return { nextScheduledAt: getNextScheduledAt(cronExpr, from) };
  } catch (error) {
    return {
      nextScheduledAt: new Date(from.getTime() + ONE_DAY_MS),
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}
