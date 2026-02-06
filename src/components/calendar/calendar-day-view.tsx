import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
// Use the new layout algorithm logic here
import { calculateEventLayout } from "@/lib/calendar-layout"
import { useDrag } from "@/contexts/DragContext"
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

const HOUR_HEIGHT = 64 // 64px per hour

export function CalendarDayView({
    currentDate,
    onTaskDrop,
    events = [],
    onEventEdit,
    onEventDelete
}: CalendarDayViewProps) {
    const [currentTime, setCurrentTime] = useState(new Date())
    const calendarGridRef = useRef<HTMLDivElement>(null)
    const timeLabelsRef = useRef<HTMLDivElement>(null)
    const isSyncingRef = useRef(false)
    const { dragState } = useDrag()
    const isDragging = dragState.isDragging
    const [dragOverHour, setDragOverHour] = useState<number | null>(null)

    // Update current time
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(timer)
    }, [])

    // Initial scroll to 9:00
    useEffect(() => {
        if (calendarGridRef.current) {
            calendarGridRef.current.scrollTop = 9 * HOUR_HEIGHT
        }
    }, [])

    // Scroll sync
    const handleCalendarGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (isSyncingRef.current) return
        isSyncingRef.current = true
        if (timeLabelsRef.current) {
            timeLabelsRef.current.scrollTop = e.currentTarget.scrollTop
        }
        requestAnimationFrame(() => isSyncingRef.current = false)
    }, [])

    // Filter events for this day
    const dayEvents = useMemo(() => {
        return events.filter(event => {
            const eventStart = new Date(event.start_time);
            return isSameDay(eventStart, currentDate);
        });
    }, [events, currentDate]);

    // Calculate Layout
    const eventLayouts = useMemo(() => calculateEventLayout(dayEvents), [dayEvents]);

    const hours = Array.from({ length: 24 }, (_, i) => i)

    // Drag & Drop Handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const scrollTop = calendarGridRef.current?.scrollTop || 0
        const y = e.clientY - rect.top
        const hourIndex = Math.floor((y + scrollTop) / HOUR_HEIGHT)

        if (hourIndex >= 0 && hourIndex < 24) {
            setDragOverHour(hourIndex)
        }
    }, [])

    const handleDragLeave = useCallback(() => {
        setDragOverHour(null)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOverHour(null)
        const taskId = e.dataTransfer.getData('text/plain')
        if (!taskId) return

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const scrollTop = calendarGridRef.current?.scrollTop || 0
        const y = e.clientY - rect.top
        const hourIndex = Math.floor((y + scrollTop) / HOUR_HEIGHT)

        if (hourIndex >= 0 && hourIndex < 24) {
            const targetDate = new Date(currentDate)
            targetDate.setHours(hourIndex, 0, 0, 0)
            onTaskDrop?.(taskId, targetDate)
        }
    }, [currentDate, onTaskDrop])

    // Current time position
    const getCurrentTimePosition = () => {
        const now = new Date()
        return ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100
    }
    const isToday = isSameDay(currentDate, new Date())

    return (
        <div className="flex flex-1 h-full overflow-hidden bg-background">
            {/* Time Labels */}
            <div
                ref={timeLabelsRef}
                className="w-16 flex-shrink-0 border-r bg-background overflow-hidden relative"
            >
                <div className="relative h-[1536px]">
                    {hours.map((hour) => (
                        <div key={hour} className="absolute w-full flex justify-end pr-2 text-xs text-muted-foreground" style={{ top: `${hour * 64 - 10}px` }}> // -10px to center label on line
                            {hour !== 0 && `${hour}:00`}
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Grid */}
            <div
                ref={calendarGridRef}
                className="flex-1 overflow-y-auto relative no-scrollbar"
                onScroll={handleCalendarGridScroll}
            >
                <div
                    className="relative h-[1536px] min-w-[300px]"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Grid Lines */}
                    {hours.map((hour) => (
                        <div key={`grid-${hour}`} className="absolute w-full border-t border-border/10" style={{ top: `${hour * 64}px` }} />
                    ))}

                    {/* Current Time Indicator */}
                    {isToday && (
                        <div
                            className="absolute z-30 w-full flex items-center pointer-events-none"
                            style={{ top: `${getCurrentTimePosition()}%` }}
                        >
                            <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5 border-2 border-background" />
                            <div className="h-[2px] bg-red-500 w-full opacity-60" />
                        </div>
                    )}

                    {/* Drag Highlight */}
                    {dragOverHour !== null && (
                        <div
                            className="absolute w-full bg-primary/10 z-10 pointer-events-none transition-all"
                            style={{
                                top: dragOverHour * HOUR_HEIGHT,
                                height: HOUR_HEIGHT
                            }}
                        >
                            <div className="bg-primary text-primary-foreground text-xs px-2 py-1 inline-block m-1 rounded shadow-sm">
                                {dragOverHour}:00
                            </div>
                        </div>
                    )}

                    {/* Events */}
                    {dayEvents.map(event => {
                        const layout = eventLayouts[event.id];
                        if (!layout) return null;

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
