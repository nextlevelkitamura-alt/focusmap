"use client"

import { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from "react"
import { ViewMode } from "@/components/calendar/calendar-header"
import { SidebarCalendarHeader } from "@/components/dashboard/sidebar-calendar-header"
import { CalendarWeekView } from "@/components/calendar/calendar-week-view"
import { Calendar3DayView } from "@/components/calendar/calendar-3day-view"
import { CalendarMonthView } from "@/components/calendar/calendar-month-view"
import { CalendarDayView } from "@/components/calendar/calendar-day-view"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { startOfMonth, endOfMonth, addMonths } from "date-fns"
import { HOUR_HEIGHT } from "@/lib/calendar-constants"

export interface SidebarCalendarRef {
    refetch: () => Promise<void>
}

interface SidebarCalendarProps {
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onSelectionChange?: (calendarIds: string[]) => void
}

export const SidebarCalendar = forwardRef<SidebarCalendarRef, SidebarCalendarProps>(
    ({ onTaskDrop, onSelectionChange }, ref) => {
    // Default to 'day' view for sidebar as it's most useful for scheduling
    const [viewMode, setViewMode] = useState<ViewMode>('day')
    const [currentDate, setCurrentDate] = useState(new Date())
    const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT) // Zoom state
    const [isRefreshing, setIsRefreshing] = useState(false) // 更新ボタン用のローディング状態

    // CalendarSelector から選択状態を受け取るローカルステート
    const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([])

    // CalendarSelector の選択変更を受け取るハンドラー
    const handleVisibleCalendarIdsChange = useCallback((ids: string[]) => {
        console.log('[SidebarCalendar] Visible calendar IDs changed:', ids)
        setVisibleCalendarIds(ids)
        onSelectionChange?.(ids)
    }, [onSelectionChange])

    // Calculate display range
    const { timeMin, timeMax } = useMemo(() => {
        const monthStart = startOfMonth(currentDate)
        const monthEnd = endOfMonth(currentDate)

        return {
            timeMin: addMonths(monthStart, -1),
            timeMax: addMonths(monthEnd, 1)
        }
    }, [currentDate])

    // Fetch events — visibleCalendarIds が変わるとイベントを再取得
    const { events, refetch, isLoading } = useCalendarEvents({
        timeMin,
        timeMax,
        calendarIds: visibleCalendarIds.length > 0 ? visibleCalendarIds : undefined,
        autoSync: true,
        syncInterval: 300000
    })

    // 親コンポーネントから refetch を呼び出せるようにする
    useImperativeHandle(ref, () => ({
        refetch
    }), [refetch])

    // Handlers
    const handleToday = useCallback(() => {
        setCurrentDate(new Date())
    }, [])

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true)
        try {
            await refetch()
        } finally {
            setIsRefreshing(false)
        }
    }, [refetch])

    const handleDateChange = useCallback((date: Date) => {
        setCurrentDate(date)
    }, [])

    const handleEventEdit = useCallback((eventId: string) => {
        console.log('Edit event:', eventId)
        const event = events.find(e => e.id === eventId)
        if (event) {
            // TODO: 編集モーダルを表示
            // とりあえず簡易的なプロンプトで実装
            const newTitle = prompt('新しいタイトルを入力してください:', event.title)
            if (newTitle && newTitle !== event.title) {
                // APIを呼び出して更新
                fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: newTitle,
                        start_time: event.start_time,
                        end_time: event.end_time,
                        description: event.description,
                        location: event.location,
                        googleEventId: event.google_event_id,
                        calendarId: event.calendar_id
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        console.log('Event updated successfully')
                        refetch()
                    } else {
                        console.error('Failed to update event:', data.error)
                        alert('更新に失敗しました: ' + (data.error?.message || '不明なエラー'))
                    }
                })
                .catch(err => {
                    console.error('Failed to update event:', err)
                    alert('更新に失敗しました: ' + err.message)
                })
            }
        }
    }, [events, refetch])

    const handleEventTimeChange = useCallback(async (eventId: string, newStartTime: Date, newEndTime: Date) => {
        console.log('Event time change:', eventId, newStartTime, newEndTime)
        const event = events.find(e => e.id === eventId)
        if (!event) return

        try {
            const response = await fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: event.title,
                    start_time: newStartTime.toISOString(),
                    end_time: newEndTime.toISOString(),
                    description: event.description,
                    location: event.location,
                    googleEventId: event.google_event_id,
                    calendarId: event.calendar_id
                })
            })

            const data = await response.json()

            if (data.success) {
                console.log('Event time updated successfully')
                refetch()
            } else {
                console.error('Failed to update event time:', data.error)
                alert('時間の更新に失敗しました: ' + (data.error?.message || '不明なエラー'))
            }
        } catch (err) {
            console.error('Failed to update event time:', err)
            alert('時間の更新に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー'))
        }
    }, [events, refetch])

    const handleEventDelete = useCallback(async (eventId: string) => {
        console.log('Delete event:', eventId)
        const event = events.find(e => e.id === eventId)
        if (!event) return

        // 確認ダイアログ
        if (!confirm(`「${event.title}」を削除しますか？\n\nこの操作は取り消せません。`)) {
            return
        }

        try {
            const response = await fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`, {
                method: 'DELETE'
            })

            const data = await response.json()

            if (data.success) {
                console.log('Event deleted successfully')
                refetch()
            } else {
                console.error('Failed to delete event:', data.error)
                alert('削除に失敗しました: ' + (data.error?.message || '不明なエラー'))
            }
        } catch (err) {
            console.error('Failed to delete event:', err)
            alert('削除に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー'))
        }
    }, [events, refetch])

    const handleEventClick = useCallback((eventId: string) => {
        console.log('Event clicked:', eventId)
    }, [])

    // Zoom Handler (Pinch-in/out)
    // We need to use a native event listener with { passive: false } to prevent the default browser zoom
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault()
                // Prevent page zoom
                e.stopPropagation()

                const delta = e.deltaY * -0.5
                setHourHeight(current => {
                    const newHeight = Math.max(30, Math.min(200, current + delta))
                    return newHeight
                })
            }
        }

        container.addEventListener('wheel', handleWheel, { passive: false })

        return () => {
            container.removeEventListener('wheel', handleWheel)
        }
    }, [])

    return (
        <div className="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
            {/* Compact Header */}
            <SidebarCalendarHeader
                viewMode={viewMode}
                currentDate={currentDate}
                onViewModeChange={setViewMode}
                onDateChange={handleDateChange}
                onToday={handleToday}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
                onVisibleCalendarIdsChange={handleVisibleCalendarIdsChange}
            />

            {/* Main Content - No Screen-Size Based Sidebar here */}
            <div
                ref={containerRef}
                className="flex-1 overflow-hidden relative flex flex-col"
            >
                {viewMode === 'day' ? (
                    <CalendarDayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === '3day' ? (
                    <Calendar3DayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === 'week' ? (
                    <CalendarWeekView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventEdit}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
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
    )
})

SidebarCalendar.displayName = 'SidebarCalendar'
