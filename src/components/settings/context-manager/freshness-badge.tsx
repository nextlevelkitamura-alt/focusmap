'use client'

import type { FreshnessStatus } from '@/lib/ai/context/freshness'

interface FreshnessBadgeProps {
  status: FreshnessStatus | string
  daysSinceUpdate: number
  compact?: boolean
}

const STATUS_CONFIG: Record<string, { dot: string; label: string; textColor: string }> = {
  fresh: { dot: 'bg-green-500', label: '新鮮', textColor: 'text-green-600 dark:text-green-400' },
  aging: { dot: 'bg-amber-500', label: 'そろそろ更新', textColor: 'text-amber-600 dark:text-amber-400' },
  stale: { dot: 'bg-red-500', label: '要更新', textColor: 'text-red-600 dark:text-red-400' },
}

export function FreshnessBadge({ status, daysSinceUpdate, compact }: FreshnessBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.fresh

  if (compact) {
    return (
      <span className={`flex items-center gap-1 text-[10px] ${config.textColor}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        {daysSinceUpdate === 0 ? '今日' : `${daysSinceUpdate}日前`}
      </span>
    )
  }

  return (
    <span className={`flex items-center gap-1.5 text-xs ${config.textColor}`}>
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
      <span className="text-muted-foreground">
        {daysSinceUpdate === 0 ? '今日更新' : `${daysSinceUpdate}日前`}
      </span>
    </span>
  )
}
