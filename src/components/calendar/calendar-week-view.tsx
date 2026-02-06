import { useState, useCallback, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { isSameDay, getHours, getMinutes } from "date-fns"
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

const HOUR_HEIGHT = 64 // h-16 = 64px

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

  // 現在時刻の更新（1分毎）
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // 現在時刻のトップ位置（%）
  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours()
    const minutes = currentTime.getMinutes()
    return ((hours * 60 + minutes) / (24 * 60)) * 100
  }

  // 指定された週の日付を取得（今日を中心に前後1日、合計3日）
  const getWeekDates = () => {
    const today = new Date(currentDate) // currentDateを使用するように変更
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    return [yesterday, today, tomorrow]
  }

  const weekDates = getWeekDates()
  // 00:00から23:00までの24時間配列
  const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

  // 初期スクロール位置を9時に設定
  useEffect(() => {
    if (calendarGridRef.current) {
      const scrollPosition = 9 * HOUR_HEIGHT
      calendarGridRef.current.scrollTop = scrollPosition

      if (timeLabelsRef.current) {
        timeLabelsRef.current.scrollTop = scrollPosition
      }
    }
  }, [])

  // スクロール同期: カレンダーグリッド → 時間ラベル
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

  // スクロール同期: 時間ラベル → カレンダーグリッド
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

  // ドラッグオーバー処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = calendarGridRef.current?.scrollTop || 0

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 3
    const cellHeight = HOUR_HEIGHT

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / cellHeight)

    if (dayIndex >= 0 && dayIndex < 3 && hourIndex >= 0 && hourIndex < 24) {
      setDragOverCell(`${dayIndex}-${hourIndex}`)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverCell(null)
    }
  }, [])

  // ドロップ処理
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

    const cellWidth = rect.width / 3
    const cellHeight = HOUR_HEIGHT

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / cellHeight)

    if (dayIndex >= 0 && dayIndex < 3 && hourIndex >= 0 && hourIndex < 24) {
      const hour = hours[hourIndex]
      const targetDate = new Date(weekDates[dayIndex])
      targetDate.setHours(hour, 0, 0, 0)

      onTaskDrop?.(taskId, targetDate)
    }
  }, [weekDates, hours, onTaskDrop])

  const formatDate = (date: Date) => {
    const days = ['日', '月', '火', '水', '木', '金', '土']
    return {
      day: days[date.getDay()],
      date: date.getDate(),
      month: date.getMonth() + 1
    }
  }

  // イベントを日付ごとにグループ化
  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventStart = new Date(event.start_time)
      return isSameDay(eventStart, date)
    })
  }

  // イベントの位置を計算（0時基準）
  const getEventPosition = (event: CalendarEvent) => {
    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)

    const startHour = getHours(startTime)
    const startMinute = getMinutes(startTime)
    const endHour = getHours(endTime)
    const endMinute = getMinutes(endTime)

    // 0時基準で計算
    const startOffsetInMinutes = startHour * 60 + startMinute
    const totalMinutes = 24 * 60

    const startOffset = startOffsetInMinutes / totalMinutes
    const durationInMinutes = (endHour * 60 + endMinute) - startOffsetInMinutes
    const duration = Math.max(durationInMinutes / totalMinutes, 0.02)

    return {
      top: `${startOffset * 100}%`,
      height: `${duration * 100}%`
    }
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      {/* 固定ヘッダー */}
      <div className="flex h-12 flex-shrink-0 border-b bg-muted/5">
        {/* Time Labels Header (空のスペース) */}
        <div className="flex-shrink-0 w-12 border-r bg-muted/20" />

        {/* Days Header */}
        <div className="flex-1 grid grid-cols-3 pointer-events-none">
          {weekDates.map((date, i) => {
            const { day, date: dateNum } = formatDate(date)
            const isToday = isSameDay(date, currentTime)
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center justify-center transition-colors border-r last:border-r-0",
                  isToday ? "bg-primary/5" : ""
                )}
              >
                <div className={cn(
                  "text-[10px] font-medium uppercase tracking-wide",
                  isToday ? "text-primary" : "text-muted-foreground"
                )}>
                  {day}
                </div>
                <div className={cn(
                  "text-sm font-bold leading-none",
                  isToday ? "text-primary" : "text-foreground"
                )}>
                  {dateNum}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* スクロール可能なボディエリア */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Time Labels - スクロール可能 (スクロールバー非表示) */}
        <div
          ref={timeLabelsRef}
          className="flex-shrink-0 w-12 border-r bg-background overflow-y-auto no-scrollbar"
          onScroll={handleTimeLabelsScroll}
        >
          <div className="relative h-[1536px]"> {/* 24 * 64px = 1536px */}
            {hours.map((hour) => (
              <div key={hour} className="absolute w-full flex justify-end pr-1.5" style={{ top: `${hour * 64}px` }}>
                <span className="text-[10px] font-medium text-muted-foreground -translate-y-1/2 bg-background px-0.5">
                  {hour > 0 && `${hour}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Calendar Grid - スクロール可能 (スクロールバー表示) */}
        <div
          ref={calendarGridRef}
          className="flex-1 overflow-y-auto relative no-scrollbar"
          onScroll={handleCalendarGridScroll}
        >
          <div
            className="relative h-[1536px]"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Grid Lines */}
            {hours.map((hour) => (
              <div key={`grid-${hour}`} className="absolute w-full border-t border-border/20" style={{ top: `${hour * 64}px` }} />
            ))}

            {/* Vertical Day Lines */}
            <div className="absolute inset-0 grid grid-cols-3 h-full pointer-events-none">
              {[0, 1, 2].map((col) => (
                <div key={`col-${col}`} className="border-r border-border/20 h-full w-full" />
              ))}
            </div>

            {/* Current Time Indicator */}
            {weekDates.map((date, index) => {
              if (isSameDay(date, currentTime)) {
                return (
                  <div
                    key="now-indicator"
                    className="absolute z-30 w-1/3 flex items-center pointer-events-none"
                    style={{
                      top: `${getCurrentTimePosition()}%`,
                      left: `${(index) * 33.333}%`
                    }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 border border-background shadow-sm" />
                    <div className="h-px bg-red-500 w-full" />
                  </div>
                )
              }
              return null
            })}

            {/* Drop Zones (Invisible but interactive) */}
            <div className="absolute inset-0 grid grid-cols-3 h-full">
              {hours.map((hour, hourIndex) => (
                weekDates.map((date, dayIndex) => {
                  const cellId = `${dayIndex}-${hourIndex}`
                  const isHighlighted = dragOverCell === cellId
                  return (
                    <div
                      key={cellId}
                      className={cn(
                        "absolute w-1/3 h-16",
                        isDragging && "z-10",
                        isHighlighted && "bg-primary/20 transition-colors z-20"
                      )}
                      style={{
                        top: hourIndex * 64,
                        left: `${dayIndex * 33.333}%`
                      }}
                    >
                      {isHighlighted && (
                        <div className="w-full h-full flex items-center justify-center p-2">
                          <div className="bg-primary/90 text-primary-foreground text-xs px-2 py-1 rounded shadow-sm">
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              ))}
            </div>

            {/* Events Layer */}
            <div className="absolute inset-0 grid grid-cols-3 pointer-events-none">
              {weekDates.map((date, dayIndex) => {
                const dayEvents = getEventsForDay(date)
                return (
                  <div key={`events-${dayIndex}`} className="relative h-full">
                    {dayEvents.map((event) => {
                      const position = getEventPosition(event)
                      return (
                        <div
                          key={event.id}
                          className="absolute left-0 right-0 px-0.5 pointer-events-auto"
                          style={{
                            top: position.top,
                            height: position.height,
                            zIndex: 20
                          }}
                        >
                          <CalendarEventCard
                            event={event}
                            onEdit={onEventEdit}
                            onDelete={onEventDelete}
                            isDraggable={false}
                            className="h-full shadow-sm"
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
