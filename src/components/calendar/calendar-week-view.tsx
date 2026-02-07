import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DAY_TOTAL_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS, MIN_GRID_WIDTH_WEEK } from "@/lib/calendar-constants"
import { useCalendarDragDropWeek } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { startOfWeek, addDays, isSameDay, format, isToday } from "date-fns"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"

interface CalendarWeekViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  events?: CalendarEvent[]
  onEventEdit?: (eventId: string) => void
  onEventDelete?: (eventId: string) => void
}

export function CalendarWeekView({
  currentDate,
  onTaskDrop,
  events = [],
  onEventEdit,
  onEventDelete
}: CalendarWeekViewProps) {
  const [currentTime, setCurrentTime] = useState(new Date())
  const timeLabelsRef = useRef<HTMLDivElement>(null)
  const calendarGridRef = useRef<HTMLDivElement>(null)

  const { handleScrollA: handleGridScroll } = useScrollSync(calendarGridRef, timeLabelsRef)
  const { dragOverCell, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropWeek({
    gridRef: calendarGridRef,
    onTaskDrop
  })

  // Update current time (every minute)
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Get week dates (7 days, starting Monday)
  const weekDates = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [currentDate])

  // Initial scroll to default hour
  useEffect(() => {
    if (calendarGridRef.current) {
      const scrollPosition = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
      calendarGridRef.current.scrollTop = scrollPosition
      if (timeLabelsRef.current) {
        timeLabelsRef.current.scrollTop = scrollPosition
      }
    }
  }, [])

  // Current time position
  const currentTimePosition = ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100

  // Drop handler with config
  const onDrop = useCallback((e: React.DragEvent) => {
    handleDrop(e, { dates: weekDates, hours: HOURS })
  }, [handleDrop, weekDates])

  // Group events by day and calculate layout
  const dayEventLayouts = useMemo(() => {
    const layouts: Record<number, { event: CalendarEvent, position: ReturnType<typeof calculateEventLayout>[string] }[]> = {}

    weekDates.forEach((date, index) => {
      const dayEvents = events.filter(e => isSameDay(new Date(e.start_time), date))
      const layout = calculateEventLayout(dayEvents)

      layouts[index] = dayEvents.map(event => ({
        event,
        position: layout[event.id]
      })).filter(item => item.position)
    })
    return layouts
  }, [events, weekDates])

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      {/* Fixed Header */}
      <div className="flex h-12 flex-shrink-0 border-b bg-background z-20 shadow-sm relative mr-[15px]">
        {/* Time Labels Header (Spacer) */}
        <div className="flex-shrink-0 w-12 bg-transparent border-r border-border/20" />

        {/* Days Header */}
        <div className="flex-1 grid grid-cols-7">
          {weekDates.map((date) => {
            const isTodayDate = isToday(date)
            return (
              <div
                key={date.getTime()}
                className={cn(
                  "flex flex-col items-center justify-center border-r border-border/20 last:border-r-0 pb-1 pt-1",
                  isTodayDate ? "bg-primary/5" : ""
                )}
              >
                <div className={cn(
                  "text-[10px] font-medium uppercase tracking-wide opacity-80",
                  isTodayDate ? "text-primary font-bold" : "text-muted-foreground"
                )}>
                  {format(date, 'EEEE').charAt(0)}
                </div>
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 text-sm rounded-full mt-0.5",
                  isTodayDate ? "bg-primary text-primary-foreground font-bold" : "text-foreground font-medium"
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
          className="flex-shrink-0 w-12 bg-background border-r border-border/20 overflow-hidden relative"
        >
          <div className="relative" style={{ height: DAY_TOTAL_HEIGHT }}>
            {HOURS.map((hour) => (
              <div key={hour} className="absolute w-full flex justify-end pr-2 text-[10px] font-medium text-muted-foreground" style={{ top: hour * HOUR_HEIGHT - 6 }}>
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
            style={{ height: DAY_TOTAL_HEIGHT, minWidth: MIN_GRID_WIDTH_WEEK }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={onDrop}
          >
            {/* Horizontal Grid Lines */}
            {HOURS.map((hour) => (
              <div key={`grid-${hour}`} className="absolute w-full border-t border-border/20" style={{ top: hour * HOUR_HEIGHT }} />
            ))}

            {/* Vertical Day Lines */}
            <div className="absolute inset-0 grid grid-cols-7 h-full pointer-events-none">
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`col-${col}`} className="border-r border-border/20 h-full w-full" />
              ))}
            </div>

            {/* Current Time Indicator */}
            {weekDates.map((date, index) => {
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
                      className="absolute w-2 h-2 rounded-full bg-red-500 z-40 ring-2 ring-background left-[-5px]"
                    />
                    <div className="h-[2px] bg-red-500 w-full opacity-60" />
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
                    className="absolute bg-primary/10 z-10 pointer-events-none"
                    style={{
                      top: hIndex * HOUR_HEIGHT,
                      left: `${dIndex * (100 / 7)}%`,
                      width: `${100 / 7}%`,
                      height: HOUR_HEIGHT
                    }}
                  >
                    <div className="bg-primary text-primary-foreground text-xs px-2 py-1 inline-block m-1 rounded shadow-sm">
                      {String(HOURS[hIndex]).padStart(2, '0')}:00
                    </div>
                  </div>
                )
              })()
            )}

            {/* Events Layer */}
            <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
              {weekDates.map((_, dayIndex) => {
                const dayItems = dayEventLayouts[dayIndex] || []

                return (
                  <div key={`events-${dayIndex}`} className="relative h-full w-full">
                    {dayItems.map(({ event, position }) => (
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
                          isDraggable={false}
                          className="h-full shadow-sm text-xs"
                        />
                      </div>
                    ))}
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
