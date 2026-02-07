import { useCallback, useRef, useMemo } from "react"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns"
import { useCalendarDragDropMonth } from "@/hooks/useCalendarDragDrop"
import { CalendarEvent } from "@/types/calendar"

interface CalendarMonthViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  events?: CalendarEvent[]
  onEventClick?: (eventId: string) => void
}

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']
const MAX_DISPLAY_EVENTS = 5

export function CalendarMonthView({
  currentDate,
  onTaskDrop,
  events = [],
  onEventClick
}: CalendarMonthViewProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const { dragOverDay, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropMonth({ onTaskDrop })

  // Generate month days (Mon start)
  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [currentDate])

  // Get events for a specific day
  const getEventsForDay = useCallback((date: Date) => {
    return events
      .filter(event => isSameDay(new Date(event.start_time), date))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  }, [events])

  const onDragOver = useCallback((e: React.DragEvent) => handleDragOver(e, monthDays), [handleDragOver, monthDays])
  const onDrop = useCallback((e: React.DragEvent) => handleDrop(e, monthDays), [handleDrop, monthDays])

  return (
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 border-b border-border/20 bg-background pointer-events-none shrink-0">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase opacity-80"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Month Grid */}
      <div
        ref={gridRef}
        className="flex-1 grid grid-cols-7 grid-rows-6 bg-background gap-0 overflow-hidden"
        onDragOver={onDragOver}
        onDragLeave={handleDragLeave}
        onDrop={onDrop}
      >
        {monthDays.map((date) => {
          const dayStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const isCurrentMonth = isSameMonth(date, currentDate)
          const isTodayDate = isToday(date)
          const isHighlighted = dragOverDay === dayStr
          const dayEvents = getEventsForDay(date)

          return (
            <div
              key={dayStr}
              className={cn(
                "relative p-1.5 border border-border/20 transition-all duration-200 flex flex-col min-h-0 overflow-hidden",
                !isCurrentMonth && "bg-muted/5 text-muted-foreground/60",
                isHighlighted && "bg-primary/10 ring-2 ring-primary ring-inset z-10",
                "pointer-events-auto hover:bg-muted/5"
              )}
            >
              {/* Day Number */}
              <div className="flex justify-start mb-1">
                <span className={cn(
                  "text-[11px] w-6 h-6 flex items-center justify-center rounded-full transition-colors flex-shrink-0",
                  isTodayDate
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-foreground/90 font-medium opacity-80"
                )}>
                  {date.getDate() === 1 ? format(date, 'M/d') : date.getDate()}
                </span>
              </div>

              {/* Events List */}
              <div className="flex flex-col gap-0.5 flex-1 overflow-hidden min-h-0">
                {dayEvents.slice(0, MAX_DISPLAY_EVENTS).map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick?.(event.id)
                    }}
                    className="text-left text-[9px] px-1 py-0.5 rounded-[2px] truncate transition-opacity hover:opacity-80 shadow-sm border border-transparent leading-tight font-medium whitespace-nowrap"
                    style={{
                      backgroundColor: event.background_color || '#039BE5',
                      color: '#ffffff',
                      boxShadow: '0 1px 1px rgba(0,0,0,0.05)'
                    }}
                    title={event.title}
                  >
                    {!event.is_all_day && (
                      <span className="opacity-90 font-normal text-[8px]">
                        {format(new Date(event.start_time), 'HH:mm')}
                      </span>
                    )}
                    <span className="font-semibold truncate">{event.title}</span>
                  </button>
                ))}
                {dayEvents.length > MAX_DISPLAY_EVENTS && (
                  <span className="text-[8px] text-foreground/70 pl-1 font-medium cursor-pointer block truncate">
                    +{dayEvents.length - MAX_DISPLAY_EVENTS}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
