"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { ViewMode } from "@/components/calendar/calendar-header"
import { SidebarCalendarHeader } from "@/components/dashboard/sidebar-calendar-header"
import { CalendarWeekView } from "@/components/calendar/calendar-week-view"
import { Calendar3DayView } from "@/components/calendar/calendar-3day-view"
import { CalendarMonthView } from "@/components/calendar/calendar-month-view"
import { CalendarDayView } from "@/components/calendar/calendar-day-view"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { startOfMonth, endOfMonth, addMonths } from "date-fns"
import { HOUR_HEIGHT } from "@/lib/calendar-constants"

interface SidebarCalendarProps {
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onSelectionChange?: (calendarIds: string[]) => void
}

export function SidebarCalendar({ onTaskDrop, onSelectionChange }: SidebarCalendarProps) {
    // Default to 'day' view for sidebar as it's most useful for scheduling
    const [viewMode, setViewMode] = useState<ViewMode>('day')
    const [currentDate, setCurrentDate] = useState(new Date())
    const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT) // Zoom state

    // Calendar selection state
    const { selectedCalendarIds } = useCalendars()

    // Calculate display range
    const { timeMin, timeMax } = useMemo(() => {
        const monthStart = startOfMonth(currentDate)
        const monthEnd = endOfMonth(currentDate)

        return {
            timeMin: addMonths(monthStart, -1),
            timeMax: addMonths(monthEnd, 1)
        }
    }, [currentDate])

    // Fetch events
    const { events } = useCalendarEvents({
        timeMin,
        timeMax,
        calendarIds: selectedCalendarIds,
        autoSync: true,
        syncInterval: 300000
    })

    // Handlers
    const handleToday = useCallback(() => {
        setCurrentDate(new Date())
    }, [])

    const handleDateChange = useCallback((date: Date) => {
        setCurrentDate(date)
    }, [])

    const handleEventEdit = useCallback((eventId: string) => {
        console.log('Edit event:', eventId)
    }, [])

    const handleEventDelete = useCallback((eventId: string) => {
        console.log('Delete event:', eventId)
    }, [])

    const handleEventClick = useCallback((eventId: string) => {
        console.log('Event clicked:', eventId)
    }, [])

    // Zoom Handler (Pinch-in/out)
    // We need to use a native event listener with { passive: false } to prevent the default browser zoom
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault()
                // Prevent page zoom
                e.stopPropagation()

                const delta = e.deltaY * -0.5
                setHourHeight(current => {
                    const newHeight = Math.max(30, Math.min(200, current + delta))
                    return newHeight
                })
            }
        }

        container.addEventListener('wheel', handleWheel, { passive: false })

        return () => {
            container.removeEventListener('wheel', handleWheel)
        }
    }, [])

    return (
        <div className="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
            {/* Compact Header */}
            <SidebarCalendarHeader
                viewMode={viewMode}
                currentDate={currentDate}
                onViewModeChange={setViewMode}
                onDateChange={handleDateChange}
                onToday={handleToday}
                onVisibleCalendarIdsChange={onSelectionChange}
            />

            {/* Main Content - No Screen-Size Based Sidebar here */}
            <div
                ref={containerRef}
                className="flex-1 overflow-hidden relative flex flex-col"
            >
                {viewMode === 'day' ? (
                    <CalendarDayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === '3day' ? (
                    <Calendar3DayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === 'week' ? (
                    <CalendarWeekView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : (
                    <CalendarMonthView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        events={events}
                        onEventClick={handleEventClick}
                    />
                )}
            </div>
        </div>
    )
}
