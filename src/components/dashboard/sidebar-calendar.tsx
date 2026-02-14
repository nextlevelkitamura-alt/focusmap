"use client"

import { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from "react"
import { ViewMode } from "@/components/calendar/calendar-header"
import { SidebarCalendarHeader } from "@/components/dashboard/sidebar-calendar-header"
import { CalendarWeekView } from "@/components/calendar/calendar-week-view"
import { Calendar3DayView } from "@/components/calendar/calendar-3day-view"
import { CalendarMonthView } from "@/components/calendar/calendar-month-view"
import { CalendarDayView } from "@/components/calendar/calendar-day-view"
import { CalendarEventEditModal, EventUpdatePayload } from "@/components/calendar/calendar-event-edit-modal"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { startOfMonth, endOfMonth, addMonths } from "date-fns"
import { HOUR_HEIGHT } from "@/lib/calendar-constants"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"

export interface SidebarCalendarRef {
    refetch: () => Promise<void>
}

interface SidebarCalendarProps {
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onSelectionChange?: (calendarIds: string[]) => void
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

export const SidebarCalendar = forwardRef<SidebarCalendarRef, SidebarCalendarProps>(
    ({ onTaskDrop, onSelectionChange, onUpdateTask }, ref) => {
    // Default to 'day' view for sidebar as it's most useful for scheduling
    const [viewMode, setViewMode] = useState<ViewMode>('day')
    const [currentDate, setCurrentDate] = useState(new Date())
    const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT) // Zoom state
    const [isRefreshing, setIsRefreshing] = useState(false) // 更新ボタン用のローディング状態

    // カレンダーリスト（編集モーダル用）
    const { calendars } = useCalendars()

    // CalendarSelector から選択状態を受け取るローカルステート
    const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([])

    // 編集モーダルの状態
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)

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
    const { events, setEvents, refetch, isLoading } = useCalendarEvents({
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

    // イベントカードクリック → 直接編集モーダルを開く
    const handleEventClick = useCallback((eventId: string) => {
        const event = events.find(e => e.id === eventId)
        if (!event) return

        setEditingEvent(event)
        setIsEditModalOpen(true)
    }, [events])

    const handleEventSave = useCallback(async (eventId: string, updates: EventUpdatePayload) => {
        const event = events.find(e => e.id === eventId)
        if (!event) {
            throw new Error('Event not found')
        }

        // Google Calendar API + DB + タスクを一括更新（サーバー側で完結）
        const response = await fetch(`/api/calendar/events/${eventId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: updates.title,
                start_time: updates.start_time,
                end_time: updates.end_time,
                description: event.description,
                location: event.location,
                googleEventId: event.google_event_id,
                calendarId: updates.calendar_id || event.calendar_id,
                estimated_time: updates.estimated_time,
                priority: updates.priority,
            })
        })

        const data = await response.json()

        if (!data.success) {
            throw new Error(data.error?.message || '更新に失敗しました')
        }

        // サーバーがタスクIDを返した場合 → クライアント側の楽観的更新でUI即時反映
        const taskId = data.task_id || event.task_id
        if (taskId && onUpdateTask) {
            console.log('[handleEventSave] Optimistic update for task:', taskId)
            const priorityMap: Record<string, number> = { high: 3, medium: 2, low: 1 }
            await onUpdateTask(taskId, {
                title: updates.title,
                scheduled_at: updates.start_time,
                estimated_time: updates.estimated_time,
                ...(updates.priority ? { priority: priorityMap[updates.priority] } : {}),
                ...(updates.calendar_id ? { calendar_id: updates.calendar_id } : {}),
            })
        }

        await refetch()
    }, [events, refetch, onUpdateTask])

    const handleEventTimeChange = useCallback(async (eventId: string, newStartTime: Date, newEndTime: Date) => {
        console.log('Event time change:', eventId, newStartTime, newEndTime)
        const event = events.find(e => e.id === eventId)
        if (!event) return

        try {
            // タスクに紐付いている場合は、タスクを更新（useTaskCalendarSyncが自動でGoogleカレンダーも同期）
            if (event.task_id && onUpdateTask) {
                console.log('Updating task:', event.task_id)

                // 所要時間を計算
                const durationMinutes = Math.round((newEndTime.getTime() - newStartTime.getTime()) / (1000 * 60))

                await onUpdateTask(event.task_id, {
                    scheduled_at: newStartTime.toISOString(),
                    estimated_time: durationMinutes
                })

                console.log('Task updated successfully, refreshing calendar')
                // カレンダーを再取得して変更を反映
                await refetch()
            } else {
                // タスクに紐付いていない場合は、Google Calendar APIを直接更新
                console.log('Updating calendar event directly (not linked to task)')
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
            }
        } catch (err) {
            console.error('Failed to update event time:', err)
            alert('時間の更新に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー'))
        }
    }, [events, refetch, onUpdateTask])

    // イベント削除のコア処理（確認ダイアログなし・楽観的UI）
    // 即座にUIから削除し、バックグラウンドでAPI削除。失敗時は復元+エラー通知
    const deleteCalendarEvent = useCallback(async (eventId: string) => {
        const event = events.find(e => e.id === eventId)
        if (!event) throw new Error('Event not found')

        // 楽観的削除: 即座にUIから削除
        setEvents(prev => prev.filter(e => e.id !== eventId))

        try {
            const response = await fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`, {
                method: 'DELETE'
            })
            const data = await response.json()
            if (!data.success) {
                throw new Error(data.error?.message || '削除に失敗しました')
            }
        } catch (err) {
            // 失敗時: イベントを復元
            setEvents(prev => [...prev, event].sort((a, b) =>
                new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
            ))
            throw err // 呼び出し元でエラー表示
        }
    }, [events, setEvents])

    // イベントカードからの削除（確認ダイアログ付き・楽観的UI）
    const handleEventDelete = useCallback(async (eventId: string) => {
        const event = events.find(e => e.id === eventId)
        if (!event) return
        if (!confirm(`「${event.title}」を削除しますか？\n\nこの操作は取り消せません。`)) return

        try {
            await deleteCalendarEvent(eventId)
        } catch (err) {
            console.error('Failed to delete event:', err)
            alert('削除に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー'))
        }
    }, [events, deleteCalendarEvent])

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
                        onEventEdit={handleEventClick}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === '3day' ? (
                    <Calendar3DayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventClick}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : viewMode === 'week' ? (
                    <CalendarWeekView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventClick}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight} // Pass dynamic height
                    />
                ) : (
                    <CalendarMonthView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        events={events}
                        onEventClick={handleEventClick as (eventId: string) => void}
                    />
                )}
            </div>

            {/* 編集モーダル */}
            <CalendarEventEditModal
                event={editingEvent}
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false)
                    setEditingEvent(null)
                }}
                onSave={handleEventSave}
                onDelete={deleteCalendarEvent}
                availableCalendars={calendars
                    .filter(c => c.access_level === 'owner' || c.access_level === 'writer')
                    .map(c => ({ id: c.google_calendar_id, name: c.name, background_color: c.background_color || undefined }))
                }
            />
        </div>
    )
})

SidebarCalendar.displayName = 'SidebarCalendar'
