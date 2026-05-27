'use client';

import { Progress } from '@/components/ui/progress';
import type { UsageInfo } from '@/lib/usage-guard';
import {
  formatExecutionRatio,
  formatPercent,
  getUsageBarColor,
  getUsageTextColor,
} from '@/lib/format';
import { AlertTriangle, AlertCircle, Infinity as InfinityIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UsageBarProps {
  label: string;
  usage: UsageInfo;
  compact?: boolean;
}

export function UsageBar({ label, usage, compact }: UsageBarProps) {
  const ratio = usage.ratio;
  const barColor = getUsageBarColor(ratio);
  const textColor = getUsageTextColor(ratio);
  const isInfinite = !isFinite(usage.limit);
  const remaining = isInfinite ? Infinity : Math.max(0, usage.limit - usage.executions);

  const isCritical = !isInfinite && ratio >= 0.95;
  const isWarning = !isInfinite && ratio >= 0.8 && ratio < 0.95;

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 font-medium text-foreground">
          {label}
          {isCritical && <AlertCircle className="h-3 w-3 text-red-500 animate-pulse" />}
          {isWarning && <AlertTriangle className="h-3 w-3 text-amber-500" />}
        </span>
        <span className={cn('tabular-nums', textColor)}>
          {isInfinite ? (
            <span className="inline-flex items-center gap-0.5">
              <InfinityIcon className="h-3 w-3" />
              無制限
            </span>
          ) : (
            formatExecutionRatio(usage.executions, usage.limit)
          )}
        </span>
      </div>
      <Progress
        value={Math.min(ratio * 100, 100)}
        indicatorClassName={cn(
          isInfinite ? 'bg-emerald-500' : barColor,
          'transition-all duration-500',
        )}
      />
      {!compact && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className={cn('tabular-nums', isCritical && 'font-medium text-red-600 dark:text-red-400')}>
            {isInfinite
              ? ''
              : remaining === 0
              ? '⛔ 残量なし'
              : `残り ${remaining} 回 (${formatPercent(ratio, 0)} 使用)`}
          </span>
          <span>あと {usage.daysUntilReset}日でリセット</span>
        </div>
      )}
    </div>
  );
}
