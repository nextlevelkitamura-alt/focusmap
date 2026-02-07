"use client"

import { cn } from "@/lib/utils"
import { format, startOfWeek, endOfWeek, subWeeks, subMonths, addWeeks, addMonths } from "date-fns"
import { ja } from "date-fns/locale"
import { CalendarSelector } from "./calendar-selector"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"

export type ViewMode = 'day' | '3day' | 'week' | 'month'

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
    } else if (viewMode === '3day') {
      onDateChange(new Date(currentDate.setDate(currentDate.getDate() - 3)))
    } else if (viewMode === 'week') {
      onDateChange(subWeeks(currentDate, 1))
    } else {
      onDateChange(subMonths(currentDate, 1))
    }
  }

  const goToNext = () => {
    if (viewMode === 'day') {
      onDateChange(new Date(currentDate.setDate(currentDate.getDate() + 1)))
    } else if (viewMode === '3day') {
      onDateChange(new Date(currentDate.setDate(currentDate.getDate() + 3)))
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
    if (viewMode === '3day') {
      const start = currentDate
      const end = new Date(currentDate)
      end.setDate(end.getDate() + 2)
      return `${format(start, 'M月d日', { locale: ja })} - ${format(end, 'M月d日', { locale: ja })}`
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
    <div className="flex items-center justify-between px-4 h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shrink-0 z-30">

      {/* Left Section: Logo & Today & Navigation & Title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-foreground/90">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <CalendarIcon className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-lg font-medium tracking-tight hidden md:block">カレンダー</h1>
        </div>

        <div className="h-6 w-px bg-border/40 mx-1 hidden md:block" />

        <div className="flex items-center gap-2">
          <button
            onClick={onToday}
            className="px-3 py-1.5 text-sm font-medium border rounded-md hover:bg-muted/50 transition-colors"
          >
            今日
          </button>

          <div className="flex items-center gap-0.5">
            <button
              onClick={goToPrevious}
              className="p-1.5 rounded-full hover:bg-muted/50 transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft className="w-4 h-4 text-foreground/70" />
            </button>
            <button
              onClick={goToNext}
              className="p-1.5 rounded-full hover:bg-muted/50 transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="w-4 h-4 text-foreground/70" />
            </button>
          </div>

          <span className="ml-2 text-base font-medium text-foreground tabular-nums">
            {getDateRangeLabel()}
          </span>
        </div>
      </div>

      {/* Right Section: View Switcher & Calendar Selector */}
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center bg-muted/30 rounded-lg p-1 border">
          {(['month', 'week', '3day', 'day'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all duration-200",
                viewMode === mode
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/5"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {mode === 'day' && '日'}
              {mode === '3day' && '3日'}
              {mode === 'week' && '週'}
              {mode === 'month' && '月'}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border/40 hidden md:block" />

        <CalendarSelector compact onVisibleCalendarIdsChange={onVisibleCalendarIdsChange} />
      </div>
    </div>
  )
}
