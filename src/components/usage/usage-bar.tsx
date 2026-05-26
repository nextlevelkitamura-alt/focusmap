'use client';

import { Progress } from '@/components/ui/progress';
import type { UsageInfo } from '@/lib/usage-guard';
import {
  formatExecutionRatio,
  formatPercent,
  getUsageBarColor,
  getUsageTextColor,
} from '@/lib/format';

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

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className={textColor}>
          {isInfinite ? '無制限' : formatExecutionRatio(usage.executions, usage.limit)}
        </span>
      </div>
      <Progress
        value={ratio * 100}
        indicatorClassName={isInfinite ? 'bg-emerald-500' : barColor}
      />
      {!compact && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {isInfinite ? '' : `${formatPercent(ratio, 0)} 使用`}
          </span>
          <span>あと {usage.daysUntilReset}日でリセット</span>
        </div>
      )}
    </div>
  );
}
