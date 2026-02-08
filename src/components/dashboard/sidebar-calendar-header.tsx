"use client"

import { cn } from "@/lib/utils"
import { format, startOfWeek, endOfWeek, subWeeks, subMonths, addWeeks, addMonths } from "date-fns"
import { ja } from "date-fns/locale"
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { ViewMode } from "@/components/calendar/calendar-header"
import { CalendarSelector } from "@/components/calendar/calendar-selector"

interface SidebarCalendarHeaderProps {
    viewMode: ViewMode
    currentDate: Date
    onViewModeChange: (mode: ViewMode) => void
    onDateChange: (date: Date) => void
    onToday: () => void
    onRefresh?: () => void
    isRefreshing?: boolean
    onVisibleCalendarIdsChange?: (ids: string[]) => void
}

export function SidebarCalendarHeader({
    viewMode,
    currentDate,
    onViewModeChange,
    onDateChange,
    onToday,
    onRefresh,
    isRefreshing,
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
        <div className="flex flex-col gap-4 p-4 border-b border-border/30 bg-background/95 backdrop-blur-sm z-30 shrink-0">

            {/* Top Row: Date Display (Prominent) */}
            <div className="flex items-center justify-between">
                <span className="text-base font-semibold tabular-nums tracking-tight">
                    {getDateRangeLabel()}
                </span>

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={goToPrevious}
                        className="p-1.5 rounded-lg hover:bg-muted/60 transition-all duration-200 text-muted-foreground hover:text-foreground"
                        aria-label="前へ"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onToday}
                        className="px-3 py-1 text-xs font-medium rounded-lg hover:bg-muted/60 transition-all duration-200 text-muted-foreground hover:text-foreground"
                    >
                        今日
                    </button>
                    <button
                        onClick={goToNext}
                        className="p-1.5 rounded-lg hover:bg-muted/60 transition-all duration-200 text-muted-foreground hover:text-foreground"
                        aria-label="次へ"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            className={cn(
                                "p-1.5 rounded-lg hover:bg-muted/60 transition-all duration-200",
                                isRefreshing
                                    ? "text-primary cursor-not-allowed"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            aria-label="更新"
                            title={isRefreshing ? "更新中..." : "カレンダーを更新"}
                        >
                            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                        </button>
                    )}
                </div>
            </div>

            {/* Bottom Row: View Mode & Calendar Selector */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center bg-muted/20 rounded-lg p-1 border border-border/30">
                    {(['day', '3day', 'week', 'month'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => onViewModeChange(mode)}
                            className={cn(
                                "px-3 py-1 text-xs font-medium rounded-md transition-all duration-200",
                                viewMode === mode
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
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
