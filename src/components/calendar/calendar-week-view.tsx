"use client"

import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns"
import { useDrag } from "@/contexts/DragContext"
import { Calendar as CalendarIcon } from "lucide-react"

interface CalendarWeekViewProps {
  currentDate: Date
  onTaskDrop?: (taskId: string, dateTime: Date) => void
}

export function CalendarWeekView({ currentDate, onTaskDrop }: CalendarWeekViewProps) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { dragState } = useDrag()
  const isDragging = dragState.isDragging

  // 指定された週の日付を取得（月曜始まり、月〜金のみ）
  const getWeekDates = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
    const allDays = eachDayOfInterval({ start: weekStart, end: weekEnd })
    return allDays.slice(0, 5)
  }

  const weekDates = getWeekDates()
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

  // ドラッグオーバー処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    // ドロップ位置からセルを特定
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 5
    const cellHeight = rect.height / 10

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor(y / cellHeight)

    if (dayIndex >= 0 && dayIndex < 5 && hourIndex >= 0 && hourIndex < 10) {
      setDragOverCell(`${dayIndex}-${hourIndex}`)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // コンテナから完全に離れた場合のみクリア
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

    // ドラッグされたタスクIDを取得
    const taskId = e.dataTransfer.getData('text/plain')
    console.log('[CalendarWeekView] Drop - taskId:', taskId)

    if (!taskId) {
      console.log('[CalendarWeekView] No taskId found')
      return
    }

    // ドロップ位置から日時を計算
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 5
    const cellHeight = rect.height / 10

    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor(y / cellHeight)

    if (dayIndex >= 0 && dayIndex < 5 && hourIndex >= 0 && hourIndex < 10) {
      const hour = hours[hourIndex]
      const targetDate = new Date(weekDates[dayIndex])
      targetDate.setHours(hour, 0, 0, 0)

      console.log('[CalendarWeekView] Task dropped:', { taskId, dateTime: targetDate })

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

  return (
    <div
      ref={containerRef}
      className="w-full h-full grid grid-cols-5 grid-rows-[auto_1fr] bg-background"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Days Header - 月日を表示 */}
      <div className="col-span-5 grid grid-cols-5 border-b bg-gradient-to-b from-muted/10 to-transparent pointer-events-none">
        {weekDates.map((date, i) => {
          const { day, date: dateNum, month } = formatDate(date)
          const isToday = new Date().toDateString() === date.toDateString()
          return (
            <div
              key={i}
              className={cn(
                "py-3 text-center transition-colors",
                isToday && "bg-primary/10"
              )}
            >
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {day}
              </div>
              <div className={cn(
                "text-xl font-bold mt-1",
                isToday ? "text-primary" : "text-foreground"
              )}>
                {month}/{dateNum}
              </div>
            </div>
          )
        })}
      </div>

      {/* Time Grid - Drop Zone */}
      <div className="col-span-5 relative grid grid-rows-10 divide-y divide-border/30 pointer-events-none">
        {hours.map((hour, hourIndex) => (
          <div key={hour} className="relative h-full">
            {/* Time Label */}
            <span className="absolute -left-10 -top-2 text-[10px] text-muted-foreground/70 font-medium w-8 text-right block group-first:hidden">
              {hour > 12 ? hour - 12 : hour} {hour >= 12 ? 'PM' : 'AM'}
            </span>

            {/* Drop Zones with Enhanced Feedback */}
            <div className="absolute inset-0 grid grid-cols-5 gap-px">
              {weekDates.map((date, dayIndex) => {
                const cellId = `${dayIndex}-${hourIndex}`
                const isHighlighted = dragOverCell === cellId

                return (
                  <div
                    key={cellId}
                    className={cn(
                      "w-full h-full transition-all duration-200 border-r border-border/20 relative",
                      // ドラッグ中は全体的に薄くハイライト
                      isDragging && "bg-primary/5",
                      // ホバー中のセルは強調
                      isHighlighted && "bg-primary/15 shadow-inner border-primary/50 scale-[1.02] z-10"
                    )}
                  >
                    {/* ドロップヒント - ホバー中に表示 */}
                    {isHighlighted && (
                      <div className="absolute inset-0 flex items-center justify-center animate-in zoom-in duration-200">
                        <div className="flex flex-col items-center gap-1 bg-primary text-primary-foreground text-[10px] px-2 py-1.5 rounded-lg shadow-lg">
                          <CalendarIcon className="w-3 h-3" />
                          <span className="font-medium">ここにドロップ</span>
                          <span className="text-[9px] opacity-80">
                            {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'PM' : 'AM'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
