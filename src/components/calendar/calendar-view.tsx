"use client"

// Force rebuild: 2026-02-07
import { useState, useCallback, useMemo } from "react"
import { CalendarHeader, ViewMode } from "./calendar-header"
import { CalendarWeekView } from "./calendar-week-view"
import { CalendarMonthView } from "./calendar-month-view"
import { CalendarDayView } from "./calendar-day-view"
import { MiniCalendar } from "./mini-calendar"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths } from "date-fns"

interface CalendarViewProps {
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  onSelectionChange?: (calendarIds: string[]) => void
}

export function CalendarView({ onTaskDrop, onSelectionChange }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())

  // マルチカレンダー対応
  const { selectedCalendarIds } = useCalendars()

  // 表示期間を計算（表示中の月の前後1ヶ月を含む）
  const { timeMin, timeMax } = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)

    return {
      timeMin: addMonths(monthStart, -1),
      timeMax: addMonths(monthEnd, 1)
    }
  }, [currentDate])

  // イベント取得（選択されたカレンダーのみ）
  const { events, isLoading, error, syncNow } = useCalendarEvents({
    timeMin,
    timeMax,
    calendarIds: selectedCalendarIds,
    autoSync: true,
    syncInterval: 300000 // 5分
  })

  // 今日に戻る
  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // 日付変更
  const handleDateChange = useCallback((date: Date) => {
    setCurrentDate(date)
  }, [])

  // イベント編集
  const handleEventEdit = useCallback((eventId: string) => {
    // TODO: イベント編集ダイアログを開く（Phase 1-1-3で実装）
    console.log('Edit event:', eventId)
  }, [])

  // イベント削除
  const handleEventDelete = useCallback((eventId: string) => {
    // TODO: イベント削除確認ダイアログ → 削除実行（Phase 1-1-3で実装）
    console.log('Delete event:', eventId)
  }, [])

  // イベントクリック（月ビュー用）
  const handleEventClick = useCallback((eventId: string) => {
    // TODO: イベント詳細ポップオーバーを表示（Phase 1-1-2で実装）
    console.log('Event clicked:', eventId)
  }, [])

  return (
    <div className="w-full h-full flex flex-col bg-[#121212] text-foreground">
      {/* Header */}
      <CalendarHeader
        viewMode={viewMode}
        currentDate={currentDate}
        onViewModeChange={setViewMode}
        onDateChange={handleDateChange}
        onToday={handleToday}
        onVisibleCalendarIdsChange={onSelectionChange}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Mini Calendar) - Optional: could be collapsible */}
        <div className="w-64 border-r bg-muted/5 flex flex-col hidden lg:flex">
          <div className="p-2">
            <MiniCalendar
              currentDate={currentDate}
              onDateChange={handleDateChange}
            />
          </div>
          {/* Additional sidebar items (e.g. My Calendars list) could go here if moved from header */}
        </div>

        {/* Main View Content */}
        <div className="flex-1 overflow-hidden relative">
          {viewMode === 'day' ? (
            <CalendarDayView
              currentDate={currentDate}
              onTaskDrop={onTaskDrop}
              events={events}
              onEventEdit={handleEventEdit}
              onEventDelete={handleEventDelete}
            />
          ) : viewMode === 'week' ? (
            <CalendarWeekView
              currentDate={currentDate}
              onTaskDrop={onTaskDrop}
              events={events}
              onEventEdit={handleEventEdit}
              onEventDelete={handleEventDelete}
            />
          ) : (
            <CalendarMonthView
              currentDate={currentDate}
              onTaskDrop={onTaskDrop}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>
    </div>
  )
}
