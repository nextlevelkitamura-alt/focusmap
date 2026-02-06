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
        <div className={cn("p-3", className)}>
            <DayPicker
                mode="single"
                selected={currentDate}
                onSelect={(date) => date && onDateChange(date)}
                month={month}
                onMonthChange={setMonth}
                locale={ja}
                showOutsideDays
                classNames={{
                    months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                    month: "space-y-4",
                    caption: "flex justify-between pt-1 relative items-center px-2", // Align with header
                    caption_label: "text-sm font-medium",
                    nav: "space-x-1 flex items-center",
                    nav_button: cn(
                        "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 transition-opacity rounded-full hover:bg-muted flex items-center justify-center"
                    ),
                    nav_button_previous: "",
                    nav_button_next: "",
                    table: "w-full border-collapse space-y-1",
                    head_row: "flex w-full mt-2",
                    head_cell: "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem] flex justify-center", // Adjust width
                    row: "flex w-full mt-1",
                    cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-transparent", // Remove default accent bg
                    day: cn(
                        "h-7 w-7 p-0 font-normal aria-selected:opacity-100 rounded-full hover:bg-muted flex items-center justify-center transition-colors text-xs" // Circle shape
                    ),
                    day_range_end: "day-range-end",
                    day_selected:
                        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground", // Custom selected style
                    day_today: "bg-accent text-accent-foreground",
                    day_outside: "text-muted-foreground opacity-50",
                    day_disabled: "text-muted-foreground opacity-50",
                    day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                    day_hidden: "invisible",
                }}
            />
        </div>
    )
}
