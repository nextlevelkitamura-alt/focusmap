import { useCallback, useRef, useMemo } from "react"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns"
import { ja } from "date-fns/locale"
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
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 border-b border-border/10 bg-background pointer-events-none">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-1.5 text-center text-[11px] font-semibold text-muted-foreground uppercase opacity-80"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Month Grid */}
      <div
        ref={gridRef}
        className="flex-1 grid grid-cols-7 grid-rows-6 bg-background"
        onDragOver={onDragOver}
        onDragLeave={handleDragLeave}
        onDrop={onDrop}
      >
        {monthDays.map((date, index) => {
          const dayStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const isCurrentMonth = isSameMonth(date, currentDate)
          const isTodayDate = isToday(date)
          const isHighlighted = dragOverDay === dayStr
          const dayEvents = getEventsForDay(date)

          // Determine row index to remove bottom border for last row
          const rowIndex = Math.floor(index / 7)
          const isLastRow = rowIndex === 5

          return (
            <div
              key={dayStr}
              className={cn(
                "relative p-1 border-r border-border/10 transition-all duration-200 flex flex-col min-h-0",
                !isLastRow && "border-b border-border/10",
                (index + 1) % 7 === 0 && "border-r-0", // Remove right border for last column each row? No, actually grid borders are tricky. Let's keep right border except fast one.
                !isCurrentMonth && "bg-muted/5 text-muted-foreground",
                isHighlighted && "bg-primary/10 ring-2 ring-primary ring-inset z-10",
                "pointer-events-auto hover:bg-muted/5"
              )}
            >
              {/* Day Number */}
              <div className="flex justify-center mb-1 py-0.5">
                <span className={cn(
                  "text-[12px] w-6 h-6 flex items-center justify-center rounded-full transition-colors",
                  isTodayDate
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-foreground/90 font-medium hover:bg-muted/50 opacity-80"
                )}>
                  {date.getDate() === 1 ? format(date, 'M月d日', { locale: ja }) : format(date, 'd')}
                </span>
              </div>

              {/* Events List */}
              <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                {dayEvents.slice(0, MAX_DISPLAY_EVENTS).map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick?.(event.id)
                    }}
                    className="text-left text-[10px] px-1.5 py-0.5 rounded-[3px] truncate transition-opacity hover:opacity-80 shadow-sm border border-transparent leading-tight font-medium"
                    style={{
                      backgroundColor: event.background_color || '#039BE5',
                      color: '#ffffff', // Always white for better visibility on colored chips in month view usually
                      boxShadow: '0 1px 1px rgba(0,0,0,0.05)'
                    }}
                    title={event.title}
                  >
                    <span className="opacity-90 mr-1 font-normal text-[9px]">
                      {event.is_all_day ? '' : format(new Date(event.start_time), 'HH:mm')}
                    </span>
                    <span className="font-semibold">{event.title}</span>
                  </button>
                ))}
                {dayEvents.length > MAX_DISPLAY_EVENTS && (
                  <span className="text-[10px] text-foreground/70 pl-1 font-medium hover:underline cursor-pointer block mt-0.5">
                    他 {dayEvents.length - MAX_DISPLAY_EVENTS} 件
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
