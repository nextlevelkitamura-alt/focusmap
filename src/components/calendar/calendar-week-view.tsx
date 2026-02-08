import { useState, useCallback, useRef, useEffect, useMemo, RefObject } from "react"
import { cn } from "@/lib/utils"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DAY_TOTAL_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS, MIN_GRID_WIDTH_WEEK } from "@/lib/calendar-constants"
import { useCalendarDragDropWeek } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { startOfWeek, addDays, isSameDay, format, isToday } from "date-fns"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"

interface CalendarWeekViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  onEventTimeChange?: (eventId: string, newStartTime: Date, newEndTime: Date) => void
  events?: CalendarEvent[]
  onEventEdit?: (eventId: string) => void
  onEventDelete?: (eventId: string) => void
  onDateChange?: (date: Date) => void
  hourHeight?: number // ズーム機能用
  gridRef?: RefObject<HTMLDivElement | null> // ズーム機能用
}

export function CalendarWeekView({
  currentDate,
  onTaskDrop,
  onEventTimeChange,
  events = [],
  onEventEdit,
  onEventDelete,
  onDateChange,
  hourHeight = HOUR_HEIGHT,
  gridRef
}: CalendarWeekViewProps) {
  const [currentTime, setCurrentTime] = useState(new Date())
  const timeLabelsRef = useRef<HTMLDivElement>(null)
  const calendarGridRef = gridRef || useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // スワイプナビゲーション
  const { swipeDirection } = useSwipeNavigation({
    containerRef,
    onSwipeLeft: () => onDateChange?.(addDays(currentDate, 7)), // 1週進む
    onSwipeRight: () => onDateChange?.(addDays(currentDate, -7)), // 1週戻る
    threshold: 50
  })

  const { handleScrollA: handleGridScroll } = useScrollSync(calendarGridRef, timeLabelsRef)
  const { dragOverCell, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropWeek({
    gridRef: calendarGridRef,
    onTaskDrop,
    hourHeight
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
      const scrollPosition = DEFAULT_SCROLL_HOUR * hourHeight
      calendarGridRef.current.scrollTop = scrollPosition
      if (timeLabelsRef.current) {
        timeLabelsRef.current.scrollTop = scrollPosition
      }
    }
  }, [hourHeight])

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

  const totalHeight = hourHeight * 24

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
        {/* Time Labels Header (Spacer) */}
        <div className="flex-shrink-0 w-14 bg-transparent border-r border-border/10" />

        {/* Days Header */}
        <div className="flex-1 grid grid-cols-7">
          {weekDates.map((date) => {
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
            style={{ height: totalHeight, minWidth: MIN_GRID_WIDTH_WEEK }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={onDrop}
          >
            {/* Horizontal Grid Lines */}
            {HOURS.map((hour) => (
              <div key={`grid-${hour}`} className="absolute w-full border-t border-border/8" style={{ top: hour * hourHeight }} />
            ))}

            {/* Vertical Day Lines */}
            <div className="absolute inset-0 grid grid-cols-7 h-full pointer-events-none">
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`col-${col}`} className="border-r border-border/10 h-full w-full" />
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
                      left: `${dIndex * (100 / 7)}%`,
                      width: `${100 / 7}%`,
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
            <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
              {weekDates.map((_, dayIndex) => {
                const dayItems = dayEventLayouts[dayIndex] || []

                return (
                  <div key={`events-${dayIndex}`} className="relative h-full w-full">
                    {dayItems.map(({ event, position }) => {
                      // eventHeightをpx単位で計算
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
                            isDraggable={false}
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
