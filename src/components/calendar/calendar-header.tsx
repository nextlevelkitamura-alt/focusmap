"use client"

import { cn } from "@/lib/utils"
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, startOfMonth, endOfMonth, addMonths, subMonths, isSameWeek } from "date-fns"
import { ja } from "date-fns/locale"
import { CalendarSelector } from "./calendar-selector"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type ViewMode = 'day' | 'week' | 'month'

interface CalendarHeaderProps {
  viewMode: ViewMode
  currentDate: Date
  onViewModeChange: (mode: ViewMode) => void
  onDateChange: (date: Date) => void
  onToday: () => void
  onVisibleCalendarIdsChange?: (ids: string[]) => void
}

export function CalendarHeader({
  viewMode,
  currentDate,
  onViewModeChange,
  onDateChange,
  onToday,
  onVisibleCalendarIdsChange
}: CalendarHeaderProps) {
  // Navigation handlers
  const goToPrevious = () => {
    if (viewMode === 'day') {
      onDateChange(new Date(currentDate.setDate(currentDate.getDate() - 1)))
    } else if (viewMode === 'week') {
      onDateChange(subWeeks(currentDate, 1))
    } else {
      onDateChange(subMonths(currentDate, 1))
    }
  }

  const goToNext = () => {
    if (viewMode === 'day') {
      onDateChange(new Date(currentDate.setDate(currentDate.getDate() + 1)))
    } else if (viewMode === 'week') {
      onDateChange(addWeeks(currentDate, 1))
    } else {
      onDateChange(addMonths(currentDate, 1))
    }
  }

  // Date range label generation
  const getDateRangeLabel = () => {
    if (viewMode === 'day') {
      return format(currentDate, 'yyyy年M月d日 (E)', { locale: ja })
    }
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
      const startMonth = format(weekStart, 'M月', { locale: ja })
      const endMonth = format(weekEnd, 'M月', { locale: ja })
      const startYear = format(weekStart, 'yyyy年', { locale: ja })
      const endYear = format(weekEnd, 'yyyy年', { locale: ja })

      if (startYear === endYear) {
        if (startMonth === endMonth) {
          return format(weekStart, 'yyyy年M月', { locale: ja })
        } else {
          return `${startYear}${startMonth}〜${endMonth}`
        }
      } else {
        return `${startYear}${startMonth}〜${endYear}${endMonth}`
      }
    } else {
      return format(currentDate, 'yyyy年M月', { locale: ja })
    }
  }

  return (
    <div className="flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Upper Toolbar: Title & Main Actions */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <img src="https://www.gstatic.com/calendar/images/dynamiclogo_2020q4/daily_30.ico" alt="Calendar" className="w-5 h-5" />
          </div>
          <h2 className="font-semibold text-base tracking-tight">カレンダー</h2>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border shadow-sm">
            <button
              onClick={() => onViewModeChange('day')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                viewMode === 'day'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              日
            </button>
            <div className="w-px h-3 bg-border/50 mx-0.5" />
            <button
              onClick={() => onViewModeChange('week')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                viewMode === 'week'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              週
            </button>
            <div className="w-px h-3 bg-border/50 mx-0.5" />
            <button
              onClick={() => onViewModeChange('month')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                viewMode === 'month'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              月
            </button>
          </div>
        </div>
      </div>

      {/* Lower Toolbar: Navigation & Date Context */}
      <div className="flex items-center justify-between px-3 pb-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onToday}
            className="px-2 py-1 text-xs font-medium bg-muted/50 hover:bg-muted border rounded-md transition-colors"
          >
            今日
          </button>
          <div className="flex items-center rounded-md border bg-muted/30">
            <button
              onClick={goToPrevious}
              className="p-1 px-1.5 hover:bg-muted rounded-l-md transition-colors border-r"
              aria-label="Previous"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={goToNext}
              className="p-1 px-1.5 hover:bg-muted rounded-r-md transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="ml-2 text-sm font-bold text-foreground tabular-nums">
            {getDateRangeLabel()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <CalendarSelector compact onVisibleCalendarIdsChange={onVisibleCalendarIdsChange} />
          {/* Note: CalendarSettings is now integrated via CalendarSelector or can be added here if needed separate */}
        </div>
      </div>
    </div>
  )
}
