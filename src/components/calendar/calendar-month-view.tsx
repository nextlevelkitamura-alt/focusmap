"use client"

import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay } from "date-fns"
import { ja } from "date-fns/locale"
import { useDrag } from "@/contexts/DragContext"
import { Calendar as CalendarIcon } from "lucide-react"

interface CalendarMonthViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
}

export function CalendarMonthView({ currentDate, onTaskDrop }: CalendarMonthViewProps) {
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { dragState } = useDrag()
  const isDragging = dragState.isDragging

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
            className="py-1.5 text-center text-xs font-semibold"
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

          return (
            <div
              key={dayStr}
              className={cn(
                "relative p-1 border-b border-r border-border/30 transition-all duration-200",
                !isCurrentMonth && "bg-muted/20",
                // ドラッグ中は全体的に薄くハイライト
                isDragging && isCurrentMonth && "bg-primary/5",
                // ホバー中のセルは強調
                isHighlighted && "bg-primary/15 ring-2 ring-primary ring-inset shadow-sm scale-[1.02] z-10",
                isToday && "bg-primary/5",
                "pointer-events-none"
              )}
            >
              {/* Day Number */}
              <span className={cn(
                "inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full",
                !isCurrentMonth && "text-muted-foreground",
                isToday && "bg-primary text-primary-foreground"
              )}>
                {format(date, 'd')}
              </span>

              {/* Enhanced Drop indicator */}
              {isHighlighted && (
                <div className="absolute inset-1 flex flex-col items-center justify-center animate-in zoom-in duration-200">
                  <div className="flex flex-col items-center gap-1 bg-primary text-primary-foreground text-[10px] px-2 py-1.5 rounded-lg shadow-lg">
                    <CalendarIcon className="w-3 h-3" />
                    <span className="font-medium">{format(date, 'M/d')}</span>
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
