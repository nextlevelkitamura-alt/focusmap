"use client"

import { cn } from "@/lib/utils"
import { format, startOfWeek, endOfWeek, subWeeks, subMonths, addWeeks, addMonths } from "date-fns"
import { ja } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { ViewMode } from "@/components/calendar/calendar-header"
import { CalendarSelector } from "@/components/calendar/calendar-selector"

interface SidebarCalendarHeaderProps {
    viewMode: ViewMode
    currentDate: Date
    onViewModeChange: (mode: ViewMode) => void
    onDateChange: (date: Date) => void
    onToday: () => void
    onVisibleCalendarIdsChange?: (ids: string[]) => void
}

export function SidebarCalendarHeader({
    viewMode,
    currentDate,
    onViewModeChange,
    onDateChange,
    onToday,
    onVisibleCalendarIdsChange
}: SidebarCalendarHeaderProps) {
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

    // Date range label generation - Compact version
    const getDateRangeLabel = () => {
        if (viewMode === 'day') {
            return format(currentDate, 'M/d (E)', { locale: ja })
        }
        if (viewMode === '3day') {
            const start = currentDate
            const end = new Date(currentDate)
            end.setDate(end.getDate() + 2)
            return `${format(start, 'M/d', { locale: ja })}-${format(end, 'M/d', { locale: ja })}`
        }
        if (viewMode === 'week') {
            const start = startOfWeek(currentDate, { weekStartsOn: 1 })
            const end = endOfWeek(currentDate, { weekStartsOn: 1 })
            return `${format(start, 'M/d', { locale: ja })}-${format(end, 'M/d', { locale: ja })}`
        }
        // Month
        return format(currentDate, 'yyyy/M', { locale: ja })
    }

    return (
        <div className="flex flex-col gap-2 p-2 border-b bg-background z-30 shrink-0">

            {/* Top Row: Navigation & Today */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <button
                        onClick={onToday}
                        className="px-2 py-1 text-xs font-medium border rounded hover:bg-muted/50 transition-colors"
                    >
                        今日
                    </button>
                    <div className="flex items-center">
                        <button
                            onClick={goToPrevious}
                            className="p-1 rounded-full hover:bg-muted/50 transition-colors"
                        >
                            <ChevronLeft className="w-3 h-3" />
                        </button>
                        <button
                            onClick={goToNext}
                            className="p-1 rounded-full hover:bg-muted/50 transition-colors"
                        >
                            <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                <span className="text-sm font-semibold tabular-nums ml-1">
                    {getDateRangeLabel()}
                </span>
            </div>

            {/* Bottom Row: View Mode & Calendar Selector */}
            <div className="flex items-center justify-between">
                <div className="flex items-center bg-muted/30 rounded p-0.5 border">
                    {(['day', '3day', 'week', 'month'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => onViewModeChange(mode)}
                            className={cn(
                                "px-2 py-0.5 text-[10px] font-medium rounded transition-all",
                                viewMode === mode
                                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/10"
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

                <CalendarSelector compact onVisibleCalendarIdsChange={onVisibleCalendarIdsChange} />
            </div>

        </div>
    )
}
