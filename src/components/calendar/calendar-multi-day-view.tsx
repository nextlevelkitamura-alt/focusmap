import { useState, useCallback, useRef, useEffect, useMemo, RefObject } from "react"
import { cn } from "@/lib/utils"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS } from "@/lib/calendar-constants"
import { useCalendarDragDropMultiDay } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { addDays, isSameDay, format, isToday } from "date-fns"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"

interface CalendarMultiDayViewProps {
    currentDate: Date
    daysCount: number
    viewDates: Date[]
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onEventTimeChange?: (eventId: string, newStartTime: Date, newEndTime: Date) => void
    events?: CalendarEvent[]
    onEventEdit?: (eventId: string) => void
    onEventDelete?: (eventId: string) => void
    onDateChange?: (date: Date) => void
    hourHeight?: number
    gridRef?: RefObject<HTMLDivElement | null>
}

export function CalendarMultiDayView({
    currentDate,
    daysCount,
    viewDates,
    onTaskDrop,
    onEventTimeChange,
    events = [],
    onEventEdit,
    onEventDelete,
    onDateChange,
    hourHeight = HOUR_HEIGHT,
    gridRef
}: CalendarMultiDayViewProps) {
    const [currentTime, setCurrentTime] = useState(() => {
        // SSR-safe: midnight as initial value, updated in useEffect
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const [isMounted, setIsMounted] = useState(false)
    useEffect(() => { setCurrentTime(new Date()); setIsMounted(true) }, [])
    const timeLabelsRef = useRef<HTMLDivElement>(null)
    const calendarGridRef = gridRef || useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // スワイプナビゲーション
    const { swipeDirection } = useSwipeNavigation({
        containerRef,
        onSwipeLeft: () => onDateChange?.(addDays(currentDate, daysCount)),
        onSwipeRight: () => onDateChange?.(addDays(currentDate, -daysCount)),
        threshold: 50
    })

    const { handleScrollA: handleGridScroll } = useScrollSync(calendarGridRef, timeLabelsRef)

    const { dragOverCell, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropMultiDay({
        gridRef: calendarGridRef,
        onTaskDrop,
        daysCount,
        hourHeight
    })

    // Update current time (every minute)
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(timer)
    }, [])

    // Initial scroll to default hour
    useEffect(() => {
        if (calendarGridRef.current) {
            const scrollPosition = DEFAULT_SCROLL_HOUR * hourHeight
            calendarGridRef.current.scrollTop = scrollPosition
            if (timeLabelsRef.current) {
                timeLabelsRef.current.scrollTop = scrollPosition
            }
        }
    }, [hourHeight])

    // Current time position
    const currentTimePosition = ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100

    // Enhanced drop handler that supports both tasks and events
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const eventDataStr = e.dataTransfer.getData('application/json')
        const taskId = e.dataTransfer.getData('text/plain')

        if (eventDataStr) {
            try {
                const eventData = JSON.parse(eventDataStr)
                if (eventData.type === 'calendar-event') {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const scrollTop = calendarGridRef.current?.scrollTop || 0

                    const x = e.clientX - rect.left
                    const y = e.clientY - rect.top

                    const cellWidth = rect.width / daysCount
                    const dayIndex = Math.floor(x / cellWidth)
                    const hourIndex = Math.floor((y + scrollTop) / hourHeight)

                    // 15分単位にスナップ
                    const minuteIndex = Math.round(((y + scrollTop) % hourHeight) / hourHeight * 4)
                    const minutes = minuteIndex * 15

                    if (dayIndex >= 0 && dayIndex < daysCount && hourIndex >= 0 && hourIndex < 24) {
                        const newStartTime = new Date(viewDates[dayIndex])
                        newStartTime.setHours(hourIndex, minutes, 0, 0)

                        const duration = eventData.duration || 3600000
                        const newEndTime = new Date(newStartTime.getTime() + duration)

                        onEventTimeChange?.(eventData.eventId, newStartTime, newEndTime)
                    }
                }
            } catch (error) {
                console.error('Failed to parse event data:', error)
            }
        } else if (taskId) {
            handleDrop(e, { dates: viewDates, hours: HOURS })
        }
    }, [handleDrop, viewDates, onEventTimeChange, hourHeight, calendarGridRef, daysCount])

    // Group events by day and calculate layout
    const dayEventLayouts = useMemo(() => {
        const layouts: Record<number, { event: CalendarEvent, position: ReturnType<typeof calculateEventLayout>[string] }[]> = {}

        viewDates.forEach((date, index) => {
            const dayEvents = events.filter(e => isSameDay(new Date(e.start_time), date))
            const layout = calculateEventLayout(dayEvents)

            layouts[index] = dayEvents.map(event => ({
                event,
                position: layout[event.id]
            })).filter(item => item.position)
        })
        return layouts
    }, [events, viewDates])

    const totalHeight = hourHeight * 24
    const gridColsClass = daysCount === 3 ? 'grid-cols-3' : 'grid-cols-7'

    return (
        <div
            ref={containerRef}
            className={cn(
                "w-full h-full flex flex-col overflow-hidden bg-background/50 transition-transform duration-200",
                swipeDirection === 'left' && "translate-x-[-4px]",
                swipeDirection === 'right' && "translate-x-[4px]"
            )}
        >
            {/* Fixed Header */}
            <div className="flex h-14 flex-shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm z-20 relative mr-[15px]">
                <div className="flex-shrink-0 w-14 bg-transparent border-r border-border/10" />
                <div className={`flex-1 grid ${gridColsClass}`}>
                    {viewDates.map((date) => {
                        const isTodayDate = isToday(date)
                        return (
                            <div
                                key={date.getTime()}
                                className={cn(
                                    "flex flex-col items-center justify-center border-r border-border/10 last:border-r-0 pb-1 pt-2",
                                    isTodayDate ? "bg-primary/5" : ""
                                )}
                            >
                                <div className={cn(
                                    "text-[11px] font-medium uppercase tracking-wide opacity-70",
                                    isTodayDate ? "text-primary font-semibold" : "text-muted-foreground"
                                )}>
                                    {format(date, 'EEEE').charAt(0)}
                                </div>
                                <div className={cn(
                                    "flex items-center justify-center w-8 h-8 text-sm rounded-full mt-1",
                                    isTodayDate ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-foreground font-medium"
                                )}>
                                    {date.getDate()}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Scrollable Area */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Time Labels */}
                <div
                    ref={timeLabelsRef}
                    className="flex-shrink-0 w-14 bg-background/80 border-r border-border/10 overflow-hidden relative"
                >
                    <div className="relative" style={{ height: totalHeight }}>
                        {HOURS.map((hour) => (
                            <div key={hour} className="absolute w-full flex justify-end pr-3 text-[11px] font-medium text-muted-foreground/80" style={{ top: hour * hourHeight - 8 }}>
                                {hour !== 0 && `${hour}:00`}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Calendar Grid */}
                <div
                    ref={calendarGridRef}
                    className="flex-1 overflow-y-auto relative"
                    onScroll={handleGridScroll}
                >
                    <div
                        className="relative"
                        style={{ height: totalHeight }}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={onDrop}
                    >
                        {/* Horizontal Grid Lines */}
                        {HOURS.map((hour) => (
                            <div key={`grid-${hour}`} className="absolute w-full border-t border-border/8" style={{ top: hour * hourHeight }} />
                        ))}

                        {/* Vertical Day Lines */}
                        <div className={`absolute inset-0 grid ${gridColsClass} h-full pointer-events-none`}>
                            {Array.from({ length: daysCount }).map((_, col) => (
                                <div key={`col-${col}`} className="border-r border-border/10 h-full w-full" />
                            ))}
                        </div>

                        {/* Current Time Indicator */}
                        {isMounted && viewDates.map((date) => {
                            if (isSameDay(date, currentTime)) {
                                return (
                                    <div
                                        key="now-indicator"
                                        className="absolute z-30 flex items-center pointer-events-none"
                                        style={{
                                            top: `${currentTimePosition}%`,
                                            left: 0,
                                            width: '100%'
                                        }}
                                    >
                                        <div
                                            className="absolute w-2.5 h-2.5 rounded-full bg-red-500 z-40 ring-2 ring-red-500/20 left-[-6px] shadow-lg shadow-red-500/30"
                                        />
                                        <div className="h-[1.5px] bg-red-500 w-full opacity-70 shadow-sm" />
                                    </div>
                                )
                            }
                            return null
                        })}

                        {/* Drop Highlight */}
                        {dragOverCell && (
                            (() => {
                                const [dIndex, hIndex] = dragOverCell.split('-').map(Number)
                                return (
                                    <div
                                        className="absolute bg-primary/5 z-10 pointer-events-none border-l-2 border-primary/30"
                                        style={{
                                            top: hIndex * hourHeight,
                                            left: `${dIndex * (100 / daysCount)}%`,
                                            width: `${100 / daysCount}%`,
                                            height: hourHeight
                                        }}
                                    >
                                        <div className="bg-primary text-primary-foreground text-xs px-2.5 py-1 inline-block m-2 rounded-md shadow-md font-medium">
                                            {String(HOURS[hIndex]).padStart(2, '0')}:00
                                        </div>
                                    </div>
                                )
                            })()
                        )}

                        {/* Events Layer */}
                        <div className={`absolute inset-0 grid ${gridColsClass} pointer-events-none`}>
                            {viewDates.map((_, dayIndex) => {
                                const dayItems = dayEventLayouts[dayIndex] || []

                                return (
                                    <div key={`events-${dayIndex}`} className="relative h-full w-full">
                                        {dayItems.map(({ event, position }) => {
                                            const eventHeightPx = (position.height / 100) * totalHeight

                                            return (
                                                <div
                                                    key={event.id}
                                                    className="absolute px-0.5 transition-all duration-300 pointer-events-auto"
                                                    style={{
                                                        top: `${position.top}%`,
                                                        height: `${position.height}%`,
                                                        left: `${position.left}%`,
                                                        width: `${position.width}%`,
                                                        zIndex: 20
                                                    }}
                                                >
                                                    <CalendarEventCard
                                                        event={event}
                                                        onEdit={onEventEdit}
                                                        onDelete={onEventDelete}
                                                        isDraggable={true}
                                                        className="h-full shadow-sm text-xs"
                                                        eventHeight={eventHeightPx}
                                                    />
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
