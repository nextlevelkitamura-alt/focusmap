"use client"

import { useState, useEffect } from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type MiniCalendarProps = {
    currentDate: Date
    onDateChange: (date: Date) => void
    events?: { date: Date }[] // Optional: to show indicators
    className?: string
}

export function MiniCalendar({ currentDate, onDateChange, events, className }: MiniCalendarProps) {
    const [month, setMonth] = useState<Date>(currentDate)

    // Sync internal month state when currentDate changes significantly (external navigation)
    useEffect(() => {
        if (currentDate.getMonth() !== month.getMonth() || currentDate.getFullYear() !== month.getFullYear()) {
            setMonth(currentDate)
        }
    }, [currentDate])

    return (
        <div className={cn("p-4", className)}>
            <style jsx global>{`
              .rdp {
                margin: 0;
              }
              .rdp-month {
                width: 100%;
              }
              .rdp-table {
                width: 100%;
                max-width: 100%;
              }
              .rdp-caption {
                position: relative;
                padding-bottom: 12px;
              }
            `}</style>
            <DayPicker
                mode="single"
                selected={currentDate}
                onSelect={(date) => date && onDateChange(date)}
                month={month}
                onMonthChange={setMonth}
                locale={ja}
                showOutsideDays
                formatters={{
                    formatCaption: (date, options) => {
                        // "2026年2月" style
                        return `${date.getFullYear()}年${date.getMonth() + 1}月`
                    }
                }}
                classNames={{
                    months: "flex flex-col space-y-4",
                    month: "space-y-4 w-full",
                    caption: "flex justify-center pt-1 relative items-center",
                    caption_label: "text-sm font-bold text-foreground", // Bold year/month
                    nav: "space-x-1 flex items-center absolute inset-x-0 justify-between px-1", // Spaced out nav
                    nav_button: cn(
                        "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 transition-opacity rounded-full hover:bg-muted/30 flex items-center justify-center text-foreground"
                    ),
                    nav_button_previous: "z-10",
                    nav_button_next: "z-10",
                    table: "w-full border-collapse space-y-1",
                    head_row: "grid grid-cols-7 mb-2",
                    head_cell: "text-muted-foreground w-full font-normal text-[0.7rem] flex justify-center items-center py-1",
                    row: "grid grid-cols-7 w-full mt-1",
                    cell: "relative p-0 text-center text-xs focus-within:relative focus-within:z-20",
                    day: cn(
                        "h-8 w-8 mx-auto p-0 font-normal rounded-full hover:bg-muted/30 flex items-center justify-center transition-all text-xs text-foreground"
                    ),
                    day_selected:
                        "bg-[#4285F4] text-white hover:bg-[#4285F4] hover:text-white font-medium shadow-md shadow-[#4285F4]/20", // Google Blue
                    day_today: "text-[#4285F4] font-bold after:content-[''] after:absolute after:bottom-1 after:w-1 after:h-1 after:bg-[#4285F4] after:rounded-full", // Dot indicator for today if not selected
                    day_outside: "text-muted-foreground/30 opacity-50",
                    day_disabled: "text-muted-foreground/30 opacity-50",
                    day_hidden: "invisible",
                }}
            />
        </div>
    )
}
