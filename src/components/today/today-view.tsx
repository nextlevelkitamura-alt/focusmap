"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Task, HabitCompletion, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { useHabits, HabitWithDetails } from "@/hooks/useHabits"
import { useEventImport } from "@/hooks/useEventImport"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    LayoutGrid, List, Flame, Play, Pause, RefreshCw, Check, CalendarDays
} from "lucide-react"
import { isSameDay, format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TodayTimelineCards } from "./today-timeline-cards"
import { TodayTimelineCalendar } from "./today-timeline-calendar"
import { MobileEventEditModal, EditTarget } from "./mobile-event-edit-modal"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { DragItem } from "@/hooks/useTouchDrag"
import { useMultiTaskCalendarSync } from "@/hooks/useMultiTaskCalendarSync"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { QuickTaskFab, type QuickTaskData } from "./quick-task-fab"
import { taskToTimeBlock, eventToTimeBlock, type TimeBlock } from "@/lib/time-block"

// --- Types ---

type TimelineMode = 'calendar' | 'cards'

interface TodayViewProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
}

// --- Helper: compute week dots from completions ---

function getWeekDots(completions: HabitCompletion[], today: Date): boolean[] {
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

// --- Main Component ---

export function TodayView({ allTasks, onUpdateTask, projects = [], onCreateQuickTask, onCreateSubTask: onCreateSubTaskProp, onDeleteTask: onDeleteTaskProp }: TodayViewProps) {
    const { selectedCalendarIds, calendars, isLoading: calendarsLoading } = useCalendars()
    const { todayHabits, toggleCompletion, updateChildTaskStatus, isLoading: habitsLoading } = useHabits()
    const { importEvents, isImporting } = useEventImport()
    const timer = useTimer()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [timelineMode, setTimelineMode] = useState<TimelineMode>('calendar')
    const [habitsExpanded, setHabitsExpanded] = useState(false)
    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle')
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const timelineContainerRef = useRef<HTMLDivElement>(null)
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)

    // Sync local tasks with prop changes (render-time sync for instant updates)
    const [prevAllTasks, setPrevAllTasks] = useState(allTasks)
    if (allTasks !== prevAllTasks) {
        setPrevAllTasks(allTasks)
        setLocalTasks(allTasks)
    }

    // Selected date (ssr:false なのでクライアント直接初期化OK)
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })

    // 1ヶ月間フェッチウィンドウ（-7日〜+30日）- カレンダーイベント自動取り込み用
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

    // Swipe left/right to change date
    useSwipeNavigation({
        containerRef: timelineContainerRef,
        onSwipeLeft: goToNextDay,
        onSwipeRight: goToPrevDay,
    })

    // Fetch calendar events (1ヶ月分を一括取得、日付切り替え時はクライアントフィルタで即座表示)
    const { events: allFetchedEvents, isLoading: eventsLoading, error: eventsError, syncNow } = useCalendarEvents({
        timeMin: fetchWindow.min,
        timeMax: fetchWindow.max,
        calendarIds: selectedCalendarIds,
    })

    // 7日分のイベントから selectedDate のイベントだけ抽出
    const fetchedCalendarEvents = useMemo(() => {
        return allFetchedEvents.filter(e => {
            const start = new Date(e.start_time)
            const end = new Date(e.end_time)
            // イベントが selectedDate 〜 tomorrow と重なるか判定
            return end.getTime() > today.getTime() && start.getTime() < tomorrow.getTime()
        })
    }, [allFetchedEvents, today, tomorrow])

    const [localCalendarEvents, setLocalCalendarEvents] = useState<CalendarEvent[]>(fetchedCalendarEvents)
    useEffect(() => { setLocalCalendarEvents(fetchedCalendarEvents) }, [fetchedCalendarEvents])

    // イベント自動取り込み: カレンダーイベントをタスクとしてDBに保存（バックグラウンド）
    // 取り込み完了後、次回ロード時にタスクとして allTasks に含まれ dedup でイベント表示が置換される
    const importDoneRef = useRef(false)
    useEffect(() => {
        if (eventsLoading || allFetchedEvents.length === 0 || importDoneRef.current || isImporting) return
        importDoneRef.current = true
        importEvents(allFetchedEvents).catch(() => {}) // 次回起動時にリトライ
    }, [eventsLoading, allFetchedEvents, importEvents, isImporting])

    // カレンダー同期（今日のビューのタスク全体）
    useMultiTaskCalendarSync({
        tasks: localTasks,
        onRefreshCalendar: syncNow,
        onUpdateTask,
    })

    // Use localCalendarEvents for rendering (supports optimistic D&D updates)
    const calendarEvents = localCalendarEvents

    // Habit task IDs (filter out from timeline)
    const habitGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of localTasks) {
            if (t.is_habit) ids.add(t.id)
        }
        return ids
    }, [localTasks])

    // Today's scheduled tasks (excluding habits and groups)
    // NOTE: project_id を持つタスクも scheduled_at が今日なら表示する（MindMap→Today の橋渡し）
    const todayScheduledTasks = useMemo(() => {
        return localTasks.filter(t => {
            if (t.is_group) return false
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            return scheduled >= today && scheduled < tomorrow
        })
    }, [localTasks, habitGroupIds, today, tomorrow])

    // Previous day's tasks that overflow into current day (繰り越しタスク)
    const overflowTasks = useMemo(() => {
        return localTasks.filter(t => {
            if (t.is_group) return false
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            // Only tasks from previous day
            if (!(scheduled >= previousDay && scheduled < today)) return false
            // Check if task extends past midnight into today
            const estimatedMin = t.estimated_time || 30
            const endTime = new Date(scheduled.getTime() + estimatedMin * 60 * 1000)
            return endTime > today
        })
    }, [localTasks, habitGroupIds, previousDay, today])

    // Unscheduled tasks (no scheduled_at, no project_id, not habit children, not done)
    const unscheduledTasks = useMemo(() =>
        localTasks.filter(t =>
            !t.scheduled_at &&
            !t.project_id &&
            !t.parent_task_id &&
            !t.is_habit &&
            t.status !== 'done'
        ),
        [localTasks]
    )

    // Project name map (for displaying project badge on task blocks)
    const projectNameMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const p of projects) {
            map.set(p.id, p.title)
        }
        return map
    }, [projects])

    // Calendar color map (for imported event tasks)
    const calendarColorMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const cal of calendars) {
            if (cal.background_color) {
                map.set(cal.google_calendar_id, cal.background_color)
            }
        }
        return map
    }, [calendars])

    // Child tasks grouped by parent (for subtask display)
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
    // When a task has a matching google_event_id, prefer showing it as a task (green, with timer)
    // Collect google_event_ids from ALL tasks (today + overflow) to skip matching calendar events
    const allTasksWithGoogleEvent = useMemo(() =>
        [...todayScheduledTasks, ...overflowTasks].filter(t => t.google_event_id),
        [todayScheduledTasks, overflowTasks]
    )
    const taskGoogleIds = new Set(allTasksWithGoogleEvent.map(t => t.google_event_id!))

    const timelineItems: TimeBlock[] = useMemo(() => {
        const items: TimeBlock[] = []

        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            // Skip calendar events that have a matching task (task takes priority)
            if (taskGoogleIds.has(event.google_event_id)) continue

            const block = eventToTimeBlock(event)
            // 前日からの繰り越し: startTimeを0:00にクランプ
            if (block.startTime.getTime() < today.getTime()) block.startTime = new Date(today)
            // 日付をまたぐ場合: endTimeを24:00にクランプ
            if (block.endTime.getTime() > tomorrow.getTime()) block.endTime = new Date(tomorrow)

            items.push(block)
        }

        for (const task of todayScheduledTasks) {
            if (!task.scheduled_at) continue
            // Imported events: use calendar color, manual tasks: use default
            const color = task.google_event_id && !task.project_id
                ? calendarColorMap.get(task.calendar_id || '') : undefined
            const block = taskToTimeBlock(task, color)
            // 日付をまたぐ場合: endTimeを24:00にクランプ
            if (block.endTime > tomorrow) block.endTime = new Date(tomorrow)
            items.push(block)
        }

        // 前日からの繰り越しタスク（0:00から残り時間分を表示）
        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
        for (const task of overflowTasks) {
            const color = task.google_event_id && !task.project_id
                ? calendarColorMap.get(task.calendar_id || '') : undefined
            const block = taskToTimeBlock(task, color)
            block.startTime = new Date(today)
            // originalEndが翌日24:00を超える場合、翌日24:00でクランプ
            if (block.endTime.getTime() > dayAfterTomorrow.getTime()) {
                block.endTime = new Date(dayAfterTomorrow)
            }
            items.push(block)
        }

        items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
        return items
    }, [calendarEvents, todayScheduledTasks, overflowTasks, today, tomorrow])

    // All-day events
    const allDayEvents = useMemo(() =>
        calendarEvents.filter(e => e.is_all_day),
        [calendarEvents]
    )

    // Gate timeline display: show items only after calendar events finish loading
    // This prevents the "two-stage render" where tasks appear first, then events pop in
    const displayItems = eventsLoading ? [] : timelineItems
    const displayAllDayEvents = eventsLoading ? [] : allDayEvents

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

    // Toggle child task status + optimistic UI + auto-complete parent habit
    const toggleChildTask = useCallback(async (
        taskId: string,
        currentStatus: string,
        habitItem?: HabitWithDetails
    ) => {
        const newStatus = currentStatus === 'done' ? 'todo' : 'done'

        // Optimistic update in useHabits state (so UI reflects immediately)
        if (habitItem) {
            updateChildTaskStatus(habitItem.habit.id, taskId, newStatus)
        }

        // DB update
        await onUpdateTask(taskId, { status: newStatus })

        // Auto-complete/uncomplete parent habit
        if (habitItem && habitItem.childTasks.length > 0) {
            const allDone = habitItem.childTasks.every(c =>
                c.id === taskId ? newStatus === 'done' : c.status === 'done'
            )
            if (allDone && !habitItem.isCompletedToday) {
                await toggleCompletion(habitItem.habit.id)
            } else if (!allDone && habitItem.isCompletedToday) {
                await toggleCompletion(habitItem.habit.id)
            }
        }
    }, [onUpdateTask, toggleCompletion, updateChildTaskStatus])

    // Handle item tap (open edit modal)
    const handleItemTap = useCallback((item: TimeBlock) => {
        setEditTarget(item)
        setIsEditModalOpen(true)
    }, [])

    const handleCloseEditModal = useCallback(() => {
        setIsEditModalOpen(false)
        setEditTarget(null)
    }, [])

    // Save task via existing onUpdateTask (with optimistic update for calendar sync)
    const handleSaveTask = useCallback(async (taskId: string, updates: {
        title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string; memo?: string | null
    }) => {
        // Optimistic update so useMultiTaskCalendarSync picks up changes immediately
        setLocalTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, ...updates } : t
        ))
        await onUpdateTask(taskId, updates)
    }, [onUpdateTask])

    // Save event via PATCH /api/calendar/events/[eventId]
    const handleSaveEvent = useCallback(async (eventId: string, updates: {
        title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string
    }) => {
        const res = await fetch(`/api/calendar/events/${eventId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: updates.title,
                start_time: updates.start_time,
                end_time: updates.end_time,
                googleEventId: updates.googleEventId,
                calendarId: updates.calendarId,
            }),
        })
        if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error?.message || 'Failed to update event')
        }
    }, [])

    // Delete task — dashboard-client 経由で quickTasks/taskOverrides も同期
    const handleDeleteTask = useCallback((taskId: string) => {
        // ローカル即時反映
        setLocalTasks(prev => prev.filter(t => t.id !== taskId))
        // 親コンポーネント経由でDB削除 + state同期
        if (onDeleteTaskProp) {
            onDeleteTaskProp(taskId)
        } else {
            // フォールバック: 直接API呼び出し
            fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }).catch(err => {
                console.error('[TodayView] Failed to delete task:', err)
            })
        }
    }, [onDeleteTaskProp])

    // Delete event (optimistic UI + background API)
    const handleDeleteEvent = useCallback((eventId: string, googleEventId: string, calendarId: string) => {
        setLocalCalendarEvents(prev => prev.filter(e => e.id !== eventId))
        fetch(`/api/calendar/events/${eventId}?googleEventId=${encodeURIComponent(googleEventId)}&calendarId=${encodeURIComponent(calendarId)}`, {
            method: 'DELETE',
        }).catch(err => {
            console.error('[TodayView] Failed to delete event:', err)
        })
    }, [])

    // Writable calendars for the edit modal
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

    // Handle drag & drop time change (optimistic UI + sync indicator)
    const handleDragDrop = useCallback(async (item: DragItem, newStartTime: Date, newEndTime: Date) => {
        // Optimistic UI update FIRST
        if (item.type === 'task') {
            setLocalTasks(prev => prev.map(t =>
                t.id === item.id ? { ...t, scheduled_at: newStartTime.toISOString() } : t
            ))
        } else {
            setLocalCalendarEvents(prev => prev.map(e =>
                e.id === item.id ? { ...e, start_time: newStartTime.toISOString(), end_time: newEndTime.toISOString() } : e
            ))
        }

        // Show sync indicator
        setSyncState('syncing')

        try {
            if (item.type === 'task') {
                await onUpdateTask(item.id, { scheduled_at: newStartTime.toISOString() })
            } else {
                const event = calendarEvents.find(e => e.id === item.id)
                if (!event) return
                await fetch(`/api/calendar/events/${item.id}`, {
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
            }
            setSyncState('done')
            setTimeout(() => setSyncState('idle'), 1500)
        } catch {
            setSyncState('idle')
        }
    }, [onUpdateTask, calendarEvents])

    // Date header
    const dateFmt = format(today, 'M月d日(E)', { locale: ja })
    const dateStr = isToday ? `今日 · ${dateFmt}` : dateFmt

    // Current time (SSR-safe: midnight初期値 → マウント後に実時刻に更新)
    const [currentTime, setCurrentTime] = useState(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    useEffect(() => {
        setCurrentTime(new Date())
        const interval = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(interval)
    }, [])

    const doneHabitCount = todayHabits.filter(h => h.isCompletedToday).length

    // Week day labels for expanded habits
    const weekDayLabels = useMemo(() => {
        const labels: string[] = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today)
            d.setDate(d.getDate() - i)
            labels.push(format(d, 'EEEEE', { locale: ja }))
        }
        return labels
    }, [today])

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
            {/* Date Header + Mode Toggle */}
            <div className="flex-shrink-0 px-4 py-3 border-b" style={{ touchAction: 'none' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={goToPrevDay}
                            className="p-1.5 rounded-full active:bg-muted transition-colors text-muted-foreground"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold">{dateStr}</h1>
                                <button
                                    onClick={() => setCalendarOpen(prev => !prev)}
                                    className={cn(
                                        "p-1 rounded-md transition-colors",
                                        calendarOpen
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <CalendarDays className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {displayItems.length}件のスケジュール
                                {isToday && todayHabits.length > 0 && ` · ${doneHabitCount}/${todayHabits.length} 習慣完了`}
                            </p>
                        </div>
                        <button
                            onClick={goToNextDay}
                            className="p-1.5 rounded-full active:bg-muted transition-colors text-muted-foreground"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                    {/* Sync indicator + Timeline mode toggle */}
                    <div className="flex items-center gap-2">
                    {syncState !== 'idle' && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {syncState === 'syncing' ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                            ) : (
                                <Check className="w-3.5 h-3.5 text-green-500" />
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                        <button
                            onClick={() => setTimelineMode('calendar')}
                            className={cn(
                                "p-1.5 rounded-md transition-colors",
                                timelineMode === 'calendar'
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground"
                            )}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setTimelineMode('cards')}
                            className={cn(
                                "p-1.5 rounded-md transition-colors",
                                timelineMode === 'cards'
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground"
                            )}
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>
                    </div>
                </div>
            </div>

            {/* Collapsible Calendar Panel */}
            {calendarOpen && (
                <div className="flex-shrink-0 border-b px-4 py-3 animate-in slide-in-from-top-2 duration-200">
                    <SimpleCalendar
                        selected={selectedDate}
                        onSelect={handleDateSelect}
                        month={calendarMonth}
                        onMonthChange={setCalendarMonth}
                        className="w-full"
                    />
                </div>
            )}

            {/* Habit Bar (fixed) + Expandable Detail — only when viewing today */}
            {isToday && !habitsLoading && todayHabits.length > 0 && (
                <div className="flex-shrink-0 border-b">
                    {/* Compact Habit Bar */}
                    <div className="px-4 py-2">
                        <div className="flex items-center gap-2 mb-1.5">
                            <Target className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <span className="text-xs font-medium text-muted-foreground flex-1">今日の習慣</span>
                            <button
                                onClick={() => setHabitsExpanded(prev => !prev)}
                                className="p-1 rounded-md hover:bg-muted/50 transition-colors"
                            >
                                {habitsExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                                ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                )}
                            </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                            {todayHabits.map(item => {
                                const hasChildren = item.childTasks.length > 0
                                return (
                                    <button
                                        key={item.habit.id}
                                        onClick={() => {
                                            if (!hasChildren) toggleCompletion(item.habit.id)
                                        }}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all flex-shrink-0 border",
                                            !hasChildren && "active:scale-[0.98]",
                                            item.isCompletedToday
                                                ? "bg-primary/10 border-primary/30 dark:bg-primary/15"
                                                : !hasChildren
                                                    ? "border-border hover:bg-muted/40 active:bg-muted/60"
                                                    : "border-border"
                                        )}
                                    >
                                        {item.isCompletedToday ? (
                                            <CheckSquare className={cn("w-3.5 h-3.5 flex-shrink-0", hasChildren ? "text-primary/50" : "text-primary")} />
                                        ) : (
                                            <Square className={cn("w-3.5 h-3.5 flex-shrink-0", hasChildren ? "text-muted-foreground/20" : "text-muted-foreground/40")} />
                                        )}
                                        <span className="text-sm flex-shrink-0">{item.habit.habit_icon || '🔄'}</span>
                                        <span className={cn(
                                            "text-xs whitespace-nowrap",
                                            item.isCompletedToday
                                                ? "text-primary font-medium line-through"
                                                : "text-foreground"
                                        )}>
                                            {item.habit.title}
                                        </span>
                                        {hasChildren && (
                                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                                {item.childTasks.filter(c => c.status === 'done').length}/{item.childTasks.length}
                                            </span>
                                        )}
                                        {item.streak > 0 && (
                                            <span className="flex items-center gap-0.5 text-[10px] text-orange-500 font-medium flex-shrink-0">
                                                <Flame className="w-3 h-3" />
                                                {item.streak}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Expanded: Child tasks only (compact) */}
                    {habitsExpanded && (
                        <div className="px-4 pb-2 space-y-0.5 animate-in slide-in-from-top-2 duration-200">
                            {todayHabits.map(item => (
                                item.childTasks.length > 0 && (
                                    <div key={item.habit.id} className="space-y-0">
                                        {item.childTasks.map(child => {
                                            const isRunning = timer.runningTaskId === child.id
                                            const isDone = child.status === 'done'
                                            const hasElapsed = (child.total_elapsed_seconds ?? 0) > 0
                                            return (
                                                <div
                                                    key={child.id}
                                                    className={cn(
                                                        "flex items-center gap-1.5 rounded-md transition-colors",
                                                        isRunning && "bg-primary/10"
                                                    )}
                                                >
                                                    {/* Tappable area: checkbox + title */}
                                                    <button
                                                        className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 px-2 rounded-md active:bg-muted/50 transition-colors"
                                                        onClick={() => toggleChildTask(child.id, child.status || 'todo', item)}
                                                    >
                                                        {isDone ? (
                                                            <CheckSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                                                        ) : (
                                                            <Square className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                                                        )}
                                                        <span className={cn(
                                                            "text-xs flex-1 truncate text-left",
                                                            isDone ? "line-through text-muted-foreground" : "text-foreground"
                                                        )}>
                                                            {child.title}
                                                        </span>
                                                    </button>
                                                    {/* Timer display: show elapsed even when stopped */}
                                                    {isRunning ? (
                                                        <span className="text-[10px] font-mono text-primary flex-shrink-0">
                                                            {formatTime(timer.currentElapsedSeconds)}
                                                        </span>
                                                    ) : hasElapsed ? (
                                                        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                                                            {formatTime(child.total_elapsed_seconds ?? 0)}
                                                        </span>
                                                    ) : null}
                                                    <button
                                                        className={cn(
                                                            "p-1.5 rounded-full flex-shrink-0",
                                                            isRunning ? "text-primary bg-primary/10" : "text-muted-foreground/50 active:bg-muted/50"
                                                        )}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            isRunning ? timer.pauseTimer() : timer.startTimer(child)
                                                        }}
                                                    >
                                                        {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Timeline Content (swipeable) */}
            <div ref={timelineContainerRef} className="flex-1 overflow-hidden flex flex-col">
              <div
                key={selectedDate.getTime()}
                className={cn(
                    "flex-1 flex flex-col overflow-hidden",
                    slideDirection === 'left' && "animate-in slide-in-from-right-12 duration-250",
                    slideDirection === 'right' && "animate-in slide-in-from-left-12 duration-250"
                )}
                onAnimationEnd={() => setSlideDirection(null)}
              >
                {/* Calendar Connection Required */}
                {!eventsLoading && !calendarsLoading && calendars.length === 0 && (
                    <div className="mx-4 mt-3 py-4 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                        <div className="flex items-start gap-2">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                    カレンダーに接続されていません
                                </p>
                                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                                    Googleカレンダーと連携すると、予定を自動で表示できます
                                </p>
                            </div>
                        </div>
                        <div className="mt-3">
                            <button
                                onClick={() => window.location.href = '/api/calendar/connect'}
                                className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                                カレンダーを接続
                            </button>
                        </div>
                    </div>
                )}

                {/* Calendar Events Error */}
                {eventsError && calendars.length > 0 && (
                    <div className="mx-4 mt-3 py-4 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-start gap-2">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                    カレンダーデータの取得に失敗しました
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                    {eventsError.message}
                                </p>
                            </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                            >
                                再読み込み
                            </button>
                            <button
                                onClick={() => window.location.href = '/api/calendar/connect'}
                                className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                            >
                                再接続
                            </button>
                        </div>
                    </div>
                )}

                {timelineMode === 'calendar' ? (
                    <TodayTimelineCalendar
                        timelineItems={displayItems}
                        allDayEvents={displayAllDayEvents}
                        eventsLoading={eventsLoading}
                        currentTime={currentTime}
                        onToggleTask={toggleTask}
                        onItemTap={handleItemTap}
                        onDragDrop={handleDragDrop}
                        childTasksMap={childTasksMap}
                        onCreateSubTask={onCreateSubTaskProp}
                        onDeleteSubTask={handleDeleteTask}
                        projectNameMap={projectNameMap}
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <TodayTimelineCards
                            timelineItems={displayItems}
                            allDayEvents={displayAllDayEvents}
                            eventsLoading={eventsLoading}
                            currentTime={currentTime}
                            onToggleTask={toggleTask}
                            onItemTap={handleItemTap}
                            projectNameMap={projectNameMap}
                        />
                        <div className="h-4" />
                    </div>
                )}
              </div>
            </div>

            {/* Unscheduled Tasks */}
            {unscheduledTasks.length > 0 && (
                <div className="flex-shrink-0 border-t px-4 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">未スケジュール</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {unscheduledTasks.map(task => (
                            <div key={task.id} className="flex items-center gap-2 py-1.5 px-1 rounded-md active:bg-muted/50 transition-colors">
                                <button
                                    className="flex-shrink-0"
                                    onClick={() => toggleTask(task.id)}
                                >
                                    <Square className="w-4 h-4 text-muted-foreground/40" />
                                </button>
                                <span className="text-sm truncate flex-1">{task.title}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            <MobileEventEditModal
                target={editTarget}
                isOpen={isEditModalOpen}
                onClose={handleCloseEditModal}
                onSaveTask={handleSaveTask}
                onSaveEvent={handleSaveEvent}
                onDeleteTask={handleDeleteTask}
                onDeleteEvent={handleDeleteEvent}
                availableCalendars={writableCalendars}
            />

            {/* Quick Task FAB */}
            {onCreateQuickTask && (
                <QuickTaskFab
                    projects={projects}
                    calendars={writableCalendars}
                    onCreateTask={onCreateQuickTask}
                />
            )}
        </div>
    )
}
