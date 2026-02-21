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
import { useCalendarToast } from "@/components/calendar/calendar-toast"
import { CalendarToast } from "@/components/calendar/calendar-toast"
import { startOfMonth, endOfMonth, addMonths } from "date-fns"
import { HOUR_HEIGHT } from "@/lib/calendar-constants"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer } from "@/contexts/TimerContext"
import { useNotificationScheduler } from "@/hooks/useNotificationScheduler"

export interface SidebarCalendarRef {
    refetch: () => Promise<void>
}

interface SidebarCalendarProps {
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onSelectionChange?: (calendarIds: string[]) => void
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    tasks?: Task[]
}

export const SidebarCalendar = forwardRef<SidebarCalendarRef, SidebarCalendarProps>(
    ({ onTaskDrop, onSelectionChange, onUpdateTask, tasks = [] }, ref) => {
    // Default to 'day' view for sidebar as it's most useful for scheduling
    const [viewMode, setViewMode] = useState<ViewMode>('day')
    const [currentDate, setCurrentDate] = useState(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT) // Zoom state
    const [isRefreshing, setIsRefreshing] = useState(false) // 更新ボタン用のローディング状態

    // カレンダーリスト（編集モーダル用）
    const { calendars } = useCalendars()
    const { toast, hideToast, error: showError } = useCalendarToast()

    // CalendarSelector から選択状態を受け取るローカルステート
    const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([])

    // タイマー・タスクマップ
    const timer = useTimer()
    const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
    const { scheduleNotification, cancelNotifications } = useNotificationScheduler()

    const toggleTask = useCallback(async (taskId: string) => {
        const task = taskMap.get(taskId)
        if (!task || !onUpdateTask) return
        const newStatus = task.status === 'done' ? 'todo' : 'done'
        await onUpdateTask(taskId, { status: newStatus })
    }, [taskMap, onUpdateTask])

    // 編集モーダルの状態
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)

    // CalendarSelector の選択変更を受け取るハンドラー
    const handleVisibleCalendarIdsChange = useCallback((ids: string[]) => {
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

    // タスク更新のヘルパー（楽観的UI更新用）
    const updateLinkedTask = useCallback((taskId: string, updates: EventUpdatePayload) => {
        if (!onUpdateTask) return
        const priorityMap: Record<string, number> = { high: 3, medium: 2, low: 1 }
        onUpdateTask(taskId, {
            title: updates.title,
            scheduled_at: updates.start_time,
            estimated_time: updates.estimated_time,
            ...(updates.priority ? { priority: priorityMap[updates.priority] } : {}),
            ...(updates.calendar_id ? { calendar_id: updates.calendar_id } : {}),
        }).catch(err => console.error('[handleEventSave] Task update failed:', err))
    }, [onUpdateTask])

    const handleEventSave = useCallback(async (eventId: string, updates: EventUpdatePayload) => {
        const event = events.find(e => e.id === eventId)
        if (!event) return

        // 楽観的UI更新: 即座にカレンダー側を変更
        const updatedEvent: CalendarEvent = {
            ...event,
            title: updates.title,
            start_time: updates.start_time,
            end_time: updates.end_time,
            ...(updates.priority ? { priority: updates.priority } : {}),
            ...(updates.calendar_id ? { calendar_id: updates.calendar_id } : {}),
            ...(updates.estimated_time ? { estimated_time: updates.estimated_time } : {}),
        }
        setEvents(prev => prev.map(e => e.id === eventId ? updatedEvent : e))

        // タスク側も楽観的に更新（task_id がある場合のみ）
        const taskId = event.task_id
        if (taskId) {
            updateLinkedTask(taskId, updates)
        }

        // バックグラウンドで API 呼び出し
        try {
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

            // API がリンク先の task_id を返した場合、楽観的更新できなかった分を補完
            if (data.task_id && !taskId) {
                updateLinkedTask(data.task_id, updates)
                // 次回から楽観的更新できるよう、イベントに task_id を記録
                setEvents(prev => prev.map(e =>
                    e.id === eventId ? { ...e, task_id: data.task_id } : e
                ))
            }

            // リマインダーのスケジュール
            if (updates.reminders && updates.reminders.length > 0) {
                const targetId = event.task_id || eventId
                const targetType = event.task_id ? 'task' as const : 'event' as const
                await cancelNotifications(targetType, targetId)
                for (const minutes of updates.reminders) {
                    const scheduledAt = new Date(new Date(updates.start_time).getTime() - minutes * 60000)
                    await scheduleNotification({
                        targetType,
                        targetId,
                        notificationType: event.task_id ? 'task_start' : 'event_start',
                        scheduledAt,
                        title: `リマインダー: ${updates.title}`,
                        body: `${minutes}分後に開始します`,
                    })
                }
            }

            // 成功: 最新データに同期
            await refetch()
        } catch (err) {
            console.error('[handleEventSave] Failed:', err)
            // 失敗: ロールバック + エラー通知
            setEvents(prev => prev.map(e => e.id === eventId ? event : e))
            showError(`予定の更新に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`)
        }
    }, [events, setEvents, refetch, updateLinkedTask, showError, scheduleNotification, cancelNotifications])

    const handleEventTimeChange = useCallback(async (eventId: string, newStartTime: Date, newEndTime: Date) => {
        const event = events.find(e => e.id === eventId)
        if (!event) return

        const durationMinutes = Math.round((newEndTime.getTime() - newStartTime.getTime()) / (1000 * 60))

        // 楽観的更新: ローカルの events を即座に更新（refetch不要 → フリッカー防止）
        setEvents(prev => prev.map(e =>
            e.id === eventId
                ? { ...e, start_time: newStartTime.toISOString(), end_time: newEndTime.toISOString() }
                : e
        ))

        try {
            if (event.task_id && onUpdateTask) {
                // タスクに紐付いている場合は、タスクを更新（useTaskCalendarSyncが自動でGoogleカレンダーも同期）
                await onUpdateTask(event.task_id, {
                    scheduled_at: newStartTime.toISOString(),
                    estimated_time: durationMinutes
                })
            } else {
                // タスクに紐付いていない場合は、Google Calendar APIを直接更新
                const response = await fetch(`/api/calendar/events/${eventId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: event.title,
                        start_time: newStartTime.toISOString(),
                        end_time: newEndTime.toISOString(),
                        description: event.description,
                        location: event.location,
                        googleEventId: event.google_event_id,
                        calendarId: event.calendar_id,
                        estimated_time: durationMinutes,
                    })
                })

                const data = await response.json()

                if (data.success) {
                    // API がリンク先の task_id を返した場合、タスク一覧も更新
                    if (data.task_id && onUpdateTask) {
                        await onUpdateTask(data.task_id, {
                            scheduled_at: newStartTime.toISOString(),
                            estimated_time: durationMinutes,
                        })
                        // 次回から楽観的更新できるよう task_id を記録
                        setEvents(prev => prev.map(e =>
                            e.id === eventId ? { ...e, task_id: data.task_id } : e
                        ))
                    }
                } else {
                    // 失敗: 元の位置に戻す
                    setEvents(prev => prev.map(e =>
                        e.id === eventId
                            ? { ...e, start_time: event.start_time, end_time: event.end_time }
                            : e
                    ))
                    showError('時間の更新に失敗しました: ' + (data.error?.message || '不明なエラー'))
                }
            }
        } catch (err) {
            // 失敗: 元の位置に戻す
            setEvents(prev => prev.map(e =>
                e.id === eventId
                    ? { ...e, start_time: event.start_time, end_time: event.end_time }
                    : e
            ))
            showError('時間の更新に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー'))
        }
    }, [events, setEvents, onUpdateTask, showError])

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
                        hourHeight={hourHeight}
                        taskMap={taskMap}
                        onToggleTask={toggleTask}
                        timer={timer}
                    />
                ) : viewMode === '3day' ? (
                    <Calendar3DayView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventClick}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight}
                        taskMap={taskMap}
                        onToggleTask={toggleTask}
                        timer={timer}
                    />
                ) : viewMode === 'week' ? (
                    <CalendarWeekView
                        currentDate={currentDate}
                        onTaskDrop={onTaskDrop}
                        onEventTimeChange={handleEventTimeChange}
                        events={events}
                        onEventEdit={handleEventClick}
                        onEventDelete={handleEventDelete}
                        hourHeight={hourHeight}
                        taskMap={taskMap}
                        onToggleTask={toggleTask}
                        timer={timer}
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

            {/* エラー通知トースト */}
            {toast && (
                <CalendarToast
                    type={toast.type}
                    message={toast.message}
                    onClose={hideToast}
                />
            )}
        </div>
    )
})

SidebarCalendar.displayName = 'SidebarCalendar'
