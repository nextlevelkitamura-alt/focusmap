"use client"

import { cn } from "@/lib/utils"
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, startOfMonth, endOfMonth, addMonths, subMonths, isSameWeek } from "date-fns"
import { ja } from "date-fns/locale"

export type ViewMode = 'week' | 'month'

interface CalendarHeaderProps {
  viewMode: ViewMode
  currentDate: Date
  onViewModeChange: (mode: ViewMode) => void
  onDateChange: (date: Date) => void
  onToday: () => void
}

export function CalendarHeader({
  viewMode,
  currentDate,
  onViewModeChange,
  onDateChange,
  onToday
}: CalendarHeaderProps) {
  // 前へ移動
  const goToPrevious = () => {
    if (viewMode === 'week') {
      onDateChange(subWeeks(currentDate, 1))
    } else {
      onDateChange(subMonths(currentDate, 1))
    }
  }

  // 次へ移動
  const goToNext = () => {
    if (viewMode === 'week') {
      onDateChange(addWeeks(currentDate, 1))
    } else {
      onDateChange(addMonths(currentDate, 1))
    }
  }

  // 日付範囲のラベルを生成
  const getDateRangeLabel = () => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
      const startMonth = format(weekStart, 'M月', { locale: ja })
      const endMonth = format(weekEnd, 'M月', { locale: ja })

      if (startMonth === endMonth) {
        // 同じ月の場合: 「2024年1月」
        return format(weekStart, 'yyyy年M月', { locale: ja })
      } else {
        // 月をまたぐ場合: 「1月〜2月」
        return `${format(weekStart, 'M月', { locale: ja })}〜${format(weekEnd, 'M月', { locale: ja })}`
      }
    } else {
      // 月表示: 「2024年1月」
      return format(currentDate, 'yyyy年M月', { locale: ja })
    }
  }

  // 週表示の場合、日付範囲も表示
  const getWeekDayRange = () => {
    if (viewMode !== 'week') return null
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
    return `${format(weekStart, 'M/d')}〜${format(weekEnd, 'M/d')}`
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b bg-gradient-to-r from-muted/20 to-muted/10">
      {/* Left: Navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={goToPrevious}
          className="p-1.5 hover:bg-muted rounded transition-colors"
          aria-label={viewMode === 'week' ? '前週' : '前月'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={onToday}
          className="px-2 py-1 text-xs font-medium hover:bg-muted rounded transition-colors"
        >
          今日
        </button>
        <button
          onClick={goToNext}
          className="p-1.5 hover:bg-muted rounded transition-colors"
          aria-label={viewMode === 'week' ? '次週' : '次月'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Center: Date Display */}
      <div className="text-center">
        <h2 className="text-sm font-bold text-foreground leading-tight">
          {getDateRangeLabel()}
        </h2>
        {viewMode === 'week' && (
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">
            {getWeekDayRange()}
          </p>
        )}
      </div>

      {/* Right: View Mode Toggle */}
      <div className="flex items-center gap-0.5 bg-muted/30 rounded p-0.5">
        <button
          onClick={() => onViewModeChange('week')}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded transition-all",
            viewMode === 'week'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          週
        </button>
        <button
          onClick={() => onViewModeChange('month')}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded transition-all",
            viewMode === 'month'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          月
        </button>
      </div>
    </div>
  )
}
