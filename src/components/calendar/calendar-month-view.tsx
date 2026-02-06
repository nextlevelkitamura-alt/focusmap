import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay } from "date-fns"
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

  // 特定の日のイベントを取得
  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventStart = new Date(event.start_time)
      return isSameDay(eventStart, date)
    })
  }

  // 月のカレンダー日付を生成（月曜始まり）
  const getMonthDays = () => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }

  const monthDays = getMonthDays()
  const weekDays = ['月', '火', '水', '木', '金', '土', '日']

  // ドラッグオーバー処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    // ドロップ位置から日付を特定
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / 6

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    if (col >= 0 && col < 7 && row >= 0 && row < 6) {
      const index = row * 7 + col
      if (index < monthDays.length) {
        const dayStr = format(monthDays[index], 'yyyy-MM-dd')
        setDragOverDay(dayStr)
      }
    }
  }, [monthDays])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // コンテナから完全に離れた場合のみクリア
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverDay(null)
    }
  }, [])

  // ドロップ処理
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverDay(null)

    const taskId = e.dataTransfer.getData('text/plain')
    console.log('[CalendarMonthView] Drop - taskId:', taskId)

    if (!taskId) {
      console.log('[CalendarMonthView] No taskId found')
      return
    }

    // ドロップ位置から日付を計算
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / 6

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    if (col >= 0 && col < 7 && row >= 0 && row < 6) {
      const index = row * 7 + col
      if (index < monthDays.length) {
        const targetDate = new Date(monthDays[index])
        targetDate.setHours(9, 0, 0, 0)

        console.log('[CalendarMonthView] Task dropped:', { taskId, dateTime: targetDate })

        onTaskDrop?.(taskId, targetDate)
      }
    }
  }, [monthDays, onTaskDrop])

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Weekday Headers */}
      <div className="grid grid-cols-7 border-b bg-muted/30 pointer-events-none">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-1.5 text-center text-xs font-semibold text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Month Grid - Drop Zone */}
      <div
        ref={gridRef}
        className="flex-1 grid grid-cols-7 grid-rows-6"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {monthDays.map((date) => {
          const dayStr = format(date, 'yyyy-MM-dd')
          const isCurrentMonth = isSameMonth(date, currentDate)
          const isToday = isSameDay(date, new Date())
          const isHighlighted = dragOverDay === dayStr
          const dayEvents = getEventsForDay(date)
          const maxDisplayEvents = 3

          return (
            <div
              key={dayStr}
              className={cn(
                "relative p-1 border-b border-r border-border/10 transition-all duration-200 flex flex-col min-h-[80px]",
                !isCurrentMonth && "bg-muted/10 text-muted-foreground",
                // ドラッグ中は全体的に薄くハイライト
                isDragging && isCurrentMonth && "bg-primary/5",
                // ホバー中のセルは強調
                isHighlighted && "bg-primary/10 ring-2 ring-primary ring-inset shadow-sm z-10",
                isToday && "bg-primary/5",
                "pointer-events-auto"
              )}
            >
              {/* Day Number */}
              <div className="flex justify-center mb-1">
                <span className={cn(
                  "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                  isToday ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground/80"
                )}>
                  {format(date, 'd')}
                </span>
              </div>

              {/* イベント表示（最大3件） */}
              {dayEvents.length > 0 && (
                <div className="flex flex-col gap-1 flex-1 overflow-hidden">
                  {dayEvents.slice(0, maxDisplayEvents).map((event) => (
                    <button
                      key={event.id}
                      onClick={() => onEventClick?.(event.id)}
                      className="text-left text-[10px] px-1.5 py-0.5 rounded-sm truncate transition-opacity hover:opacity-80 shadow-sm border border-transparent"
                      style={{
                        backgroundColor: event.background_color || '#E3F2FD',
                        color: event.color || '#1976D2',
                        borderColor: event.color ? `${event.color}30` : 'transparent'
                      }}
                      title={event.title}
                    >
                      {event.title}
                    </button>
                  ))}
                  {dayEvents.length > maxDisplayEvents && (
                    <span className="text-[9px] text-muted-foreground pl-1 font-medium">
                      +{dayEvents.length - maxDisplayEvents} more
                    </span>
                  )}
                </div>
              )}

              {/* Enhanced Drop indicator */}
              {isHighlighted && (
                <div className="absolute inset-1 flex flex-col items-center justify-center animate-in zoom-in duration-200 bg-primary/10 backdrop-blur-[1px] rounded-sm">
                  <div className="flex flex-col items-center gap-1 bg-primary text-primary-foreground text-[10px] px-2 py-1.5 rounded-lg shadow-lg">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span className="font-medium whitespace-nowrap">Schedule Here</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
