import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DAY_TOTAL_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS, MIN_GRID_WIDTH_DAY } from "@/lib/calendar-constants"
import { useCalendarDragDropDay } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"
import { isSameDay } from "date-fns"

interface CalendarDayViewProps {
    currentDate: Date
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    events?: CalendarEvent[]
    onEventEdit?: (eventId: string) => void
    onEventDelete?: (eventId: string) => void
}

export function CalendarDayView({
    currentDate,
    onTaskDrop,
    events = [],
    onEventEdit,
    onEventDelete,
    hourHeight = HOUR_HEIGHT // Accept prop with default
}: CalendarDayViewProps & { hourHeight?: number }) { // Add prop type
    const [currentTime, setCurrentTime] = useState(new Date())
    const calendarGridRef = useRef<HTMLDivElement>(null)
    const timeLabelsRef = useRef<HTMLDivElement>(null)

    const { handleScrollA: handleGridScroll } = useScrollSync(calendarGridRef, timeLabelsRef)
    const { dragOverHour, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropDay({
        gridRef: calendarGridRef,
        onTaskDrop,
        hourHeight // Pass to hook
    })

    // Update current time (every minute)
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(timer)
    }, [])

    // Initial scroll to default hour - use updated hourHeight
    useEffect(() => {
        if (calendarGridRef.current) {
            calendarGridRef.current.scrollTop = DEFAULT_SCROLL_HOUR * hourHeight
            if (timeLabelsRef.current) {
                timeLabelsRef.current.scrollTop = DEFAULT_SCROLL_HOUR * hourHeight
            }
        }
    }, [hourHeight]) // Re-run if height changes

    // Filter events for this day
    const dayEvents = useMemo(() => {
        return events.filter(event => isSameDay(new Date(event.start_time), currentDate))
    }, [events, currentDate])

    const eventLayouts = useMemo(() => calculateEventLayout(dayEvents), [dayEvents])

    const isToday = isSameDay(currentDate, new Date())
    const currentTimePosition = ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100

    const onDragOver = useCallback((e: React.DragEvent) => handleDragOver(e, { currentDate }), [handleDragOver, currentDate])
    const onDrop = useCallback((e: React.DragEvent) => handleDrop(e, { currentDate }), [handleDrop, currentDate])

    const totalHeight = hourHeight * 24

    return (
        <div className="flex flex-1 h-full overflow-hidden bg-background">
            {/* Time Labels */}
            <div
                ref={timeLabelsRef}
                className="w-12 flex-shrink-0 bg-background border-r border-border/20 overflow-hidden relative"
            >
                <div className="relative" style={{ height: totalHeight }}>
                    {HOURS.map((hour) => (
                        <div key={hour} className="absolute w-full flex justify-end pr-2 text-[10px] font-medium text-muted-foreground" style={{ top: hour * hourHeight - 6 }}>
                            {hour !== 0 && `${hour}:00`}
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Grid */}
            <div
                ref={calendarGridRef}
                className="flex-1 overflow-y-auto relative"
                onScroll={handleGridScroll}
            >
                <div
                    className="relative"
                    style={{ height: totalHeight, minWidth: MIN_GRID_WIDTH_DAY }}
                    onDragOver={onDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={onDrop}
                >
                    {/* Grid Lines */}
                    {HOURS.map((hour) => (
                        <div key={`grid-${hour}`} className="absolute w-full border-t border-border/20" style={{ top: hour * hourHeight }} />
                    ))}

                    {/* Current Time Indicator */}
                    {isToday && (
                        <div
                            className="absolute z-30 w-full flex items-center pointer-events-none"
                            style={{ top: `${currentTimePosition}%` }}
                        >
                            <div className="absolute w-2 h-2 rounded-full bg-red-500 z-40 ring-2 ring-background left-[-5px]" />
                            <div className="h-[2px] bg-red-500 w-full opacity-60" />
                        </div>
                    )}

                    {/* Drag Highlight */}
                    {dragOverHour !== null && (
                        <div
                            className="absolute w-full bg-primary/10 z-10 pointer-events-none transition-all"
                            style={{ top: dragOverHour * hourHeight, height: hourHeight }}
                        >
                            <div className="bg-primary text-primary-foreground text-xs px-2 py-1 inline-block m-1 rounded shadow-sm">
                                {dragOverHour}:00
                            </div>
                        </div>
                    )}

                    {/* Events */}
                    {dayEvents.map(event => {
                        const layout = eventLayouts[event.id]
                        if (!layout) return null

                        return (
                            <div
                                key={event.id}
                                className="absolute px-0.5 transition-all duration-300 pointer-events-auto"
                                style={{
                                    top: `${layout.top}%`,
                                    height: `${layout.height}%`,
                                    left: `${layout.left}%`,
                                    width: `${layout.width}%`,
                                    zIndex: 20
                                }}
                            >
                                <CalendarEventCard
                                    event={event}
                                    onEdit={onEventEdit}
                                    onDelete={onEventDelete}
                                    className="h-full shadow-sm text-xs"
                                />
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
