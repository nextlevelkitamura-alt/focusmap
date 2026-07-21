import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// 分を "Xm" / "XhYm" へ（page.tsx の formatMinutes 相当・内製）。
function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return hours > 0 ? `${hours}h${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

// 本日サマリ区画の代替（モックv2 app-head + daybar）。
// 上段=前日/翌日ナビ＋日付ラベル＋稼働/待機。下段=今日の進み細バー＋%＋実行分。コンパクト1〜2行。
export function DayHeader({
  dateLabel,
  prevHref,
  nextHref,
  progressPct,
  liveTotal,
  waitTotal,
  runMin,
}: {
  dateLabel: string;
  prevHref: string;
  nextHref: string;
  progressPct: number | null;
  liveTotal: number;
  waitTotal: number;
  runMin: number;
}) {
  const pct = progressPct === null ? null : Math.max(0, Math.min(100, progressPct));

  return (
    <header className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" asChild>
          <Link href={prevHref} aria-label="前の日へ">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-base font-semibold">{dateLabel}</span>
          <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse"
                title="稼働中"
                aria-hidden
              />
              稼働 {liveTotal}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" title="待機中" aria-hidden />
              待機 {waitTotal}
            </span>
          </span>
        </div>

        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" asChild>
          <Link href={nextHref} aria-label="次の日へ">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {pct !== null ? (
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span className="shrink-0">今日の進み</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
          <span className={cn('shrink-0 font-bold', pct >= 100 ? 'text-emerald-600' : 'text-blue-700 dark:text-blue-300')}>
            {pct}%
          </span>
          <span className="shrink-0">実行 {formatMinutes(runMin)}</span>
        </div>
      ) : null}
    </header>
  );
}
