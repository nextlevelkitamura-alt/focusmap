"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

interface SimpleCalendarProps {
    selected: Date | undefined
    onSelect: (date: Date | undefined) => void
    month: Date
    onMonthChange: (date: Date) => void
    className?: string
}

export function SimpleCalendar({ selected, onSelect, month, onMonthChange, className }: SimpleCalendarProps) {
    const year = month.getFullYear()
    const monthIndex = month.getMonth()

    // 月の最初の日と最後の日
    const firstDay = new Date(year, monthIndex, 1)
    const lastDay = new Date(year, monthIndex + 1, 0)

    // 曜日のオフセット（日曜始まり）
    const startDayOfWeek = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    // 前月の日付を取得（outside days）
    const prevMonthDays: (Date | null)[] = []
    if (startDayOfWeek > 0) {
        const prevMonthLastDay = new Date(year, monthIndex, 0).getDate()
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            prevMonthDays.push(new Date(year, monthIndex - 1, prevMonthLastDay - i))
        }
    }

    // 今月の日付
    const currentMonthDays: Date[] = []
    for (let i = 1; i <= daysInMonth; i++) {
        currentMonthDays.push(new Date(year, monthIndex, i))
    }

    // 次月の日付（6週間分を埋める）
    const totalCells = 42 // 6週間 × 7日
    const nextMonthDays: Date[] = []
    const remainingCells = totalCells - prevMonthDays.length - currentMonthDays.length
    for (let i = 1; i <= remainingCells; i++) {
        nextMonthDays.push(new Date(year, monthIndex + 1, i))
    }

    const allDays = [...prevMonthDays, ...currentMonthDays, ...nextMonthDays]

    const handlePrevMonth = () => {
        onMonthChange(new Date(year, monthIndex - 1, 1))
    }

    const handleNextMonth = () => {
        onMonthChange(new Date(year, monthIndex + 1, 1))
    }

    const isToday = (date: Date) => {
        const today = new Date()
        return date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear()
    }

    const isSelected = (date: Date) => {
        if (!selected) return false
        return date.getDate() === selected.getDate() &&
            date.getMonth() === selected.getMonth() &&
            date.getFullYear() === selected.getFullYear()
    }

    const isCurrentMonth = (date: Date) => {
        return date.getMonth() === monthIndex
    }

    return (
        <div className={cn("w-[280px]", className)}>
            {/* Header */}
            <div className="flex justify-center items-center mb-2 relative">
                <button
                    className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "h-8 w-8 bg-transparent p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 absolute left-0"
                    )}
                    onClick={handlePrevMonth}
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-base font-bold text-foreground">
                    {year}年{monthIndex + 1}月
                </div>
                <button
                    className={cn(
                        buttonVariants({ variant: "ghost" }),
                        "h-8 w-8 bg-transparent p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 absolute right-0"
                    )}
                    onClick={handleNextMonth}
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            {/* Calendar Grid */}
            <table className="w-full border-collapse table-fixed">
                <thead>
                    <tr>
                        {["日", "月", "火", "水", "木", "金", "土"].map((day, i) => (
                            <th key={i} className="p-0 pb-2 text-center text-xs font-medium text-muted-foreground">
                                {day}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: 6 }, (_, weekIndex) => (
                        <tr key={weekIndex}>
                            {Array.from({ length: 7 }, (_, dayIndex) => {
                                const cellIndex = weekIndex * 7 + dayIndex
                                const date = allDays[cellIndex]

                                if (!date) return <td key={dayIndex} />

                                const today = isToday(date)
                                const selectedDay = isSelected(date)
                                const currentMonth = isCurrentMonth(date)

                                return (
                                    <td key={dayIndex} className="p-0 text-center">
                                        <button
                                            className={cn(
                                                "w-full aspect-square p-0 text-xs font-normal flex items-center justify-center rounded-md transition-colors",
                                                currentMonth
                                                    ? "text-foreground hover:bg-muted/50"
                                                    : "text-muted-foreground/40 opacity-70 pointer-events-none",
                                                selectedDay &&
                                                    "bg-primary/20 text-primary font-semibold ring-1 ring-primary/30",
                                                today &&
                                                    !selectedDay &&
                                                    "relative after:content-[''] after:absolute after:inset-1 after:rounded-md after:ring-1 after:ring-primary/40"
                                            )}
                                            onClick={() => currentMonth && onSelect(date)}
                                            disabled={!currentMonth}
                                        >
                                            {date.getDate()}
                                        </button>
                                    </td>
                                )
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
