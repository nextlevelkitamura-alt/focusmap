import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns"
import { ja } from "date-fns/locale"
import { useDrag } from "@/contexts/DragContext"
import { Calendar as CalendarIcon } from "lucide-react"
import { CalendarEvent } from "@/types/calendar"

interface CalendarMonthViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  events?: CalendarEvent[]
  onEventClick?: (eventId: string) => void
}

export function CalendarMonthView({
  currentDate,
  onTaskDrop,
  events = [],
  onEventClick
}: CalendarMonthViewProps) {
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { dragState } = useDrag()
  const isDragging = dragState.isDragging

  // Specific events for day
  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventStart = new Date(event.start_time)
      return isSameDay(eventStart, date)
    })
  }

  // Generate month days (Mon start)
  const getMonthDays = () => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }

  const monthDays = getMonthDays()
  const weekDays = ['月', '火', '水', '木', '金', '土', '日']

  // Drag Handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / (monthDays.length / 7) // dynamic rows

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    const index = row * 7 + col
    if (index >= 0 && index < monthDays.length) {
      const dayStr = format(monthDays[index], 'yyyy-MM-dd')
      setDragOverDay(dayStr)
    }
  }, [monthDays])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverDay(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverDay(null)

    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / (monthDays.length / 7)

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    const index = row * 7 + col
    if (index >= 0 && index < monthDays.length) {
      const targetDate = new Date(monthDays[index])
      targetDate.setHours(9, 0, 0, 0)
      onTaskDrop?.(taskId, targetDate)
    }
  }, [monthDays, onTaskDrop])

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 border-b bg-background pointer-events-none">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Month Grid */}
      <div
        ref={gridRef}
        className="flex-1 grid grid-cols-7 grid-rows-6" // Fixed 6 rows for consistency
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {monthDays.map((date, index) => {
          // If we have fewer than 6 weeks (e.g. 5), the last row(s) might be empty or next month.
          // Since we map all days, grid-rows-6 might leave space if we only have 35 days.
          // But usually we just fill.

          const dayStr = format(date, 'yyyy-MM-dd')
          const isCurrentMonth = isSameMonth(date, currentDate)
          const isTodayDate = isToday(date)
          const isHighlighted = dragOverDay === dayStr
          const dayEvents = getEventsForDay(date)
          const maxDisplayEvents = 4 // Increased from 3

          return (
            <div
              key={dayStr}
              className={cn(
                "relative p-1 border-b border-r border-border/10 transition-all duration-200 flex flex-col min-h-0",
                !isCurrentMonth && "bg-muted/5 text-muted-foreground",
                // Highlight drop target
                isHighlighted && "bg-primary/10 ring-2 ring-primary ring-inset z-10",
                "pointer-events-auto hover:bg-muted/5"
              )}
            >
              {/* Day Number */}
              <div className="flex justify-center mb-1">
                <span className={cn(
                  "text-[12px] font-medium w-6 h-6 flex items-center justify-center rounded-full",
                  isTodayDate
                    ? "bg-primary text-primary-foreground shadow-sm font-bold"
                    : "text-foreground/80 hover:bg-muted"
                )}>
                  {date.getDate() === 1 ? format(date, 'M月d日', { locale: ja }) : format(date, 'd')}
                </span>
              </div>

              {/* Events List */}
              <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                {dayEvents.slice(0, maxDisplayEvents).map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event.id);
                    }}
                    className="text-left text-[10px] px-1.5 py-0.5 rounded-[3px] truncate transition-opacity hover:opacity-80 shadow-sm border border-transparent leading-tight font-medium"
                    style={{
                      // Google Calendar uses background color for the event bar
                      backgroundColor: event.background_color || '#039BE5',
                      color: '#fff', // Typically white text on colored bg for month view "chips"
                      // Use simpler styling without borders for month view chips
                    }}
                    title={event.title}
                  >
                    {event.is_all_day ? '' : format(new Date(event.start_time), 'HH:mm ')}
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > maxDisplayEvents && (
                  <span className="text-[10px] text-foreground/70 pl-1 font-medium hover:underline cursor-pointer">
                    他 {dayEvents.length - maxDisplayEvents} 件
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
