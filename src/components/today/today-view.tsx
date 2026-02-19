"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Task, HabitCompletion, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { useHabits, HabitWithDetails } from "@/hooks/useHabits"
import { useEventCompletions } from "@/hooks/useEventCompletions"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    LayoutGrid, List, Flame, Play, Pause, RefreshCw, Check, CalendarDays
} from "lucide-react"
import { isSameDay } from "date-fns"
import { cn } from "@/lib/utils"
import { TodayTimelineCards } from "./today-timeline-cards"
import { TodayTimelineCalendar } from "./today-timeline-calendar"
import { MobileEventEditModal, EditTarget } from "./mobile-event-edit-modal"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { DragItem } from "@/hooks/useTouchDrag"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { QuickTaskFab, type QuickTaskData } from "./quick-task-fab"

// --- Types ---

type TimelineItem =
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }

type TimelineMode = 'calendar' | 'cards'

interface TodayViewProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
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

export function TodayView({ allTasks, onUpdateTask, projects = [], onCreateQuickTask }: TodayViewProps) {
    const { selectedCalendarIds, calendars } = useCalendars()
    const { todayHabits, toggleCompletion, updateChildTaskStatus, isLoading: habitsLoading } = useHabits()
    const { completedEventIds, toggleEventCompletion } = useEventCompletions()
    const timer = useTimer()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [timelineMode, setTimelineMode] = useState<TimelineMode>('calendar')
    const [habitsExpanded, setHabitsExpanded] = useState(false)
    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle')
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date())
    const timelineContainerRef = useRef<HTMLDivElement>(null)
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)

    // Sync local tasks with prop changes (render-time sync for instant updates)
    const [prevAllTasks, setPrevAllTasks] = useState(allTasks)
    if (allTasks !== prevAllTasks) {
        setPrevAllTasks(allTasks)
        setLocalTasks(allTasks)
    }

    // Selected date (defaults to today)
    const [selectedDate, setSelectedDate] = useState(() => {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        return d
    })

    const today = selectedDate

    const isToday = useMemo(() => {
        const now = new Date()
        now.setHours(0, 0, 0, 0)
        return today.getTime() === now.getTime()
    }, [today])

    const tomorrow = useMemo(() => {
        const d = new Date(selectedDate)
        d.setDate(d.getDate() + 1)
        return d
    }, [selectedDate])

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

    // Fetch calendar events for today
    const { events: fetchedCalendarEvents, isLoading: eventsLoading, error: eventsError } = useCalendarEvents({
        timeMin: today,
        timeMax: tomorrow,
        calendarIds: selectedCalendarIds,
    })
    const [localCalendarEvents, setLocalCalendarEvents] = useState<CalendarEvent[]>(fetchedCalendarEvents)
    useEffect(() => { setLocalCalendarEvents(fetchedCalendarEvents) }, [fetchedCalendarEvents])
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

    // Today's scheduled tasks (excluding habits)
    const todayScheduledTasks = useMemo(() => {
        return localTasks.filter(t => {
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            const scheduled = new Date(t.scheduled_at)
            return scheduled >= today && scheduled < tomorrow
        })
    }, [localTasks, habitGroupIds, today, tomorrow])

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


    // Merge calendar events + scheduled tasks into timeline
    // When a task has a matching google_event_id, prefer showing it as a task (green, with timer)
    const timelineItems = useMemo(() => {
        const items: TimelineItem[] = []

        // Collect google_event_ids from tasks to skip matching calendar events
        const taskGoogleIds = new Set(
            todayScheduledTasks
                .filter(t => t.google_event_id)
                .map(t => t.google_event_id!)
        )

        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            // Skip calendar events that have a matching task (task takes priority)
            if (taskGoogleIds.has(event.google_event_id)) continue
            items.push({
                type: 'event',
                data: event,
                startTime: new Date(event.start_time),
                endTime: new Date(event.end_time),
            })
        }

        for (const task of todayScheduledTasks) {
            if (!task.scheduled_at) continue
            const start = new Date(task.scheduled_at)
            const end = new Date(start.getTime() + (task.estimated_time || 30) * 60 * 1000)
            items.push({ type: 'task', data: task, startTime: start, endTime: end })
        }

        items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
        return items
    }, [calendarEvents, todayScheduledTasks])

    // All-day events
    const allDayEvents = useMemo(() =>
        calendarEvents.filter(e => e.is_all_day),
        [calendarEvents]
    )

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
    const handleItemTap = useCallback((item: EditTarget) => {
        setEditTarget(item)
        setIsEditModalOpen(true)
    }, [])

    const handleCloseEditModal = useCallback(() => {
        setIsEditModalOpen(false)
        setEditTarget(null)
    }, [])

    // Save task via existing onUpdateTask
    const handleSaveTask = useCallback(async (taskId: string, updates: {
        title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string
    }) => {
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

    // Delete task (optimistic UI + background API)
    const handleDeleteTask = useCallback((taskId: string) => {
        setLocalTasks(prev => prev.filter(t => t.id !== taskId))
        fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }).catch(err => {
            console.error('[TodayView] Failed to delete task:', err)
        })
    }, [])

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
    const dateStr = isToday
        ? `今日 · ${today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}`
        : today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })

    // Current time
    const [currentTime, setCurrentTime] = useState(new Date())
    useEffect(() => {
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
            labels.push(d.toLocaleDateString('ja-JP', { weekday: 'narrow' }))
        }
        return labels
    }, [today])

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Date Header + Mode Toggle */}
            <div className="flex-shrink-0 px-4 py-3 border-b">
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
                                    <CalendarDays className="w-4 h-4" />
                                </button>
                                {!isToday && (
                                    <button
                                        onClick={goToToday}
                                        className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary active:bg-primary/20 transition-colors"
                                    >
                                        今日
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {timelineItems.length}件のスケジュール
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
                    slideDirection === 'left' && "animate-in slide-in-from-right-4 fade-in duration-200",
                    slideDirection === 'right' && "animate-in slide-in-from-left-4 fade-in duration-200"
                )}
                onAnimationEnd={() => setSlideDirection(null)}
              >
                {/* Calendar Connection Required */}
                {!eventsLoading && calendars.length === 0 && (
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
                        timelineItems={timelineItems}
                        allDayEvents={allDayEvents}
                        eventsLoading={eventsLoading}
                        currentTime={currentTime}
                        onToggleTask={toggleTask}
                        completedEventIds={completedEventIds}
                        onToggleEventCompletion={toggleEventCompletion}
                        onItemTap={handleItemTap}
                        onDragDrop={handleDragDrop}
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <TodayTimelineCards
                            timelineItems={timelineItems}
                            allDayEvents={allDayEvents}
                            eventsLoading={eventsLoading}
                            currentTime={currentTime}
                            onToggleTask={toggleTask}
                            completedEventIds={completedEventIds}
                            onToggleEventCompletion={toggleEventCompletion}
                            onItemTap={handleItemTap}
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
