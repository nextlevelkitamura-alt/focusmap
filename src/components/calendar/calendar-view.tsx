"use client"

import { useState, useCallback } from "react"
import { CalendarHeader, ViewMode } from "./calendar-header"
import { CalendarWeekView } from "./calendar-week-view"
import { CalendarMonthView } from "./calendar-month-view"

interface CalendarViewProps {
  onTaskDrop?: (taskId: string, dateTime: Date) => void
}

export function CalendarView({ onTaskDrop }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())

  // 今日に戻る
  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // 日付変更
  const handleDateChange = useCallback((date: Date) => {
    setCurrentDate(date)
  }, [])

  return (
    <div className="w-full h-full flex flex-col bg-background border rounded overflow-hidden">
      {/* Header */}
      <CalendarHeader
        viewMode={viewMode}
        currentDate={currentDate}
        onViewModeChange={setViewMode}
        onDateChange={handleDateChange}
        onToday={handleToday}
      />

      {/* View Content */}
      {viewMode === 'week' ? (
        <CalendarWeekView
          currentDate={currentDate}
          onTaskDrop={onTaskDrop}
        />
      ) : (
        <CalendarMonthView
          currentDate={currentDate}
          onTaskDrop={onTaskDrop}
        />
      )}
    </div>
  )
}
