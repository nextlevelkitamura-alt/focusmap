import { useMemo, RefObject } from "react"
import { addDays } from "date-fns"
import { CalendarEvent } from "@/types/calendar"
import { CalendarMultiDayView } from "./calendar-multi-day-view"

interface Calendar3DayViewProps {
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

export function Calendar3DayView({
    currentDate,
    ...props
}: Calendar3DayViewProps) {
    const viewDates = useMemo(() => {
        return Array.from({ length: 3 }, (_, i) => addDays(currentDate, i))
    }, [currentDate])

    return (
        <CalendarMultiDayView
            currentDate={currentDate}
            daysCount={3}
            viewDates={viewDates}
            {...props}
        />
    )
}
