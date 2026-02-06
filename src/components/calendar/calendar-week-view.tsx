import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
// Use the new layout algorithm
import { calculateEventLayout } from "@/lib/calendar-layout"
import { startOfWeek, addDays, isSameDay, format, isToday } from "date-fns"
import { ja } from "date-fns/locale"
import { useDrag } from "@/contexts/DragContext"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"

interface CalendarWeekViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  events?: CalendarEvent[]
  onEventEdit?: (eventId: string) => void
  onEventDelete?: (eventId: string) => void
}

const HOUR_HEIGHT = 64 // 64px per hour

export function CalendarWeekView({
  currentDate,
  onTaskDrop,
  events = [],
  onEventEdit,
  onEventDelete
}: CalendarWeekViewProps) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const timeLabelsRef = useRef<HTMLDivElement>(null)
  const calendarGridRef = useRef<HTMLDivElement>(null)
  const isSyncingRef = useRef(false)
  const { dragState } = useDrag()
  const isDragging = dragState.isDragging

  // Update current time (every minute)
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Calculate percentage position for current time
  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours()
    const minutes = currentTime.getMinutes()
    return ((hours * 60 + minutes) / (24 * 60)) * 100
  }

  // Get week dates (7 days, starting Monday)
  const weekDates = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [currentDate])

  const hours = Array.from({ length: 24 }, (_, i) => i)

  // Initial scroll to 9:00
  useEffect(() => {
    if (calendarGridRef.current) {
      const scrollPosition = 9 * HOUR_HEIGHT
      calendarGridRef.current.scrollTop = scrollPosition

      if (timeLabelsRef.current) {
        timeLabelsRef.current.scrollTop = scrollPosition
      }
    }
  }, [])

  // Scroll Sync: Grid -> Labels
  const handleCalendarGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingRef.current) return

    isSyncingRef.current = true
    if (timeLabelsRef.current) {
      timeLabelsRef.current.scrollTop = e.currentTarget.scrollTop
    }
    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }, [])

  // Scroll Sync: Labels -> Grid
  const handleTimeLabelsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingRef.current) return

    isSyncingRef.current = true
    if (calendarGridRef.current) {
      calendarGridRef.current.scrollTop = e.currentTarget.scrollTop
    }
    requestAnimationFrame(() => {
      isSyncingRef.current = false
    })
  }, [])

  // Drag Over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = calendarGridRef.current?.scrollTop || 0

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = HOUR_HEIGHT

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / cellHeight)

    if (dayIndex >= 0 && dayIndex < 7 && hourIndex >= 0 && hourIndex < 24) {
      setDragOverCell(`${dayIndex}-${hourIndex}`)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Logic to clear only if leaving the entire grid area could be added, 
    // but simple clear behaves okay usually. 
    // If needed, check bounds.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverCell(null)
    }
  }, [])

  // Drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverCell(null)

    const taskId = e.dataTransfer.getData('text/plain')

    if (!taskId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = calendarGridRef.current?.scrollTop || 0

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = HOUR_HEIGHT

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / cellHeight)

    if (dayIndex >= 0 && dayIndex < 7 && hourIndex >= 0 && hourIndex < 24) {
      const hour = hours[hourIndex]
      const targetDate = new Date(weekDates[dayIndex])
      targetDate.setHours(hour, 0, 0, 0)

      onTaskDrop?.(taskId, targetDate)
    }
  }, [weekDates, hours, onTaskDrop])

  // Group events by day and calculate layout
  const dayEventLayouts = useMemo(() => {
    const layouts: Record<number, { event: CalendarEvent, position: any }[]> = {};

    weekDates.forEach((date, index) => {
      const dayEvents = events.filter(e => isSameDay(new Date(e.start_time), date));
      const layout = calculateEventLayout(dayEvents);

      layouts[index] = dayEvents.map(event => ({
        event,
        position: layout[event.id]
      })).filter(item => item.position); // Filter out any missing layouts (shouldn't happen)
    });
    return layouts;
  }, [events, weekDates]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      {/* Fixed Header */}
      <div className="flex h-14 flex-shrink-0 border-b bg-background z-20 shadow-sm relative mr-[15px]"> {/* mr to compensate scrollbar if needed, or better use sticky */}
        {/* Time Labels Header (Spacer) */}
        <div className="flex-shrink-0 w-12 bg-transparent" />

        {/* Days Header */}
        <div className="flex-1 grid grid-cols-7">
          {weekDates.map((date, i) => {
            const isTodayDate = isToday(date)
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center justify-center border-r last:border-r-0 pb-1 pt-2",
                )}
              >
                <div className={cn(
                  "text-[11px] font-medium uppercase tracking-wide mb-0.5",
                  isTodayDate ? "text-primary" : "text-muted-foreground"
                )}>
                  {format(date, 'E', { locale: ja })}
                </div>
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 text-lg rounded-full",
                  isTodayDate ? "bg-primary text-primary-foreground font-bold" : "text-foreground font-normal hover:bg-muted"
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
          className="flex-shrink-0 w-12 bg-transparent overflow-hidden relative" // removed border-r, reduced width slightly
        >
          <div className="relative h-[1536px]">
            {hours.map((hour) => (
              <div key={hour} className="absolute w-full flex justify-end pr-2 text-xs text-muted-foreground" style={{ top: `${hour * 64 - 10}px` }}>
                {hour !== 0 && `${hour}:00`}
              </div>
            ))}
          </div>
        </div>

        {/* Calendar Grid */}
        <div
          ref={calendarGridRef}
          className="flex-1 overflow-y-auto relative"
          onScroll={handleCalendarGridScroll}
        >
          <div
            className="relative h-[1536px] min-w-[600px]" // Min width to prevent crushing
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Horizontal Grid Lines */}
            {hours.map((hour) => (
              <div key={`grid-${hour}`} className="absolute w-full border-t border-white/[0.03]" style={{ top: `${hour * 64}px` }} />
            ))}

            {/* Vertical Day Lines */}
            <div className="absolute inset-0 grid grid-cols-7 h-full pointer-events-none">
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`col-${col}`} className="border-r border-white/[0.03] h-full w-full" />
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
                      top: `${getCurrentTimePosition()}%`,
                      left: 0,
                      width: '100%'
                    }}
                  >
                    <div
                      className="absolute w-2.5 h-2.5 rounded-full bg-red-500 z-40"
                      style={{ left: '-5px' }} // Position exactly on the axis
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
                const [dIndex, hIndex] = dragOverCell.split('-').map(Number);
                return (
                  <div
                    className="absolute bg-primary/10 z-10 pointer-events-none"
                    style={{
                      top: hIndex * 64,
                      left: `${dIndex * (100 / 7)}%`,
                      width: `${100 / 7}%`,
                      height: 64
                    }}
                  >
                    <div className="bg-primary text-primary-foreground text-xs px-2 py-1 inline-block m-1 rounded shadow-sm">
                      {String(hours[hIndex]).padStart(2, '0')}:00
                    </div>
                  </div>
                )
              })()
            )}

            {/* Events Layer */}
            <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
              {weekDates.map((date, dayIndex) => {
                const dayItems = dayEventLayouts[dayIndex] || [];

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
                          isDraggable={false} // Todo: Enable drag
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
