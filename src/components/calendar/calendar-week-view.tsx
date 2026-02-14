import { useMemo, RefObject } from "react"
import { startOfWeek, addDays } from "date-fns"
import { CalendarEvent } from "@/types/calendar"
import { CalendarMultiDayView } from "./calendar-multi-day-view"

interface CalendarWeekViewProps {
    currentDate: Date
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onEventTimeChange?: (eventId: string, newStartTime: Date, newEndTime: Date) => void
    events?: CalendarEvent[]
    onEventEdit?: (eventId: string) => void
    onEventDelete?: (eventId: string) => void
    onDateChange?: (date: Date) => void
    hourHeight?: number
    gridRef?: RefObject<HTMLDivElement | null>
}

export function CalendarWeekView({
    currentDate,
    ...props
}: CalendarWeekViewProps) {
    const viewDates = useMemo(() => {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 })
        return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }, [currentDate])

    return (
        <CalendarMultiDayView
            currentDate={currentDate}
            daysCount={7}
            viewDates={viewDates}
            {...props}
        />
    )
}
