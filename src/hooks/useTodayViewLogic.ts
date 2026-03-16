"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Task, HabitCompletion, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents, invalidateCalendarCache } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { useHabits, HabitWithDetails, formatDateString } from "@/hooks/useHabits"
import { useEventImport } from "@/hooks/useEventImport"
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync"
import { useTimer } from "@/contexts/TimerContext"
import { useNotificationScheduler } from "@/hooks/useNotificationScheduler"
import { DragItem } from "@/hooks/useTouchDrag"
import { taskToTimeBlock, eventToTimeBlock, type TimeBlock } from "@/lib/time-block"
import { type QuickTaskData } from "@/components/today/quick-task-fab"
import { type EditTarget } from "@/components/today/mobile-event-edit-modal"
import { isSameDay, format } from "date-fns"
import { ja } from "date-fns/locale"

// --- Types ---

export interface UseTodayViewLogicOptions {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
}

// --- Helper ---

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
    onCreateSubTask: onCreateSubTaskProp,
    onDeleteTask: onDeleteTaskProp,
}: UseTodayViewLogicOptions) {
    const { selectedCalendarIds, calendars, isLoading: calendarsLoading } = useCalendars()
    const { todayHabits, toggleCompletion, toggleChildTaskCompletion, updateChildTaskStatus, getHabitsForDate, isCompletedForDate, isLoading: habitsLoading } = useHabits()
    const { importEvents, isImporting } = useEventImport()
    const timer = useTimer()
    const { scheduleNotification, cancelNotifications } = useNotificationScheduler()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [timelineMode, setTimelineMode] = useState<'calendar' | 'cards'>('calendar')
    const [habitsExpanded, setHabitsExpanded] = useState(false)
    const [expandedHabitId, setExpandedHabitId] = useState<string | null>(null)
    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle')
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [pendingDeleteTaskIds, setPendingDeleteTaskIds] = useState<string[]>([])
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const scrollPositionRef = useRef<number | undefined>(undefined)
    const stableCalendarColorMapRef = useRef<Map<string, string>>(new Map())
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)
    const [prefetchedEventReminders, setPrefetchedEventReminders] = useState<Record<string, number[]>>({})
    const reminderPrefetchInFlightRef = useRef<Set<string>>(new Set())

    // Sync local tasks with prop changes
    useEffect(() => {
        setLocalTasks(allTasks.filter(task => !pendingDeleteTaskIds.includes(task.id)))
        setPendingDeleteTaskIds(prev => {
            const next = prev.filter(id => allTasks.some(task => task.id === id))
            if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
                return prev
            }
            return next
        })
    }, [allTasks, pendingDeleteTaskIds])

    // Selected date (ssr:false なのでクライアント直接初期化OK)
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })

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
        const currentIds = allFetchedEvents.map(e => e.google_event_id).sort().join(',')
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

    // Habit task IDs
    const habitGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of localTasks) {
            if (t.is_habit) ids.add(t.id)
        }
        return ids
    }, [localTasks])

    // Today's scheduled tasks
    const todayScheduledTasks = useMemo(() => {
        const filtered = localTasks.filter(t => {
            if (t.deleted_at) return false
            if (t.is_group) return false
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            return scheduled >= today && scheduled < tomorrow
        })
        const seenGoogleEventIds = new Set<string>()
        return filtered.filter(t => {
            if (!t.google_event_id) return true
            if (seenGoogleEventIds.has(t.google_event_id)) return false
            seenGoogleEventIds.add(t.google_event_id)
            return true
        })
    }, [localTasks, habitGroupIds, today, tomorrow])

    // Overflow tasks
    const overflowTasks = useMemo(() => {
        const filtered = localTasks.filter(t => {
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
        const seenGoogleEventIds = new Set<string>()
        return filtered.filter(t => {
            if (!t.google_event_id) return true
            if (seenGoogleEventIds.has(t.google_event_id)) return false
            seenGoogleEventIds.add(t.google_event_id)
            return true
        })
    }, [localTasks, habitGroupIds, previousDay, today])

    // Unscheduled tasks
    const unscheduledTasks = useMemo(() =>
        localTasks.filter(t =>
            !t.deleted_at &&
            !t.scheduled_at &&
            !t.project_id &&
            !t.parent_task_id &&
            !t.is_habit &&
            t.status !== 'done'
        ),
        [localTasks]
    )

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
        for (const task of localTasks) {
            if (task.parent_task_id && !task.is_habit) {
                const children = map.get(task.parent_task_id) || []
                children.push(task)
                map.set(task.parent_task_id, children)
            }
        }
        return map
    }, [localTasks])

    // Merge calendar events + scheduled tasks into timeline
    const allTasksWithGoogleEvent = useMemo(() =>
        [...todayScheduledTasks, ...overflowTasks].filter(t => t.google_event_id),
        [todayScheduledTasks, overflowTasks]
    )
    const scheduledTaskIds = useMemo(
        () => new Set([...todayScheduledTasks, ...overflowTasks].map(t => t.id)),
        [todayScheduledTasks, overflowTasks]
    )
    const taskGoogleIds = new Set(allTasksWithGoogleEvent.map(t => t.google_event_id!))
    const eventLikeTaskKeys = new Set(
        [...todayScheduledTasks, ...overflowTasks]
            .filter(t => t.source === 'google_event' && !!t.scheduled_at)
            .map(t => {
                const minute = Math.floor(new Date(t.scheduled_at!).getTime() / 60000)
                const title = t.title.trim().toLowerCase()
                return `${t.calendar_id || ''}|${title}|${minute}`
            })
    )

    const timelineItems: TimeBlock[] = useMemo(() => {
        const items: TimeBlock[] = []

        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            if (event.task_id && scheduledTaskIds.has(event.task_id)) continue
            if (taskGoogleIds.has(event.google_event_id)) continue
            const eventMinute = Math.floor(new Date(event.start_time).getTime() / 60000)
            const eventKey = `${event.calendar_id || ''}|${event.title.trim().toLowerCase()}|${eventMinute}`
            if (eventLikeTaskKeys.has(eventKey)) continue

            const calendarColor = stableCalendarColorMap.get(event.calendar_id || '')
            if (!calendarColor) continue
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
    }, [calendarEvents, scheduledTaskIds, stableCalendarColorMap, todayScheduledTasks, overflowTasks, today, tomorrow])

    // All-day events
    const allDayEvents = useMemo(() => {
        return calendarEvents
            .filter(e => e.is_all_day)
            .map(e => {
                const calendarColor = stableCalendarColorMap.get(e.calendar_id || '')
                return calendarColor
                    ? { ...e, background_color: calendarColor }
                    : null
            })
            .filter((e): e is NonNullable<typeof e> => e !== null) as CalendarEvent[]
    }, [calendarEvents, stableCalendarColorMap])

    const displayItems = timelineItems
    const displayAllDayEvents = allDayEvents

    // Toggle task completion
    const toggleTask = useCallback(async (taskId: string) => {
        const task = localTasks.find(t => t.id === taskId)
        if (!task) return
        const newStatus = task.status === 'done' ? 'todo' : 'done'
        setLocalTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: newStatus } : t
        ))
        await onUpdateTask(taskId, { status: newStatus })
    }, [localTasks, onUpdateTask])

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
        }
    }, [onUpdateTask, toggleChildTaskCompletion])

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

    // Background prefetch reminders for Google events
    useEffect(() => {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        const priorityMin = new Date(now)
        priorityMin.setDate(priorityMin.getDate() - 1)
        const priorityMax = new Date(now)
        priorityMax.setDate(priorityMax.getDate() + 2)

        const candidates = allFetchedEvents.filter(event => event.google_event_id && event.calendar_id)
        if (candidates.length === 0) return

        const sortedCandidates = [...candidates].sort((a, b) => {
            const aStart = new Date(a.start_time)
            const bStart = new Date(b.start_time)
            const aPriority = aStart >= priorityMin && aStart < priorityMax ? 0 : 1
            const bPriority = bStart >= priorityMin && bStart < priorityMax ? 0 : 1
            if (aPriority !== bPriority) return aPriority - bPriority
            return aStart.getTime() - bStart.getTime()
        })

        sortedCandidates.forEach((event) => {
            const key = reminderKeyForEvent(event)
            if (event.reminders !== undefined || prefetchedEventReminders[key]) return
            if (reminderPrefetchInFlightRef.current.has(key)) return

            reminderPrefetchInFlightRef.current.add(key)
            fetch(`/api/calendar/events/${event.id}?googleEventId=${encodeURIComponent(event.google_event_id)}&calendarId=${encodeURIComponent(event.calendar_id)}`)
                .then(async (res) => {
                    if (!res.ok) return null
                    const data = await res.json()
                    return Array.isArray(data.reminders) ? data.reminders as number[] : null
                })
                .then((reminders) => {
                    if (!reminders) return
                    setPrefetchedEventReminders(prev => {
                        if (prev[key]) return prev
                        return { ...prev, [key]: reminders }
                    })
                    setLocalCalendarEvents(prev => prev.map(e =>
                        e.google_event_id === event.google_event_id && e.calendar_id === event.calendar_id
                            ? { ...e, reminders }
                            : e
                    ))
                })
                .catch((err) => {
                    console.warn('[useTodayViewLogic] Failed to prefetch reminders:', err)
                    setPrefetchedEventReminders(prev => {
                        if (prev[key] !== undefined) return prev
                        return { ...prev, [key]: [] }
                    })
                })
                .finally(() => {
                    reminderPrefetchInFlightRef.current.delete(key)
                })
        })
    }, [allFetchedEvents, prefetchedEventReminders, reminderKeyForEvent])

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
        const previousTasks = localTasks
        setLocalTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, ...taskUpdates } : t
        ))
        try {
            await onUpdateTask(taskId, taskUpdates)
        } catch (err) {
            setLocalTasks(previousTasks)
            throw err
        }

        if (reminders !== undefined) {
            const task = localTasks.find(t => t.id === taskId)
            if (task?.google_event_id && task?.calendar_id) {
                fetch('/api/calendar/sync-task', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId,
                        scheduled_at: updates.scheduled_at || task.scheduled_at,
                        estimated_time: updates.estimated_time || task.estimated_time,
                        calendar_id: updates.calendar_id || task.calendar_id,
                        reminders,
                    }),
                }).catch(err => {
                    console.error('[useTodayViewLogic] Failed to update calendar reminder:', err)
                })
            }
        }
    }, [onUpdateTask, localTasks])

    // Save event
    const handleSaveEvent = useCallback(async (eventId: string, updates: {
        title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string; reminders?: number[]
    }) => {
        const previousEvents = localCalendarEvents
        const previousTasks = localTasks
        const durationMinutes = Math.max(
            1,
            Math.round((new Date(updates.end_time).getTime() - new Date(updates.start_time).getTime()) / 60000)
        )

        setLocalCalendarEvents(prev => prev.map(e =>
            e.id === eventId
                ? { ...e, title: updates.title, start_time: updates.start_time, end_time: updates.end_time, reminders: updates.reminders }
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

        if (!updates.googleEventId) {
            return
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
                    reminders: updates.reminders,
                }),
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to update event')
            }
            invalidateCalendarCache()
            await syncNow({ silent: true })
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to update event, rolling back:', err)
            setLocalCalendarEvents(previousEvents)
            setLocalTasks(previousTasks)
            throw err
        }
    }, [localCalendarEvents, localTasks, syncNow])

    // Delete task
    const handleDeleteTask = useCallback(async (taskId: string) => {
        const taskToDelete = localTasks.find(t => t.id === taskId)
        const previousTasks = localTasks
        const previousEvents = localCalendarEvents

        setPendingDeleteTaskIds(prev => prev.includes(taskId) ? prev : [...prev, taskId])

        setLocalTasks(prev => prev.filter(t => t.id !== taskId))

        if (taskToDelete?.google_event_id) {
            setLocalCalendarEvents(prev => prev.filter(e => e.google_event_id !== taskToDelete.google_event_id))
        }

        try {
            if (onDeleteTaskProp) {
                await onDeleteTaskProp(taskId)
            } else {
                const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                if (!res.ok) throw new Error('Failed to delete task')
            }

            invalidateCalendarCache()
            await syncNow({ silent: true })
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to delete task:', err)
            setLocalTasks(previousTasks)
            setLocalCalendarEvents(previousEvents)
            setPendingDeleteTaskIds(prev => prev.filter(id => id !== taskId))
        }
    }, [onDeleteTaskProp, syncNow, localTasks, localCalendarEvents])

    // Delete event
    const handleDeleteEvent = useCallback((eventId: string, googleEventId: string, calendarId: string) => {
        const previousEvents = localCalendarEvents
        const previousTasks = localTasks

        removeOptimisticEvent(eventId, googleEventId)
        setLocalCalendarEvents(prev => prev.filter(e => e.google_event_id !== googleEventId && e.id !== eventId))
        setLocalTasks(prev => prev.filter(t => !(t.google_event_id === googleEventId && t.source === 'google_event')))

        fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(googleEventId)}&calendarId=${encodeURIComponent(calendarId)}`, {
            method: 'DELETE',
        })
            .then(async (res) => {
                if (!res.ok) {
                    const data = await res.json().catch(() => null)
                    throw new Error(data?.error?.message || 'Failed to delete event')
                }
                invalidateCalendarCache()
                await syncNow({ silent: true })
            })
            .catch(err => {
                console.error('[useTodayViewLogic] Failed to delete event:', err)
                setLocalCalendarEvents(previousEvents)
                setLocalTasks(previousTasks)
                syncNow({ silent: true })
            })
    }, [removeOptimisticEvent, syncNow, localCalendarEvents, localTasks])

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

        if (item.type === 'task') {
            setLocalTasks(prev => prev.map(t =>
                t.id === item.id ? { ...t, scheduled_at: newStartTime.toISOString() } : t
            ))
        } else {
            setLocalCalendarEvents(prev => prev.map(e =>
                e.id === item.id ? { ...e, start_time: newStartTime.toISOString(), end_time: newEndTime.toISOString() } : e
            ))
        }

        setSyncState('syncing')

        try {
            if (item.type === 'task') {
                await onUpdateTask(item.id, { scheduled_at: newStartTime.toISOString() })
            } else {
                const event = calendarEvents.find(e => e.id === item.id)
                if (!event) return
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
                await syncNow({ silent: true })
            }
            setSyncState('done')
            setTimeout(() => setSyncState('idle'), 1500)
        } catch (err) {
            console.error('[useTodayViewLogic] Failed to update via drag-drop, rolling back:', err)
            if (item.type === 'task') {
                setLocalTasks(previousTasks)
            } else {
                setLocalCalendarEvents(previousEvents)
            }
            setSyncState('idle')
        }
    }, [localTasks, localCalendarEvents, calendarEvents, onUpdateTask, syncNow])

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

        // Calendar
        calendars,
        calendarsLoading,
        calendarEvents,
        allFetchedEvents,
        eventsLoading,
        eventsError,
        calendarReauthUrl,
        syncNow,
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
    }
}
