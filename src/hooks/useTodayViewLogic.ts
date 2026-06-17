"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Task, HabitCompletion, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents, invalidateCalendarCache, broadcastCalendarSync, broadcastEventCompletion, broadcastCalendarEventTimeUpdate, broadcastCalendarEventDetailUpdate, broadcastCalendarOptimisticEventRemoval, EVENT_COMPLETION_EVENT, CALENDAR_EVENT_TIME_UPDATE_EVENT, CALENDAR_EVENT_DETAIL_UPDATE_EVENT, type CalendarEventDetailUpdate } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { useHabits, HabitWithDetails, formatDateString } from "@/hooks/useHabits"
import { useEventImport } from "@/hooks/useEventImport"
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync"
import { useTimer } from "@/contexts/TimerContext"
import { useNotificationScheduler } from "@/hooks/useNotificationScheduler"
import { useUndoRedo } from "@/hooks/useUndoRedo"
import { DragItem } from "@/hooks/useTouchDrag"
import { taskToTimeBlock, eventToTimeBlock, type TimeBlock } from "@/lib/time-block"
import { type QuickTaskData } from "@/components/today/quick-task-fab"
import { type EditTarget } from "@/components/today/mobile-event-edit-modal"
import { isSameDay, format } from "date-fns"
import { ja } from "date-fns/locale"
import { useTodayDateContext } from "@/contexts/TodayDateContext"
import { dedupeGoogleEventTasks } from "@/lib/google-event-task-dedupe"
import { WISHLIST_REFRESH_EVENT } from "@/lib/calendar-constants"
import { invalidateWishlistItemsCache } from "@/lib/wishlist-cache"
import {
    CALENDAR_EVENT_TO_MEMO_CONVERTED_EVENT,
    buildCalendarEventMemoPayload,
    broadcastCalendarEventToMemoConverted,
    type CalendarEventMemoPayload,
    confirmCalendarEventMemoDeleteScope,
    convertCalendarEventToMemo,
} from "@/lib/calendar-event-to-memo"

// --- Types ---

export interface UseTodayViewLogicOptions {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    selectedProjectId?: string | null
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
}

// --- Helper ---

const REMINDER_PREFETCH_DELAY_MS = 250
const REMINDER_PREFETCH_MAX_EVENTS = 12
const DEFAULT_CALENDAR_EVENT_COLOR = '#039BE5'

export function getWeekDots(completions: HabitCompletion[], today: Date): boolean[] {
    const completedDates = new Set(completions.map(c => c.completed_date))
    const dots: boolean[] = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        dots.push(completedDates.has(dateStr))
    }
    return dots
}

// --- Hook ---

export function useTodayViewLogic({
    allTasks,
    onUpdateTask,
    projects = [],
    selectedProjectId = null,
    onCreateSubTask: onCreateSubTaskProp,
    onDeleteTask: onDeleteTaskProp,
}: UseTodayViewLogicOptions) {
    const { selectedCalendarIds, calendars, isLoading: calendarsLoading } = useCalendars()
    const selectedCalendarIdSet = useMemo(() => new Set(selectedCalendarIds), [selectedCalendarIds])
    const { todayHabits, toggleCompletion, toggleChildTaskCompletion, updateChildTaskStatus, getHabitsForDate, isCompletedForDate, isLoading: habitsLoading } = useHabits()
    const { importEvents, isImporting } = useEventImport()
    const timer = useTimer()
    const { scheduleNotification, cancelNotifications } = useNotificationScheduler()
    const { pushAction } = useUndoRedo()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [timelineMode, setTimelineMode] = useState<'calendar' | 'cards'>('calendar')
    const [habitsExpanded, setHabitsExpanded] = useState(false)
    const [expandedHabitId, setExpandedHabitId] = useState<string | null>(null)
    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle')
    const syncDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [pendingDeleteTaskIds, setPendingDeleteTaskIds] = useState<string[]>([])
    const pendingDeleteRef = useRef<string[]>([])
    pendingDeleteRef.current = pendingDeleteTaskIds
    const [pendingExpandTaskId, setPendingExpandTaskId] = useState<string | null>(null)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const scrollPositionRef = useRef<number | undefined>(undefined)
    const stableCalendarColorMapRef = useRef<Map<string, string>>(new Map())
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)
    const [prefetchedEventReminders, setPrefetchedEventReminders] = useState<Record<string, number[]>>({})
    const prefetchedEventRemindersRef = useRef(prefetchedEventReminders)
    const reminderPrefetchInFlightRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        prefetchedEventRemindersRef.current = prefetchedEventReminders
    }, [prefetchedEventReminders])

    // Sync local tasks with prop changes (allTasks のみに依存)
    useEffect(() => {
        setLocalTasks(allTasks.filter(task => !pendingDeleteRef.current.includes(task.id)))
        setPendingDeleteTaskIds(prev => {
            const next = prev.filter(id => allTasks.some(task => task.id === id))
            if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
                return prev
            }
            return next
        })
    }, [allTasks])

    const visibleTasks = useMemo(
        () => dedupeGoogleEventTasks(localTasks).filter(task => {
            if (calendarsLoading) return true
            if (!task.calendar_id) return true
            return selectedCalendarIdSet.has(task.calendar_id)
        }),
        [calendarsLoading, localTasks, selectedCalendarIdSet]
    )

    // Shared date context (desktop: sync both panels; mobile: null → use local state)
    const dateCtx = useTodayDateContext()
    const [localSelectedDate, localSetSelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const selectedDate = dateCtx ? dateCtx.selectedDate : localSelectedDate
    const setSelectedDate = dateCtx ? dateCtx.setSelectedDate : localSetSelectedDate

    // 1ヶ月間フェッチウィンドウ（-7日〜+30日）
    const [fetchWindow, setFetchWindow] = useState(() => {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        const min = new Date(now)
        min.setDate(min.getDate() - 7)
        const max = new Date(now)
        max.setDate(max.getDate() + 30)
        return { min, max }
    })

    // selectedDateがウィンドウ外に出たらウィンドウを再計算
    useEffect(() => {
        if (selectedDate < fetchWindow.min || selectedDate >= fetchWindow.max) {
            const min = new Date(selectedDate)
            min.setDate(min.getDate() - 7)
            const max = new Date(selectedDate)
            max.setDate(max.getDate() + 30)
            setFetchWindow({ min, max })
        }
    }, [selectedDate, fetchWindow.min, fetchWindow.max])

    const today = selectedDate

    const isToday = useMemo(() => {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        return today.getTime() === now.getTime()
    }, [today])

    const tomorrow = useMemo(() => {
        const d = new Date(today)
        d.setDate(d.getDate() + 1)
        return d
    }, [today])

    const previousDay = useMemo(() => {
        const d = new Date(today)
        d.setDate(d.getDate() - 1)
        return d
    }, [today])

    // Date navigation
    const goToPrevDay = useCallback(() => {
        setSlideDirection('right')
        setSelectedDate(prev => {
            const d = new Date(prev)
            d.setDate(d.getDate() - 1)
            return d
        })
    }, [])

    const goToNextDay = useCallback(() => {
        setSlideDirection('left')
        setSelectedDate(prev => {
            const d = new Date(prev)
            d.setDate(d.getDate() + 1)
            return d
        })
    }, [])

    const goToToday = useCallback(() => {
        setSlideDirection('right')
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        setSelectedDate(d)
        setCalendarMonth(new Date())
        setCalendarOpen(false)
    }, [])

    // Calendar panel date selection
    const handleDateSelect = useCallback((date: Date | undefined) => {
        if (!date) return
        const normalized = new Date(date)
        normalized.setHours(0, 0, 0, 0)
        setSlideDirection(normalized > selectedDate ? 'left' : 'right')
        setSelectedDate(normalized)
        setCalendarOpen(false)
    }, [selectedDate])

    // Fetch calendar events (1ヶ月分を一括取得)
    const { events: allFetchedEvents, isLoading: eventsLoading, error: eventsError, syncNow, addOptimisticEvent, removeOptimisticEvent } = useCalendarEvents({
        timeMin: fetchWindow.min,
        timeMax: fetchWindow.max,
        enabled: !calendarsLoading,
        calendarIds: selectedCalendarIds,
    })

    const completeSyncFeedback = useCallback(() => {
        if (syncDoneTimerRef.current) clearTimeout(syncDoneTimerRef.current)
        setSyncState('done')
        syncDoneTimerRef.current = setTimeout(() => {
            setSyncState('idle')
            syncDoneTimerRef.current = null
        }, 1500)
    }, [])

    const startSyncFeedback = useCallback(() => {
        if (syncDoneTimerRef.current) {
            clearTimeout(syncDoneTimerRef.current)
            syncDoneTimerRef.current = null
        }
        setSyncState('syncing')
    }, [])

    useEffect(() => {
        return () => {
            if (syncDoneTimerRef.current) clearTimeout(syncDoneTimerRef.current)
        }
    }, [])

    const refreshCalendar = useCallback(async () => {
        startSyncFeedback()
        try {
            await syncNow({ silent: true })
            completeSyncFeedback()
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to refresh calendar:', err)
            setSyncState('idle')
            throw err
        }
    }, [completeSyncFeedback, startSyncFeedback, syncNow])

    // selectedDate のイベントだけ抽出
    const fetchedCalendarEvents = useMemo(() => {
        return allFetchedEvents.filter(e => {
            const start = new Date(e.start_time)
            const end = new Date(e.end_time)
            return end.getTime() > today.getTime() && start.getTime() < tomorrow.getTime()
        })
    }, [allFetchedEvents, today, tomorrow])

    const fetchedCalendarEventsWithPrefetchedReminders = useMemo(() => {
        return fetchedCalendarEvents.map(event => {
            const key = `${event.calendar_id}::${event.google_event_id}`
            const prefetched = prefetchedEventReminders[key]
            if (!prefetched) return event
            return { ...event, reminders: prefetched }
        })
    }, [fetchedCalendarEvents, prefetchedEventReminders])

    const [localCalendarEvents, setLocalCalendarEvents] = useState<CalendarEvent[]>(fetchedCalendarEventsWithPrefetchedReminders)
    useEffect(() => { setLocalCalendarEvents(fetchedCalendarEventsWithPrefetchedReminders) }, [fetchedCalendarEventsWithPrefetchedReminders])

    // 他パネルからのイベント完了状態の即時反映
    useEffect(() => {
        if (typeof window === 'undefined') return
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ eventId?: string; googleEventId?: string; calendarId?: string; isCompleted: boolean }>).detail
            const { eventId, googleEventId, calendarId, isCompleted } = detail
            const ids = new Set([eventId, googleEventId].filter((id): id is string => !!id))
            if (typeof isCompleted !== 'boolean') return
            if (ids.size === 0) return
            setLocalCalendarEvents(prev => prev.map(ev =>
                ids.has(ev.id) || (ids.has(ev.google_event_id) && (!calendarId || ev.calendar_id === calendarId))
                    ? { ...ev, is_completed: isCompleted }
                    : ev
            ))
        }
        window.addEventListener(EVENT_COMPLETION_EVENT, handler)
        return () => window.removeEventListener(EVENT_COMPLETION_EVENT, handler)
    }, [])

    // 他パネルからのイベント時刻変更の即時反映（ドラッグ楽観UI）
    useEffect(() => {
        if (typeof window === 'undefined') return
        const handler = (e: Event) => {
            const { eventId, startTime, endTime } = (e as CustomEvent<{ eventId: string; startTime: string; endTime: string }>).detail
            setLocalCalendarEvents(prev => prev.map(ev =>
                ev.id === eventId ? { ...ev, start_time: startTime, end_time: endTime } : ev
            ))
        }
        window.addEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
        return () => window.removeEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
    }, [])

    // 他パネルからのイベント詳細変更の即時反映（タイトル編集などの楽観UI）
    useEffect(() => {
        if (typeof window === 'undefined') return
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<CalendarEventDetailUpdate>).detail
            if (!detail?.eventId) return
            const durationMinutes = detail.startTime && detail.endTime
                ? Math.max(1, Math.round((new Date(detail.endTime).getTime() - new Date(detail.startTime).getTime()) / 60000))
                : null
            setLocalCalendarEvents(prev => prev.map(event => {
                const matches =
                    event.id === detail.eventId ||
                    (!!detail.googleEventId &&
                        event.google_event_id === detail.googleEventId &&
                        (
                            !detail.calendarId ||
                            event.calendar_id === detail.calendarId ||
                            event.calendar_id === detail.previousCalendarId
                        ))
                if (!matches) return event
                return {
                    ...event,
                    ...(detail.title !== undefined ? { title: detail.title } : {}),
                    ...(detail.startTime !== undefined ? { start_time: detail.startTime } : {}),
                    ...(detail.endTime !== undefined ? { end_time: detail.endTime } : {}),
                    ...(detail.calendarId !== undefined ? { calendar_id: detail.calendarId } : {}),
                    ...(detail.reminders !== undefined ? { reminders: detail.reminders } : {}),
                    ...(detail.description !== undefined ? { description: detail.description } : {}),
                }
            }))
            setLocalTasks(prev => prev.map(task => {
                const matches =
                    (!!detail.taskId && task.id === detail.taskId) ||
                    (!!detail.googleEventId && task.google_event_id === detail.googleEventId)
                if (!matches) return task
                return {
                    ...task,
                    ...(detail.title !== undefined ? { title: detail.title } : {}),
                    ...(detail.startTime !== undefined ? { scheduled_at: detail.startTime } : {}),
                    ...(durationMinutes !== null ? { estimated_time: durationMinutes } : {}),
                    ...(detail.calendarId ? { calendar_id: detail.calendarId } : {}),
                }
            }))
        }
        window.addEventListener(CALENDAR_EVENT_DETAIL_UPDATE_EVENT, handler)
        return () => window.removeEventListener(CALENDAR_EVENT_DETAIL_UPDATE_EVENT, handler)
    }, [])

    const eventByGoogleKey = useMemo(() => {
        const map = new Map<string, CalendarEvent>()
        for (const event of allFetchedEvents) {
            map.set(`${event.calendar_id}::${event.google_event_id}`, event)
        }
        return map
    }, [allFetchedEvents])

    // イベント自動取り込み
    const prevEventIdsRef = useRef<string>('')
    useEffect(() => {
        if (eventsLoading || allFetchedEvents.length === 0 || isImporting) return
        const currentIds = allFetchedEvents.map(e => `${e.calendar_id}::${e.google_event_id}`).sort().join(',')
        if (currentIds === prevEventIdsRef.current) return
        prevEventIdsRef.current = currentIds
        importEvents(allFetchedEvents).catch(() => { })
    }, [eventsLoading, allFetchedEvents, importEvents, isImporting])

    // カレンダー同期
    useMultiTaskCalendarSync({
        tasks: localTasks,
        onRefreshCalendar: () => syncNow({ silent: true }),
        onUpdateTask,
        onAddOptimisticEvent: addOptimisticEvent,
        onRemoveOptimisticEvent: removeOptimisticEvent,
    })

    const calendarEvents = localCalendarEvents
    const reminderKeyForEvent = useCallback((event: { calendar_id: string; google_event_id: string }) =>
        `${event.calendar_id}::${event.google_event_id}`,
        []
    )
    const calendarReauthUrl = (eventsError as (Error & { reauthUrl?: string }) | null)?.reauthUrl || '/api/calendar/connect'

    const patchCalendarEvent = useCallback(async (event: CalendarEvent, updates: {
        title: string
        start_time: string
        end_time: string
        googleEventId: string
        calendarId: string
        originalCalendarId?: string
        estimated_time?: number
        reminders?: number[]
        description?: string
    }) => {
        const durationMinutes = Math.max(
            1,
            Math.round((new Date(updates.end_time).getTime() - new Date(updates.start_time).getTime()) / 60000)
        )

        setLocalCalendarEvents(prev => prev.map(e =>
            e.id === event.id
                ? {
                    ...e,
                    title: updates.title,
                    start_time: updates.start_time,
                    end_time: updates.end_time,
                    calendar_id: updates.calendarId || e.calendar_id,
                    reminders: updates.reminders,
                    ...(updates.description !== undefined ? { description: updates.description } : {}),
                }
                : e
        ))
        setLocalTasks(prev => prev.map(task =>
            task.google_event_id === updates.googleEventId
                ? {
                    ...task,
                    title: updates.title,
                    scheduled_at: updates.start_time,
                    estimated_time: durationMinutes,
                    calendar_id: updates.calendarId || task.calendar_id,
                }
                : task
        ))
        broadcastCalendarEventDetailUpdate({
            eventId: event.id,
            googleEventId: updates.googleEventId,
            calendarId: updates.calendarId,
            previousCalendarId: updates.originalCalendarId || event.calendar_id,
            taskId: event.task_id,
            title: updates.title,
            startTime: updates.start_time,
            endTime: updates.end_time,
            reminders: updates.reminders,
            ...(updates.description !== undefined ? { description: updates.description } : {}),
        })

        const res = await fetch(`/api/calendar/events/${event.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: updates.title,
                start_time: updates.start_time,
                end_time: updates.end_time,
                googleEventId: updates.googleEventId,
                calendarId: updates.calendarId,
                originalCalendarId: updates.originalCalendarId || event.calendar_id,
                estimated_time: updates.estimated_time ?? durationMinutes,
                reminders: updates.reminders,
                ...(updates.description !== undefined ? { description: updates.description } : {}),
            }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.success === false) {
            throw new Error(data.error?.message || 'Failed to update event')
        }
        const effectiveGoogleEventId = typeof data.google_event_id === 'string'
            ? data.google_event_id
            : updates.googleEventId
        const effectiveCalendarId = typeof data.calendar_id === 'string'
            ? data.calendar_id
            : updates.calendarId
        if (effectiveGoogleEventId !== updates.googleEventId || effectiveCalendarId !== updates.calendarId) {
            setLocalCalendarEvents(prev => prev.map(e =>
                e.id === event.id ||
                    (
                        e.google_event_id === updates.googleEventId &&
                        (e.calendar_id === updates.originalCalendarId || e.calendar_id === updates.calendarId)
                    )
                    ? { ...e, google_event_id: effectiveGoogleEventId, calendar_id: effectiveCalendarId }
                    : e
            ))
            setLocalTasks(prev => prev.map(task =>
                task.google_event_id === updates.googleEventId
                    ? { ...task, google_event_id: effectiveGoogleEventId, calendar_id: effectiveCalendarId }
                    : task
            ))
            broadcastCalendarEventDetailUpdate({
                eventId: event.id,
                googleEventId: effectiveGoogleEventId,
                calendarId: effectiveCalendarId,
                previousCalendarId: updates.originalCalendarId || event.calendar_id,
                taskId: event.task_id,
                title: updates.title,
                startTime: updates.start_time,
                endTime: updates.end_time,
                reminders: updates.reminders,
                ...(updates.description !== undefined ? { description: updates.description } : {}),
            })
        }
        invalidateCalendarCache()
        broadcastCalendarSync()
    }, [])

    const setCalendarEventCompletion = useCallback(async (event: CalendarEvent, isCompleted: boolean) => {
        setLocalCalendarEvents(prev => prev.map(e =>
            e.id === event.id ? { ...e, is_completed: isCompleted } : e
        ))
        broadcastEventCompletion(event.id, isCompleted, event.google_event_id, event.calendar_id)

        if (event.google_event_id) {
            const response = await fetch('/api/calendar/events/complete', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    google_event_id: event.google_event_id,
                    calendar_id: event.calendar_id,
                    completed_date: formatDateString(new Date(event.start_time)),
                    start_time: event.start_time,
                    is_completed: isCompleted,
                }),
            })
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}))
                throw new Error(errData.error || `HTTP ${response.status}`)
            }
        } else {
            const supabase = (await import('@/utils/supabase/client')).createClient()
            const { error } = await supabase
                .from('calendar_events')
                .update({ is_completed: isCompleted })
                .eq('id', event.id)
            if (error) throw error
        }
        invalidateCalendarCache()
    }, [])

    // Habit task IDs
    const habitGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of visibleTasks) {
            if (t.is_habit) ids.add(t.id)
        }
        return ids
    }, [visibleTasks])

    // Today's scheduled tasks
    const todayScheduledTasks = useMemo(() => {
        const filtered = visibleTasks.filter(t => {
            if (t.deleted_at) return false
            if (t.is_group) return false
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            return scheduled >= today && scheduled < tomorrow
        })
        const seenGoogleEventKeys = new Set<string>()
        return filtered.filter(t => {
            if (!t.google_event_id || !t.calendar_id) return true
            const key = `${t.calendar_id}::${t.google_event_id}`
            if (seenGoogleEventKeys.has(key)) return false
            seenGoogleEventKeys.add(key)
            return true
        })
    }, [visibleTasks, habitGroupIds, today, tomorrow])

    // Overflow tasks
    const overflowTasks = useMemo(() => {
        const filtered = visibleTasks.filter(t => {
            if (t.deleted_at) return false
            if (t.is_group) return false
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            if (!(scheduled >= previousDay && scheduled < today)) return false
            const estimatedMin = t.estimated_time || 30
            const endTime = new Date(scheduled.getTime() + estimatedMin * 60 * 1000)
            return endTime > today
        })
        const seenGoogleEventKeys = new Set<string>()
        return filtered.filter(t => {
            if (!t.google_event_id || !t.calendar_id) return true
            const key = `${t.calendar_id}::${t.google_event_id}`
            if (seenGoogleEventKeys.has(key)) return false
            seenGoogleEventKeys.add(key)
            return true
        })
    }, [visibleTasks, habitGroupIds, previousDay, today])

    // Unscheduled tasks
    const unscheduledTasks = useMemo(() =>
        visibleTasks.filter(t =>
            !t.deleted_at &&
            !t.scheduled_at &&
            !t.project_id &&
            !t.parent_task_id &&
            !t.is_habit &&
            t.status !== 'done'
        ),
        [visibleTasks]
    )

    // 親タスク ID → 子タスク配列 のマップ（やることカラムでサブタスクを
    // 親の下にインデント展開するために使用）
    const childTasksByParentId = useMemo(() => {
        const map = new Map<string, Task[]>()
        for (const t of visibleTasks) {
            if (t.deleted_at) continue
            if (t.is_group) continue
            if (!t.parent_task_id) continue
            const arr = map.get(t.parent_task_id) ?? []
            arr.push(t)
            map.set(t.parent_task_id, arr)
        }
        for (const [k, arr] of map.entries()) {
            arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
            map.set(k, arr)
        }
        return map
    }, [visibleTasks])

    // Project name map
    const projectNameMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const p of projects) {
            map.set(p.id, p.title)
        }
        return map
    }, [projects])

    // Calendar color map
    const calendarColorMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const cal of calendars) {
            if (cal.background_color) {
                map.set(cal.google_calendar_id, cal.background_color)
            }
        }
        return map
    }, [calendars])

    // Stable calendar color map (prevent color flicker)
    const stableCalendarColorMap = useMemo(() => {
        const merged = new Map(stableCalendarColorMapRef.current)
        for (const [calendarId, color] of calendarColorMap) {
            merged.set(calendarId, color)
        }
        return merged
    }, [calendarColorMap])
    useEffect(() => {
        stableCalendarColorMapRef.current = stableCalendarColorMap
    }, [stableCalendarColorMap])

    // Child tasks grouped by parent
    const childTasksMap = useMemo(() => {
        const map = new Map<string, Task[]>()
        for (const task of visibleTasks) {
            if (task.parent_task_id && !task.is_habit) {
                const children = map.get(task.parent_task_id) || []
                children.push(task)
                map.set(task.parent_task_id, children)
            }
        }
        return map
    }, [visibleTasks])

    // Merge calendar events + scheduled tasks into timeline
    const allTasksWithGoogleEvent = useMemo(() =>
        [...todayScheduledTasks, ...overflowTasks].filter(t => t.google_event_id && t.calendar_id),
        [todayScheduledTasks, overflowTasks]
    )
    const scheduledTaskIds = useMemo(
        () => new Set([...todayScheduledTasks, ...overflowTasks].map(t => t.id)),
        [todayScheduledTasks, overflowTasks]
    )
    const taskGoogleEventKeys = useMemo(
        () => new Set(allTasksWithGoogleEvent.map(t => `${t.calendar_id}::${t.google_event_id}`)),
        [allTasksWithGoogleEvent]
    )
    const scheduledTaskEventKeys = useMemo(
        () => new Set(
            [...todayScheduledTasks, ...overflowTasks]
                .filter(t => t.scheduled_at && t.calendar_id)
                .map(t => {
                    const minute = Math.floor(new Date(t.scheduled_at!).getTime() / 60000)
                    const title = t.title.trim().toLowerCase()
                    return `${t.calendar_id || ''}|${title}|${minute}`
                })
        ),
        [todayScheduledTasks, overflowTasks]
    )
    const eventLikeTaskKeys = useMemo(
        () => new Set(
            [...todayScheduledTasks, ...overflowTasks]
                .filter(t => t.source === 'google_event' && !!t.scheduled_at)
                .map(t => {
                    const minute = Math.floor(new Date(t.scheduled_at!).getTime() / 60000)
                    const title = t.title.trim().toLowerCase()
                    return `${t.calendar_id || ''}|${title}|${minute}`
                })
        ),
        [todayScheduledTasks, overflowTasks]
    )

    const timelineItems: TimeBlock[] = useMemo(() => {
        const items: TimeBlock[] = []

        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            if (event.task_id && scheduledTaskIds.has(event.task_id)) continue
            if (taskGoogleEventKeys.has(`${event.calendar_id}::${event.google_event_id}`)) continue
            const eventMinute = Math.floor(new Date(event.start_time).getTime() / 60000)
            const eventKey = `${event.calendar_id || ''}|${event.title.trim().toLowerCase()}|${eventMinute}`
            if (scheduledTaskEventKeys.has(eventKey)) continue
            if (eventLikeTaskKeys.has(eventKey)) continue

            const calendarColor =
                stableCalendarColorMap.get(event.calendar_id || '') ||
                event.background_color ||
                (event.sync_status === 'pending' ? '#F59E0B' : DEFAULT_CALENDAR_EVENT_COLOR)
            const block = eventToTimeBlock({ ...event, background_color: calendarColor })
            if (block.startTime.getTime() < today.getTime()) block.startTime = new Date(today)
            if (block.endTime.getTime() > tomorrow.getTime()) block.endTime = new Date(tomorrow)

            items.push(block)
        }

        for (const task of todayScheduledTasks) {
            if (!task.scheduled_at) continue
            let color: string | undefined
            if (task.google_event_id && task.calendar_id) {
                color = stableCalendarColorMap.get(task.calendar_id || '')
            }
            const block = taskToTimeBlock(task, undefined, color)
            if (block.endTime > tomorrow) block.endTime = new Date(tomorrow)
            items.push(block)
        }

        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
        for (const task of overflowTasks) {
            let color: string | undefined
            if (task.google_event_id && task.calendar_id) {
                color = stableCalendarColorMap.get(task.calendar_id || '')
            }
            const block = taskToTimeBlock(task, undefined, color)
            block.startTime = new Date(today)
            if (block.endTime.getTime() > dayAfterTomorrow.getTime()) {
                block.endTime = new Date(dayAfterTomorrow)
            }
            items.push(block)
        }

        items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
        return items
    }, [calendarEvents, eventLikeTaskKeys, scheduledTaskIds, scheduledTaskEventKeys, stableCalendarColorMap, taskGoogleEventKeys, todayScheduledTasks, overflowTasks, today, tomorrow])

    // All-day events
    const allDayEvents = useMemo(() => {
        return calendarEvents
            .filter(e => e.is_all_day)
            .map(e => ({
                ...e,
                background_color:
                    stableCalendarColorMap.get(e.calendar_id || '') ||
                    e.background_color ||
                    DEFAULT_CALENDAR_EVENT_COLOR,
            })) as CalendarEvent[]
    }, [calendarEvents, stableCalendarColorMap])

    const displayItems = timelineItems
    const displayAllDayEvents = allDayEvents

    // Toggle task completion
    const toggleTask = useCallback(async (taskId: string) => {
        const task = localTasks.find(t => t.id === taskId)
        if (!task) return
        const previousStatus = task.status
        const newStatus = task.status === 'done' ? 'todo' : 'done'
        const isSameCompletionTarget = (candidate: Task) =>
            candidate.id === taskId ||
            (
                !!task.google_event_id &&
                candidate.google_event_id === task.google_event_id &&
                (!task.calendar_id || candidate.calendar_id === task.calendar_id)
            )
        const applyStatus = (status: string) => {
            setLocalTasks(prev => prev.map(t =>
                isSameCompletionTarget(t) ? { ...t, status } : t
            ))
        }

        applyStatus(newStatus)
        if (task.google_event_id) {
            broadcastEventCompletion(task.calendar_event_id || task.google_event_id, newStatus === 'done', task.google_event_id, task.calendar_id || undefined)
        }

        try {
            await onUpdateTask(taskId, { status: newStatus })
            if (task.google_event_id) {
                invalidateCalendarCache()
            }
        } catch (err) {
            applyStatus(previousStatus)
            if (task.google_event_id) {
                broadcastEventCompletion(task.calendar_event_id || task.google_event_id, previousStatus === 'done', task.google_event_id, task.calendar_id || undefined)
            }
            throw err
        }
        pushAction({
            description: `「${task.title}」の完了状態を変更`,
            undo: async () => {
                applyStatus(previousStatus)
                if (task.google_event_id) {
                    broadcastEventCompletion(task.calendar_event_id || task.google_event_id, previousStatus === 'done', task.google_event_id, task.calendar_id || undefined)
                    invalidateCalendarCache()
                }
                await onUpdateTask(taskId, { status: previousStatus })
            },
            redo: async () => {
                applyStatus(newStatus)
                if (task.google_event_id) {
                    broadcastEventCompletion(task.calendar_event_id || task.google_event_id, newStatus === 'done', task.google_event_id, task.calendar_id || undefined)
                    invalidateCalendarCache()
                }
                await onUpdateTask(taskId, { status: newStatus })
            },
        })
    }, [localTasks, onUpdateTask, pushAction])

    // Toggle calendar event completion
    const toggleEventCompletion = useCallback(async (eventId: string) => {
        // setState callback 外でイベントを取得（React の updater は render 時実行のため）
        const targetEvent = localCalendarEvents.find(e => e.id === eventId)
        console.log('[toggleEventCompletion] eventId:', eventId, 'found:', !!targetEvent, 'localCount:', localCalendarEvents.length)
        if (!targetEvent) {
            console.error('[toggleEventCompletion] Event not found in localCalendarEvents! IDs:', localCalendarEvents.slice(0, 3).map(e => e.id))
            return
        }

        const newCompleted = !targetEvent.is_completed
        const googleEventId = targetEvent.google_event_id
        console.log('[toggleEventCompletion] googleEventId:', googleEventId, 'newCompleted:', newCompleted)

        // ローカル状態を即時更新
        setLocalCalendarEvents(prev => prev.map(e =>
            e.id === eventId ? { ...e, is_completed: newCompleted } : e
        ))
        // 他パネルに即時反映（API ラウンドトリップ不要）
        broadcastEventCompletion(eventId, newCompleted, googleEventId, targetEvent.calendar_id)
        try {
            if (googleEventId) {
                // Google イベント: サーバー側 API 経由で更新（RLS/型の問題を回避）
                const response = await fetch('/api/calendar/events/complete', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        google_event_id: googleEventId,
                        calendar_id: targetEvent.calendar_id,
                        completed_date: formatDateString(new Date(targetEvent.start_time)),
                        start_time: targetEvent.start_time,
                        is_completed: newCompleted,
                    }),
                })
                console.log('[toggleEventCompletion] API response:', response.status, response.ok)
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}))
                    throw new Error(errData.error || `HTTP ${response.status}`)
                }
            } else {
                // ローカルイベント: id（UUID型）でブラウザクライアント更新
                const supabase = (await import('@/utils/supabase/client')).createClient()
                const { error } = await supabase
                    .from('calendar_events')
                    .update({ is_completed: newCompleted })
                    .eq('id', eventId)
                if (error) throw error
            }
            console.log('[toggleEventCompletion] DB update succeeded')
            invalidateCalendarCache()
            pushAction({
                description: `「${targetEvent.title}」の完了状態を変更`,
                undo: async () => {
                    await setCalendarEventCompletion(targetEvent, !!targetEvent.is_completed)
                },
                redo: async () => {
                    await setCalendarEventCompletion(targetEvent, newCompleted)
                },
            })
        } catch (err) {
            console.error('[toggleEventCompletion] Failed:', err)
            setLocalCalendarEvents(prev => prev.map(e =>
                e.id === eventId ? { ...e, is_completed: !newCompleted } : e
            ))
            // 失敗時はロールバックも即時通知
            broadcastEventCompletion(eventId, !newCompleted, googleEventId, targetEvent.calendar_id)
        }
    }, [localCalendarEvents, pushAction, setCalendarEventCompletion])

    // Toggle child task
    const toggleChildTask = useCallback(async (
        taskId: string,
        currentStatus: string,
        habitItem?: HabitWithDetails
    ) => {
        if (habitItem) {
            await toggleChildTaskCompletion(habitItem.habit.id, taskId)
        } else {
            const newStatus = currentStatus === 'done' ? 'todo' : 'done'
            await onUpdateTask(taskId, { status: newStatus })
            const task = localTasks.find(t => t.id === taskId)
            pushAction({
                description: `「${task?.title ?? 'サブタスク'}」の完了状態を変更`,
                undo: async () => {
                    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: currentStatus } : t))
                    await onUpdateTask(taskId, { status: currentStatus })
                },
                redo: async () => {
                    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
                    await onUpdateTask(taskId, { status: newStatus })
                },
            })
        }
    }, [localTasks, onUpdateTask, pushAction, toggleChildTaskCompletion])

    // Handle item tap (open edit modal with prefetched reminders)
    const handleItemTap = useCallback((item: TimeBlock) => {
        const reminderKey = item.googleEventId && item.calendarId
            ? `${item.calendarId}::${item.googleEventId}`
            : null
        const prefetchedReminders = reminderKey ? prefetchedEventReminders[reminderKey] : undefined
        const fetchedEvent = reminderKey ? eventByGoogleKey.get(reminderKey) : undefined
        const fetchedReminders = fetchedEvent?.reminders

        const resolvedReminders = prefetchedReminders ?? fetchedReminders

        const targetWithReminder = resolvedReminders !== undefined
            ? {
                ...item,
                originalEvent: item.originalEvent
                    ? { ...item.originalEvent, reminders: resolvedReminders }
                    : {
                        id: item.id,
                        user_id: '',
                        google_event_id: item.googleEventId!,
                        calendar_id: item.calendarId!,
                        title: item.title,
                        start_time: item.startTime.toISOString(),
                        end_time: item.endTime.toISOString(),
                        is_all_day: false,
                        timezone: 'Asia/Tokyo',
                        synced_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        reminders: resolvedReminders,
                    },
            }
            : item

        setEditTarget(targetWithReminder)
        setIsEditModalOpen(true)
    }, [prefetchedEventReminders, eventByGoogleKey])

    // Background prefetch only the nearby events. Fetching details for every
    // event in the month window can saturate the browser during fast navigation.
    useEffect(() => {
        const priorityMin = new Date(selectedDate)
        priorityMin.setHours(0, 0, 0, 0)
        priorityMin.setDate(priorityMin.getDate() - 1)
        const priorityMax = new Date(selectedDate)
        priorityMax.setHours(0, 0, 0, 0)
        priorityMax.setDate(priorityMax.getDate() + 4)

        const candidates = allFetchedEvents.filter(event => {
            if (!event.google_event_id || !event.calendar_id) return false
            const start = new Date(event.start_time)
            return start >= priorityMin && start < priorityMax
        })
        if (candidates.length === 0) return

        const sortedCandidates = [...candidates]
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            .slice(0, REMINDER_PREFETCH_MAX_EVENTS)

        const controller = new AbortController()
        const timeout = setTimeout(() => {
            void (async () => {
                for (const event of sortedCandidates) {
                    if (controller.signal.aborted) break
                    const key = reminderKeyForEvent(event)
                    if (event.reminders !== undefined || prefetchedEventRemindersRef.current[key]) continue
                    if (reminderPrefetchInFlightRef.current.has(key)) continue

                    reminderPrefetchInFlightRef.current.add(key)
                    try {
                        const res = await fetch(
                            `/api/calendar/events/${event.id}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`,
                            { signal: controller.signal },
                        )
                        if (!res.ok) continue
                        const data = await res.json()
                        const reminders = Array.isArray(data.reminders) ? data.reminders as number[] : null
                        if (!reminders) continue

                        prefetchedEventRemindersRef.current = {
                            ...prefetchedEventRemindersRef.current,
                            [key]: reminders,
                        }
                        setPrefetchedEventReminders(prev => {
                            if (prev[key]) return prev
                            return { ...prev, [key]: reminders }
                        })
                        setLocalCalendarEvents(prev => prev.map(e =>
                            e.google_event_id === event.google_event_id && e.calendar_id === event.calendar_id
                                ? { ...e, reminders }
                                : e
                        ))
                    } catch (err) {
                        if ((err as Error).name === 'AbortError') return
                        console.warn('[useTodayViewLogic] Failed to prefetch reminders:', err)
                        prefetchedEventRemindersRef.current = {
                            ...prefetchedEventRemindersRef.current,
                            [key]: [],
                        }
                        setPrefetchedEventReminders(prev => {
                            if (prev[key] !== undefined) return prev
                            return { ...prev, [key]: [] }
                        })
                    } finally {
                        reminderPrefetchInFlightRef.current.delete(key)
                    }
                }
            })()
        }, REMINDER_PREFETCH_DELAY_MS)

        return () => {
            clearTimeout(timeout)
            controller.abort()
        }
    }, [allFetchedEvents, reminderKeyForEvent, selectedDate])

    const handleCloseEditModal = useCallback(() => {
        setIsEditModalOpen(false)
        setEditTarget(null)
    }, [])

    const openTaskEditModal = useCallback((taskId: string) => {
        const task = localTasks.find(t => t.id === taskId)
        if (!task) return

        const fallbackStart = new Date(selectedDate)
        if (isSameDay(selectedDate, new Date())) {
            const now = new Date()
            const roundedMinutes = Math.ceil(now.getMinutes() / 5) * 5
            now.setSeconds(0, 0)
            now.setMinutes(roundedMinutes)
            fallbackStart.setHours(now.getHours(), now.getMinutes(), 0, 0)
        } else {
            fallbackStart.setHours(9, 0, 0, 0)
        }

        const startTime = task.scheduled_at ? new Date(task.scheduled_at) : fallbackStart
        const durationMinutes = task.estimated_time || 30
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)

        setEditTarget({
            id: task.id,
            source: 'task',
            title: task.title,
            startTime,
            endTime,
            color: '#F97316',
            isCompleted: task.status === 'done',
            isTimerRunning: task.is_timer_running,
            taskId: task.id,
            calendarId: task.calendar_id || undefined,
            projectId: task.project_id || undefined,
            estimatedTime: task.estimated_time || 30,
            totalElapsedSeconds: task.total_elapsed_seconds,
            originalTask: task,
        })
        setIsEditModalOpen(true)
    }, [localTasks, selectedDate])

    // Save task
    const handleSaveTask = useCallback(async (taskId: string, updates: {
        title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string; memo?: string | null; reminders?: number[]
    }) => {
        const { reminders, ...taskUpdates } = updates
        const task = localTasks.find(t => t.id === taskId)
        const previousTasks = localTasks
        const previousEditTarget = editTarget
        setLocalTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, ...taskUpdates } : t
        ))
        setEditTarget(prev => {
            if (!prev || prev.taskId !== taskId) return prev
            const nextStart = taskUpdates.scheduled_at ? new Date(taskUpdates.scheduled_at) : prev.startTime
            const nextDuration = taskUpdates.estimated_time ?? prev.estimatedTime ?? 30
            return {
                ...prev,
                title: taskUpdates.title ?? prev.title,
                startTime: nextStart,
                endTime: new Date(nextStart.getTime() + nextDuration * 60 * 1000),
                estimatedTime: nextDuration,
                calendarId: taskUpdates.calendar_id ?? prev.calendarId,
                originalTask: prev.originalTask ? { ...prev.originalTask, ...taskUpdates } : prev.originalTask,
            }
        })
        if (task?.google_event_id && taskUpdates.scheduled_at) {
            const nextDuration = taskUpdates.estimated_time ?? task.estimated_time ?? 30
            const start = new Date(taskUpdates.scheduled_at)
            const end = new Date(start.getTime() + nextDuration * 60 * 1000)
            broadcastCalendarEventTimeUpdate(task.google_event_id, start.toISOString(), end.toISOString())
        }

        const hasCalendarSyncUpdate =
            !!task?.google_event_id &&
            (
                reminders !== undefined ||
                taskUpdates.title !== undefined ||
                taskUpdates.scheduled_at !== undefined ||
                taskUpdates.estimated_time !== undefined ||
                taskUpdates.calendar_id !== undefined ||
                taskUpdates.memo !== undefined
            )

        let persistedTaskUpdates: Partial<Task> = taskUpdates as Partial<Task>
        let linkedCalendarEventUpdated = false

        if (task && hasCalendarSyncUpdate) {
            const nextStartTime = taskUpdates.scheduled_at ?? task.scheduled_at
            const nextDuration = taskUpdates.estimated_time ?? task.estimated_time
            const nextCalendarId = taskUpdates.calendar_id ?? task.calendar_id

            if (nextStartTime && nextDuration > 0 && nextCalendarId) {
                const nextStart = new Date(nextStartTime)
                const nextEnd = new Date(nextStart.getTime() + nextDuration * 60 * 1000)
                let data: Record<string, string | boolean | { message?: string } | undefined> = {}
                try {
                    const res = await fetch(`/api/calendar/events/${task.calendar_event_id || task.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: taskUpdates.title ?? task.title,
                            start_time: nextStart.toISOString(),
                            end_time: nextEnd.toISOString(),
                            description: taskUpdates.memo !== undefined ? taskUpdates.memo : task.memo,
                            googleEventId: task.google_event_id,
                            calendarId: nextCalendarId,
                            originalCalendarId: task.calendar_id || nextCalendarId,
                            estimated_time: nextDuration,
                            reminders,
                        }),
                    })
                    data = await res.json().catch(() => ({}))
                    if (!res.ok || data.success === false) {
                        const message = typeof data.error === 'object' ? data.error?.message : undefined
                        throw new Error(message || 'Failed to update linked Google Calendar event')
                    }
                } catch (err) {
                    setLocalTasks(previousTasks)
                    setEditTarget(previousEditTarget)
                    throw err
                }

                const effectiveGoogleEventId = typeof data.google_event_id === 'string'
                    ? data.google_event_id
                    : task.google_event_id
                const effectiveCalendarId = typeof data.calendar_id === 'string'
                    ? data.calendar_id
                    : nextCalendarId
                persistedTaskUpdates = {
                    ...taskUpdates,
                    google_event_id: effectiveGoogleEventId,
                    calendar_id: effectiveCalendarId,
                } as Partial<Task>
                linkedCalendarEventUpdated = true
                setLocalTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? { ...t, google_event_id: effectiveGoogleEventId, calendar_id: effectiveCalendarId }
                        : t
                ))
                setEditTarget(prev => {
                    if (!prev || prev.taskId !== taskId) return prev
                    return {
                        ...prev,
                        calendarId: effectiveCalendarId,
                        originalTask: prev.originalTask
                            ? { ...prev.originalTask, ...persistedTaskUpdates }
                            : prev.originalTask,
                    }
                })
                broadcastCalendarEventDetailUpdate({
                    eventId: task.calendar_event_id || task.id,
                    googleEventId: effectiveGoogleEventId || undefined,
                    calendarId: effectiveCalendarId,
                    previousCalendarId: task.calendar_id || nextCalendarId,
                    taskId,
                    title: taskUpdates.title ?? task.title,
                    startTime: nextStart.toISOString(),
                    endTime: nextEnd.toISOString(),
                    reminders,
                    ...(taskUpdates.memo !== undefined ? { description: taskUpdates.memo || undefined } : {}),
                })
                invalidateCalendarCache()
                broadcastCalendarSync()
            }
        }

        try {
            await onUpdateTask(taskId, persistedTaskUpdates)
        } catch (err) {
            if (!linkedCalendarEventUpdated) {
                setLocalTasks(previousTasks)
                setEditTarget(previousEditTarget)
                throw err
            }
            console.warn('[useTodayViewLogic] Linked calendar event was saved, but task state refresh failed:', err)
        }

        if (task && Object.keys(taskUpdates).length > 0) {
            const undoUpdates: Partial<Task> = {}
            for (const key of Object.keys(taskUpdates) as Array<keyof Task>) {
                undoUpdates[key] = task[key] as never
            }
            const redoUpdates = taskUpdates as Partial<Task>
            pushAction({
                description: `「${task.title}」を編集`,
                undo: async () => {
                    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...undoUpdates } : t))
                    await onUpdateTask(taskId, undoUpdates)
                    if (task.google_event_id && undoUpdates.scheduled_at) {
                        const duration = undoUpdates.estimated_time ?? task.estimated_time ?? 30
                        const start = new Date(undoUpdates.scheduled_at)
                        const end = new Date(start.getTime() + duration * 60 * 1000)
                        broadcastCalendarEventTimeUpdate(task.google_event_id, start.toISOString(), end.toISOString())
                    }
                },
                redo: async () => {
                    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...redoUpdates } : t))
                    await onUpdateTask(taskId, redoUpdates)
                    if (task.google_event_id && redoUpdates.scheduled_at) {
                        const duration = redoUpdates.estimated_time ?? task.estimated_time ?? 30
                        const start = new Date(redoUpdates.scheduled_at)
                        const end = new Date(start.getTime() + duration * 60 * 1000)
                        broadcastCalendarEventTimeUpdate(task.google_event_id, start.toISOString(), end.toISOString())
                    }
                },
            })
        }

    }, [onUpdateTask, localTasks, editTarget, pushAction])

    // Save event
    const handleSaveEvent = useCallback(async (eventId: string, updates: {
        title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string; originalCalendarId?: string; reminders?: number[]; description?: string
    }) => {
        const previousEvents = localCalendarEvents
        const previousTasks = localTasks
        const previousEvent = localCalendarEvents.find(e => e.id === eventId)
        const previousTask = updates.googleEventId
            ? localTasks.find(task => task.google_event_id === updates.googleEventId)
            : undefined
        const sourceCalendarId = updates.originalCalendarId || previousEvent?.calendar_id || previousTask?.calendar_id || updates.calendarId
        const durationMinutes = Math.max(
            1,
            Math.round((new Date(updates.end_time).getTime() - new Date(updates.start_time).getTime()) / 60000)
        )
        const broadcastPreviousEventDetail = () => {
            if (previousEvent) {
                broadcastCalendarEventDetailUpdate({
                    eventId,
                    googleEventId: previousEvent.google_event_id,
                    calendarId: previousEvent.calendar_id,
                    previousCalendarId: updates.calendarId || sourceCalendarId,
                    taskId: previousEvent.task_id || previousTask?.id,
                    title: previousEvent.title,
                    startTime: previousEvent.start_time,
                    endTime: previousEvent.end_time,
                    reminders: previousEvent.reminders,
                    description: previousEvent.description ?? "",
                })
                return
            }

            if (!previousTask?.scheduled_at) return
            const previousStart = new Date(previousTask.scheduled_at)
            if (Number.isNaN(previousStart.getTime())) return
            const previousEnd = new Date(
                previousStart.getTime() + Math.max(1, previousTask.estimated_time || durationMinutes) * 60000
            )
            broadcastCalendarEventDetailUpdate({
                eventId: previousTask.calendar_event_id || eventId,
                googleEventId: previousTask.google_event_id || undefined,
                calendarId: previousTask.calendar_id || undefined,
                previousCalendarId: updates.calendarId || sourceCalendarId,
                taskId: previousTask.id,
                title: previousTask.title,
                startTime: previousTask.scheduled_at,
                endTime: previousEnd.toISOString(),
                description: previousTask.memo ?? "",
            })
        }

        setLocalCalendarEvents(prev => prev.map(e =>
            e.id === eventId
                ? {
                    ...e,
                    title: updates.title,
                    start_time: updates.start_time,
                    end_time: updates.end_time,
                    calendar_id: updates.calendarId || e.calendar_id,
                    reminders: updates.reminders,
                    ...(updates.description !== undefined ? { description: updates.description } : {}),
                }
                : e
        ))
        // Google連携タスクは timeline 表示が task 側を優先するため、task も同時に更新して即時反映する
        setLocalTasks(prev => prev.map(task =>
            task.google_event_id === updates.googleEventId
                ? {
                    ...task,
                    title: updates.title,
                    scheduled_at: updates.start_time,
                    estimated_time: durationMinutes,
                    calendar_id: updates.calendarId || task.calendar_id,
                }
                : task
        ))
        broadcastCalendarEventDetailUpdate({
            eventId,
            googleEventId: updates.googleEventId,
            calendarId: updates.calendarId,
            previousCalendarId: sourceCalendarId,
            taskId: previousEvent?.task_id || previousTask?.id,
            title: updates.title,
            startTime: updates.start_time,
            endTime: updates.end_time,
            reminders: updates.reminders,
            ...(updates.description !== undefined ? { description: updates.description } : {}),
        })

        if (!updates.googleEventId) {
            setLocalCalendarEvents(previousEvents)
            setLocalTasks(previousTasks)
            broadcastPreviousEventDetail()
            throw new Error('Google予定IDがないため保存できません。カレンダーを更新してから再度お試しください。')
        }

        try {
            const res = await fetch(`/api/calendar/events/${eventId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: updates.title,
                    start_time: updates.start_time,
                    end_time: updates.end_time,
                    googleEventId: updates.googleEventId,
                    calendarId: updates.calendarId,
                    originalCalendarId: sourceCalendarId,
                    estimated_time: durationMinutes,
                    reminders: updates.reminders,
                    ...(updates.description !== undefined ? { description: updates.description } : {}),
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.success === false) {
                throw new Error(data.error?.message || 'Failed to update event')
            }
            const effectiveGoogleEventId = typeof data.google_event_id === 'string'
                ? data.google_event_id
                : updates.googleEventId
            const effectiveCalendarId = typeof data.calendar_id === 'string'
                ? data.calendar_id
                : updates.calendarId
            if (effectiveGoogleEventId !== updates.googleEventId || effectiveCalendarId !== updates.calendarId) {
                setLocalCalendarEvents(prev => prev.map(e =>
                    e.google_event_id === updates.googleEventId && (e.calendar_id === sourceCalendarId || e.id === eventId)
                        ? { ...e, google_event_id: effectiveGoogleEventId, calendar_id: effectiveCalendarId }
                        : e
                ))
                setLocalTasks(prev => prev.map(task =>
                    task.google_event_id === updates.googleEventId
                        ? { ...task, google_event_id: effectiveGoogleEventId, calendar_id: effectiveCalendarId }
                        : task
                ))
            }
            invalidateCalendarCache()
            broadcastCalendarSync()
            if (previousEvent) {
                const previousDurationMinutes = Math.max(
                    1,
                    Math.round((new Date(previousEvent.end_time).getTime() - new Date(previousEvent.start_time).getTime()) / 60000)
                )
                const undoUpdates = {
                    title: previousEvent.title,
                    start_time: previousEvent.start_time,
                    end_time: previousEvent.end_time,
                    googleEventId: previousEvent.google_event_id,
                    calendarId: previousEvent.calendar_id,
                    originalCalendarId: updates.calendarId,
                    estimated_time: previousEvent.estimated_time ?? previousDurationMinutes,
                    reminders: previousEvent.reminders,
                    description: previousEvent.description,
                }
                const redoUpdates = { ...updates, estimated_time: durationMinutes }
                pushAction({
                    description: `「${previousEvent.title}」の予定を編集`,
                    undo: async () => {
                        await patchCalendarEvent(previousEvent, undoUpdates)
                    },
                    redo: async () => {
                        await patchCalendarEvent(previousEvent, redoUpdates)
                    },
                })
            }
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to update event, rolling back:', err)
            setLocalCalendarEvents(previousEvents)
            setLocalTasks(previousTasks)
            broadcastPreviousEventDetail()
            throw err
        }
    }, [localCalendarEvents, localTasks, patchCalendarEvent, pushAction])

    // Delete task
    const handleDeleteTask = useCallback(async (taskId: string) => {
        const taskToDelete = localTasks.find(t => t.id === taskId)
        const previousTasks = localTasks
        const previousEvents = localCalendarEvents

        setPendingDeleteTaskIds(prev => prev.includes(taskId) ? prev : [...prev, taskId])

        setLocalTasks(prev => prev.filter(t => t.id !== taskId))

        if (taskToDelete?.google_event_id) {
            setLocalCalendarEvents(prev => prev.filter(e =>
                !(e.google_event_id === taskToDelete.google_event_id && (!taskToDelete.calendar_id || e.calendar_id === taskToDelete.calendar_id))
            ))
        }

        try {
            if (onDeleteTaskProp) {
                await onDeleteTaskProp(taskId)
            } else {
                const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                if (!res.ok) throw new Error('Failed to delete task')
            }

            invalidateCalendarCache()
            broadcastCalendarSync()
            if (taskToDelete) {
                pushAction({
                    description: `「${taskToDelete.title}」を削除`,
                    undo: async () => {
                        const restoredTask = taskToDelete.google_event_id
                            ? { ...taskToDelete, google_event_id: null, calendar_event_id: null }
                            : taskToDelete
                        setPendingDeleteTaskIds(prev => prev.filter(id => id !== taskId))
                        setLocalTasks(prev => prev.some(t => t.id === taskId) ? prev : [...prev, restoredTask])

                        const createRes = await fetch('/api/tasks', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(restoredTask),
                        })
                        if (!createRes.ok) throw new Error('Failed to restore task')

                        await onUpdateTask(taskId, {
                            title: taskToDelete.title,
                            status: taskToDelete.status,
                            stage: taskToDelete.stage,
                            scheduled_at: taskToDelete.scheduled_at,
                            estimated_time: taskToDelete.estimated_time,
                            calendar_id: taskToDelete.calendar_id,
                            priority: taskToDelete.priority,
                            memo: taskToDelete.memo,
                        })

                        if (taskToDelete.google_event_id && taskToDelete.scheduled_at && taskToDelete.calendar_id && taskToDelete.estimated_time > 0) {
                            const syncRes = await fetch('/api/calendar/sync-task', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    taskId,
                                    scheduled_at: taskToDelete.scheduled_at,
                                    estimated_time: taskToDelete.estimated_time,
                                    calendar_id: taskToDelete.calendar_id,
                                }),
                            })
                            if (syncRes.ok) {
                                const data = await syncRes.json().catch(() => null)
                                if (data?.googleEventId) {
                                    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, google_event_id: data.googleEventId } : t))
                                }
                            }
                        }
                        invalidateCalendarCache()
                        broadcastCalendarSync()
                    },
                    redo: async () => {
                        setPendingDeleteTaskIds(prev => prev.includes(taskId) ? prev : [...prev, taskId])
                        setLocalTasks(prev => prev.filter(t => t.id !== taskId))
                        if (taskToDelete.google_event_id) {
                            setLocalCalendarEvents(prev => prev.filter(e =>
                                !(e.google_event_id === taskToDelete.google_event_id && (!taskToDelete.calendar_id || e.calendar_id === taskToDelete.calendar_id))
                            ))
                        }
                        if (onDeleteTaskProp) {
                            await onDeleteTaskProp(taskId)
                        } else {
                            const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                            if (!res.ok) throw new Error('Failed to delete task')
                        }
                        invalidateCalendarCache()
                        broadcastCalendarSync()
                    },
                })
            }
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to delete task:', err)
            setLocalTasks(previousTasks)
            setLocalCalendarEvents(previousEvents)
            setPendingDeleteTaskIds(prev => prev.filter(id => id !== taskId))
        }
    }, [onDeleteTaskProp, localTasks, localCalendarEvents, onUpdateTask, pushAction])

    // Convert calendar event to Focusmap task (for timer/subtask support)
    const handleConvertEventToTask = useCallback(async (event: CalendarEvent): Promise<Task | null> => {
        if (!event.google_event_id) return null
        const durationMinutes = Math.max(1, Math.round(
            (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
        ))
        const tempId = crypto.randomUUID()
        const optimisticTask: Task = {
            id: tempId,
            user_id: '',
            project_id: null,
            parent_task_id: null,
            is_group: false,
            title: event.title,
            status: 'todo',
            stage: 'scheduled',
            priority: null,
            order_index: 0,
            scheduled_at: event.start_time,
            estimated_time: durationMinutes,
            actual_time_minutes: 0,
            google_event_id: event.google_event_id,
            calendar_event_id: null,
            calendar_id: event.calendar_id,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source: 'google_event',
            deleted_at: null,
            google_event_fingerprint: null,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
            memo_images: null,
            node_width: null,
            mindmap_collapsed: false,
        }
        setLocalTasks(prev => [...prev, optimisticTask])

        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: tempId,
                    title: event.title,
                    scheduled_at: event.start_time,
                    estimated_time: durationMinutes,
                    google_event_id: event.google_event_id,
                    calendar_id: event.calendar_id,
                    source: 'google_event',
                }),
            })
            if (!res.ok) {
                setLocalTasks(prev => prev.filter(t => t.id !== tempId))
                return null
            }
            const { task } = await res.json()
            setLocalTasks(prev => prev.map(t => t.id === tempId ? task : t))
            pushAction({
                description: `「${event.title}」をタスク化`,
                undo: async () => {
                    setLocalTasks(prev => prev.filter(t => t.id !== tempId))
                    await fetch(`/api/tasks/${tempId}`, { method: 'DELETE' })
                },
                redo: async () => {
                    setLocalTasks(prev => prev.some(t => t.id === tempId) ? prev : [...prev, task as Task])
                    const createRes = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(task),
                    })
                    if (!createRes.ok) throw new Error('Failed to recreate task')
                },
            })
            return task as Task
        } catch (err) {
            console.error('[useTodayViewLogic] handleConvertEventToTask failed:', err)
            setLocalTasks(prev => prev.filter(t => t.id !== tempId))
            return null
        }
    }, [pushAction])

    const handleEventStartTimer = useCallback(async (event: CalendarEvent) => {
        const task = await handleConvertEventToTask(event)
        if (task) timer.startTimer(task)
    }, [handleConvertEventToTask, timer])

    const handleEventToggleExpand = useCallback(async (event: CalendarEvent) => {
        const task = await handleConvertEventToTask(event)
        if (task) setPendingExpandTaskId(task.id)
    }, [handleConvertEventToTask])

    const applyCalendarEventToMemoOptimism = useCallback((payload: CalendarEventMemoPayload) => {
        const now = new Date().toISOString()
        setLocalCalendarEvents(prev => prev.filter(candidate =>
            candidate.id !== payload.eventId &&
            !(candidate.google_event_id === payload.googleEventId && candidate.calendar_id === payload.calendarId)
        ))
        setLocalTasks(prev => prev.flatMap(task => {
            if (task.google_event_id !== payload.googleEventId || task.calendar_id !== payload.calendarId) return [task]
            if (task.source === 'google_event') return []
            return [{
                ...task,
                scheduled_at: null,
                google_event_id: null,
                calendar_id: null,
                updated_at: now,
            }]
        }))
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const handler = (event: Event) => {
            const payload = (event as CustomEvent<CalendarEventMemoPayload>).detail
            if (!payload?.googleEventId || !payload.calendarId) return
            applyCalendarEventToMemoOptimism(payload)
        }
        window.addEventListener(CALENDAR_EVENT_TO_MEMO_CONVERTED_EVENT, handler)
        return () => window.removeEventListener(CALENDAR_EVENT_TO_MEMO_CONVERTED_EVENT, handler)
    }, [applyCalendarEventToMemoOptimism])

    const handleConvertCalendarPayloadToMemo = useCallback(async (payload: CalendarEventMemoPayload) => {
        const deleteScope = confirmCalendarEventMemoDeleteScope(payload)
        if (!deleteScope) return

        const previousEvents = localCalendarEvents
        const previousTasks = localTasks
        applyCalendarEventToMemoOptimism(payload)
        broadcastCalendarOptimisticEventRemoval(payload.eventId, payload.googleEventId, payload.calendarId)

        try {
            await convertCalendarEventToMemo(payload, {
                projectId: selectedProjectId,
                deleteScope,
            })

            invalidateWishlistItemsCache()
            invalidateCalendarCache()
            broadcastCalendarSync()
            broadcastCalendarEventToMemoConverted(payload)
            window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT, {
                detail: { source: "calendar-event-to-memo" },
            }))
        } catch (err) {
            console.error("[useTodayViewLogic] handleConvertEventToMemo failed:", err)
            setLocalCalendarEvents(previousEvents)
            setLocalTasks(previousTasks)
            broadcastCalendarSync()
            alert(`メモ作成に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`)
        }
    }, [applyCalendarEventToMemoOptimism, localCalendarEvents, localTasks, selectedProjectId])

    const handleConvertEventToMemo = useCallback(async (event: CalendarEvent) => {
        const payload = buildCalendarEventMemoPayload(event)
        if (!payload) return
        await handleConvertCalendarPayloadToMemo(payload)
    }, [handleConvertCalendarPayloadToMemo])

    // Delete event
    // 削除する Google Calendar event に紐づく Focusmap タスク（source 不問）も同時に削除する。
    // ユーザー視点では「カレンダーの予定を消したらタスクも消える」のが自然。
    // クイック追加で作ったタスク（source='manual', google_event_id=同期後にセット）は
    // モーダルが「予定を編集」として開くケースがあり、これまでは event だけ消えてタスクが残る不具合があった。
    const handleDeleteEvent = useCallback(async (eventId: string, googleEventId: string, calendarId: string) => {
        const previousEvents = localCalendarEvents
        const previousTasks = localTasks
        const eventToDelete = localCalendarEvents.find(e =>
            e.id === eventId ||
            (e.google_event_id === googleEventId && e.calendar_id === calendarId)
        )

        // 同じ google_event_id を持つタスク（source 不問）の id を全て収集
        const linkedTasks = localTasks.filter(t => t.google_event_id === googleEventId && (!t.calendar_id || t.calendar_id === calendarId))
        const linkedTaskIds = linkedTasks.map(t => t.id)

        removeOptimisticEvent(eventId, googleEventId, calendarId)
        broadcastCalendarOptimisticEventRemoval(eventId, googleEventId, calendarId)
        setLocalCalendarEvents(prev => prev.filter(e =>
            e.id !== eventId &&
            !(e.google_event_id === googleEventId && e.calendar_id === calendarId)
        ))
        // 紐づく全タスクをローカルから除外
        setLocalTasks(prev => prev.filter(t => !(t.google_event_id === googleEventId && (!t.calendar_id || t.calendar_id === calendarId))))
        // pendingDeleteTaskIds にも積み、props 経由の再供給で復活しないようにする
        if (linkedTaskIds.length > 0) {
            setPendingDeleteTaskIds(prev => {
                const next = new Set(prev)
                for (const id of linkedTaskIds) next.add(id)
                return Array.from(next)
            })
        }

        try {
            const res = await fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(googleEventId)}&calendarId=${encodeURIComponent(calendarId)}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const data = await res.json().catch(() => null)
                throw new Error(data?.error?.message || 'Failed to delete event')
            }
            // 紐づくタスクもサーバー側から削除（DELETE は冪等な前提）
            for (const taskId of linkedTaskIds) {
                if (onDeleteTaskProp) {
                    await onDeleteTaskProp(taskId).catch(err => {
                        console.warn('[useTodayViewLogic] linked task delete failed:', taskId, err)
                    })
                } else {
                    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }).catch(err => {
                        console.warn('[useTodayViewLogic] linked task delete failed:', taskId, err)
                    })
                }
            }
            // refetchは呼ばず、楽観的削除済みのため不要（再フェッチするとサーバーからイベントが復元されてしまう）
            invalidateCalendarCache()
            if (eventToDelete) {
                let currentEvent = eventToDelete
                pushAction({
                    description: `「${eventToDelete.title}」を削除`,
                    undo: async () => {
                            const createRes = await fetch(`/api/calendar/events/${eventToDelete.id}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    ...eventToDelete,
                                    calendarId,
                                    reminders: eventToDelete.reminders,
                                }),
                            })
                            if (!createRes.ok) throw new Error('Failed to restore event')
                            const data = await createRes.json()
                            currentEvent = data.event || {
                                ...eventToDelete,
                                google_event_id: data.googleEventId,
                                calendar_id: calendarId,
                            }

                        setLocalCalendarEvents(prev => {
                            const next = prev.filter(e =>
                                e.id !== currentEvent.id &&
                                !(e.google_event_id === currentEvent.google_event_id && e.calendar_id === currentEvent.calendar_id)
                            )
                            return [...next, currentEvent].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                        })

                            if (linkedTasks.length > 0) {
                                setPendingDeleteTaskIds(prev => prev.filter(id => !linkedTaskIds.includes(id)))
                                for (const task of linkedTasks) {
                                    const restoredTask = {
                                        ...task,
                                        google_event_id: currentEvent.google_event_id,
                                        calendar_id: currentEvent.calendar_id,
                                    }
                                    setLocalTasks(prev => prev.some(t => t.id === task.id) ? prev.map(t => t.id === task.id ? restoredTask : t) : [...prev, restoredTask])
                                    const taskRes = await fetch('/api/tasks', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(restoredTask),
                                    })
                                    if (!taskRes.ok) throw new Error('Failed to restore linked task')
                                    await onUpdateTask(task.id, {
                                        title: task.title,
                                        status: task.status,
                                        stage: task.stage,
                                        scheduled_at: task.scheduled_at,
                                        estimated_time: task.estimated_time,
                                        calendar_id: currentEvent.calendar_id,
                                        priority: task.priority,
                                        memo: task.memo,
                                        google_event_id: currentEvent.google_event_id,
                                    })
                                }
                            }
                        invalidateCalendarCache()
                        broadcastCalendarSync()
                    },
                    redo: async () => {
                            removeOptimisticEvent(currentEvent.id, currentEvent.google_event_id, currentEvent.calendar_id)
                            broadcastCalendarOptimisticEventRemoval(currentEvent.id, currentEvent.google_event_id, currentEvent.calendar_id)
                            setLocalCalendarEvents(prev => prev.filter(e =>
                                e.id !== currentEvent.id &&
                                !(e.google_event_id === currentEvent.google_event_id && e.calendar_id === currentEvent.calendar_id)
                            ))
                            setLocalTasks(prev => prev.filter(t => !linkedTaskIds.includes(t.id)))
                            if (linkedTaskIds.length > 0) {
                                setPendingDeleteTaskIds(prev => {
                                    const next = new Set(prev)
                                    for (const id of linkedTaskIds) next.add(id)
                                    return Array.from(next)
                                })
                            }
                            const deleteRes = await fetch(`/api/calendar/events/${currentEvent.id}?googleEventId=${encodeURIComponent(currentEvent.google_event_id)}&calendarId=${encodeURIComponent(currentEvent.calendar_id)}`, {
                                method: 'DELETE',
                            })
                            if (!deleteRes.ok) throw new Error('Failed to delete event')
                            for (const taskId of linkedTaskIds) {
                                if (onDeleteTaskProp) {
                                    await onDeleteTaskProp(taskId)
                                } else {
                                    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                                }
                            }
                        invalidateCalendarCache()
                    },
                })
            }
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to delete event:', err)
            setLocalCalendarEvents(previousEvents)
            setLocalTasks(previousTasks)
            setPendingDeleteTaskIds(prev => prev.filter(id => !linkedTaskIds.includes(id)))
            invalidateCalendarCache()
            broadcastCalendarSync()
            throw err
        }
    }, [removeOptimisticEvent, localCalendarEvents, localTasks, onDeleteTaskProp, onUpdateTask, pushAction])

    // Writable calendars
    const writableCalendars = useMemo(() =>
        calendars
            .filter(c => c.access_level === 'owner' || c.access_level === 'writer')
            .map(c => ({
                id: c.google_calendar_id,
                name: c.name,
                background_color: c.background_color || undefined,
            })),
        [calendars]
    )

    // Drag & drop time change
    const handleDragDrop = useCallback(async (item: DragItem, newStartTime: Date, newEndTime: Date) => {
        const previousTasks = localTasks
        const previousEvents = localCalendarEvents
        const draggedTask = item.type === 'task' ? localTasks.find(t => t.id === item.id) : null
        const draggedEvent = item.type === 'event' ? calendarEvents.find(e => e.id === item.id) : null

        if (item.type === 'task') {
            setLocalTasks(prev => prev.map(t =>
                t.id === item.id
                    ? {
                        ...t,
                        scheduled_at: newStartTime.toISOString(),
                        estimated_time: Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000),
                    }
                    : t
            ))
            setEditTarget(prev => {
                if (!prev || prev.taskId !== item.id) return prev
                const durationMinutes = Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000)
                return {
                    ...prev,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    estimatedTime: durationMinutes,
                    originalTask: prev.originalTask
                        ? {
                            ...prev.originalTask,
                            scheduled_at: newStartTime.toISOString(),
                            estimated_time: durationMinutes,
                        }
                        : prev.originalTask,
                }
            })
            if (draggedTask?.google_event_id) {
                broadcastCalendarEventTimeUpdate(draggedTask.google_event_id, newStartTime.toISOString(), newEndTime.toISOString())
            }
        } else {
            // 全パネルに即時ブロードキャスト（楽観UI）
            broadcastCalendarEventTimeUpdate(item.id, newStartTime.toISOString(), newEndTime.toISOString())
        }

        startSyncFeedback()

        try {
            if (item.type === 'task') {
                await onUpdateTask(item.id, {
                    scheduled_at: newStartTime.toISOString(),
                    estimated_time: Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000),
                })
            } else {
                const event = calendarEvents.find(e => e.id === item.id)
                if (!event) return
                // リンク先タスクも楽観的に更新
                if (event.task_id) {
                    setLocalTasks(prev => prev.map(t =>
                        t.id === event.task_id ? { ...t, scheduled_at: newStartTime.toISOString() } : t
                    ))
                    await onUpdateTask(event.task_id, {
                        scheduled_at: newStartTime.toISOString(),
                        estimated_time: Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000),
                    })
                } else {
                    const res = await fetch(`/api/calendar/events/${item.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: event.title,
                            start_time: newStartTime.toISOString(),
                            end_time: newEndTime.toISOString(),
                            googleEventId: event.google_event_id,
                            calendarId: event.calendar_id,
                        }),
                    })
                    if (!res.ok) {
                        const data = await res.json()
                        throw new Error(data.error?.message || 'Failed to update event')
                    }
                    invalidateCalendarCache()
                    broadcastCalendarSync()
                }
            }
            if (item.type === 'task' && draggedTask) {
                const previousStart = draggedTask.scheduled_at
                const previousEstimated = draggedTask.estimated_time
                const nextEstimated = Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000)
                pushAction({
                    description: `「${draggedTask.title}」の時間を変更`,
                    undo: async () => {
                        setLocalTasks(prev => prev.map(t => t.id === item.id ? { ...t, scheduled_at: previousStart, estimated_time: previousEstimated } : t))
                        await onUpdateTask(item.id, { scheduled_at: previousStart, estimated_time: previousEstimated })
                        if (draggedTask.google_event_id && previousStart) {
                            const start = new Date(previousStart)
                            const end = new Date(start.getTime() + (previousEstimated || 30) * 60 * 1000)
                            broadcastCalendarEventTimeUpdate(draggedTask.google_event_id, start.toISOString(), end.toISOString())
                        }
                    },
                    redo: async () => {
                        setLocalTasks(prev => prev.map(t => t.id === item.id ? { ...t, scheduled_at: newStartTime.toISOString(), estimated_time: nextEstimated } : t))
                        await onUpdateTask(item.id, { scheduled_at: newStartTime.toISOString(), estimated_time: nextEstimated })
                        if (draggedTask.google_event_id) {
                            broadcastCalendarEventTimeUpdate(draggedTask.google_event_id, newStartTime.toISOString(), newEndTime.toISOString())
                        }
                    },
                })
            } else if (item.type === 'event' && draggedEvent) {
                const nextUpdates = {
                    title: draggedEvent.title,
                    start_time: newStartTime.toISOString(),
                    end_time: newEndTime.toISOString(),
                    googleEventId: draggedEvent.google_event_id,
                    calendarId: draggedEvent.calendar_id,
                    reminders: draggedEvent.reminders,
                    description: draggedEvent.description,
                }
                const previousUpdates = {
                    title: draggedEvent.title,
                    start_time: draggedEvent.start_time,
                    end_time: draggedEvent.end_time,
                    googleEventId: draggedEvent.google_event_id,
                    calendarId: draggedEvent.calendar_id,
                    reminders: draggedEvent.reminders,
                    description: draggedEvent.description,
                }
                pushAction({
                    description: `「${draggedEvent.title}」の時間を変更`,
                    undo: async () => {
                        if (draggedEvent.task_id) {
                            const duration = Math.max(1, Math.round((new Date(draggedEvent.end_time).getTime() - new Date(draggedEvent.start_time).getTime()) / 60000))
                            setLocalTasks(prev => prev.map(t => t.id === draggedEvent.task_id ? { ...t, scheduled_at: draggedEvent.start_time, estimated_time: duration } : t))
                            await onUpdateTask(draggedEvent.task_id, { scheduled_at: draggedEvent.start_time, estimated_time: duration })
                            broadcastCalendarEventTimeUpdate(item.id, draggedEvent.start_time, draggedEvent.end_time)
                        } else {
                            await patchCalendarEvent(draggedEvent, previousUpdates)
                        }
                    },
                    redo: async () => {
                        if (draggedEvent.task_id) {
                            const duration = Math.max(1, Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000))
                            setLocalTasks(prev => prev.map(t => t.id === draggedEvent.task_id ? { ...t, scheduled_at: newStartTime.toISOString(), estimated_time: duration } : t))
                            await onUpdateTask(draggedEvent.task_id, { scheduled_at: newStartTime.toISOString(), estimated_time: duration })
                            broadcastCalendarEventTimeUpdate(item.id, newStartTime.toISOString(), newEndTime.toISOString())
                        } else {
                            await patchCalendarEvent(draggedEvent, nextUpdates)
                        }
                    },
                })
            }
            completeSyncFeedback()
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to update via drag-drop, rolling back:', err)
            if (item.type === 'task') {
                setLocalTasks(previousTasks)
            } else {
                // ロールバックもブロードキャスト
                const prev = previousEvents.find(e => e.id === item.id)
                if (prev) {
                    broadcastCalendarEventTimeUpdate(item.id, prev.start_time, prev.end_time)
                }
                setLocalCalendarEvents(previousEvents)
            }
            setSyncState('idle')
        }
    }, [localTasks, localCalendarEvents, calendarEvents, onUpdateTask, patchCalendarEvent, pushAction, completeSyncFeedback, startSyncFeedback])

    // Date header
    const dateFmt = format(today, 'M月d日(E)', { locale: ja })

    // Current time
    const [currentTime, setCurrentTime] = useState(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    useEffect(() => {
        setCurrentTime(new Date())
        const interval = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(interval)
    }, [])

    // Selected date habits
    const dateHabits = useMemo(() => getHabitsForDate(selectedDate), [getHabitsForDate, selectedDate])
    const selectedDateStr = useMemo(() => formatDateString(selectedDate), [selectedDate])
    const doneHabitCount = useMemo(() => {
        return dateHabits.filter(h => {
            if (isToday) return h.isCompletedToday
            return h.completions.some(c => c.completed_date === selectedDateStr)
        }).length
    }, [dateHabits, isToday, selectedDateStr])

    // Keep expanded habit across date changes
    useEffect(() => {
        if (!expandedHabitId) return
        const stillVisible = dateHabits.some(h => h.habit.id === expandedHabitId && h.childTasks.length > 0)
        if (!stillVisible) setExpandedHabitId(null)
    }, [dateHabits, expandedHabitId])

    // Week day labels
    const weekDayLabels = useMemo(() => {
        const labels: string[] = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today)
            d.setDate(d.getDate() - i)
            labels.push(format(d, 'EEEEE', { locale: ja }))
        }
        return labels
    }, [today])

    return {
        // Date management
        selectedDate,
        setSelectedDate,
        isToday,
        today,
        tomorrow,
        goToPrevDay,
        goToNextDay,
        goToToday,
        slideDirection,
        setSlideDirection,
        dateFmt,

        // Calendar panel
        calendarOpen,
        setCalendarOpen,
        calendarMonth,
        setCalendarMonth,
        handleDateSelect,

        // Timeline mode
        timelineMode,
        setTimelineMode,

        // Timeline data
        timelineItems,
        displayItems,
        displayAllDayEvents,
        allDayEvents,
        todayScheduledTasks,
        overflowTasks,
        unscheduledTasks,
        childTasksByParentId,
        visibleTasks,

        // Calendar
        calendars,
        calendarsLoading,
        calendarEvents,
        allFetchedEvents,
        eventsLoading,
        eventsError,
        calendarReauthUrl,
        syncNow,
        refreshCalendar,
        syncState,
        writableCalendars,
        stableCalendarColorMap,

        // Habits
        dateHabits,
        doneHabitCount,
        habitsLoading,
        habitsExpanded,
        setHabitsExpanded,
        expandedHabitId,
        setExpandedHabitId,
        toggleCompletion,
        toggleChildTask,
        isCompletedForDate,
        selectedDateStr,
        weekDayLabels,

        // Timer
        timer,

        // Edit modal
        editTarget,
        isEditModalOpen,
        handleItemTap,
        openTaskEditModal,
        handleCloseEditModal,

        // CRUD operations
        toggleTask,
        toggleEventCompletion,
        handleSaveTask,
        handleSaveEvent,
        handleDeleteTask,
        handleDeleteEvent,
        handleDragDrop,

        // Maps
        childTasksMap,
        projectNameMap,
        calendarColorMap,

        // Scroll position (for TodayTimelineCalendar)
        scrollPositionRef,

        // Current time
        currentTime,

        // Notification
        scheduleNotification,
        cancelNotifications,

        // Props passthrough
        onCreateSubTask: onCreateSubTaskProp,

        // Event → Task conversion
        handleConvertEventToTask,
        handleEventStartTimer,
        handleEventToggleExpand,
        handleConvertEventToMemo,
        handleConvertCalendarPayloadToMemo,
        pendingExpandTaskId,
        setPendingExpandTaskId,
    }
}
