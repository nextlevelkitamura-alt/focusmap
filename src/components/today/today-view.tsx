"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import {
    Play, Pause, Check, Square, CheckSquare, Clock,
    Calendar as CalendarIcon, Target, ChevronDown, ChevronUp
} from "lucide-react"
import { cn } from "@/lib/utils"

// --- Types ---

type TimelineItem =
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }

interface TodayViewProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
}

// --- Main Component ---

export function TodayView({ allTasks, onUpdateTask }: TodayViewProps) {
    const { selectedCalendarIds } = useCalendars()
    const timer = useTimer()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [showAllUnscheduled, setShowAllUnscheduled] = useState(false)

    // Sync local tasks with prop changes
    useEffect(() => {
        setLocalTasks(allTasks)
    }, [allTasks])

    // Today's date range
    const today = useMemo(() => {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        return d
    }, [])

    const tomorrow = useMemo(() => {
        const d = new Date(today)
        d.setDate(d.getDate() + 1)
        return d
    }, [today])

    // Fetch calendar events for today
    const { events: calendarEvents, isLoading: eventsLoading } = useCalendarEvents({
        timeMin: today,
        timeMax: tomorrow,
        calendarIds: selectedCalendarIds,
    })

    // Habit groups: root tasks with "習慣" in title
    const habitGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of localTasks) {
            if (t.parent_task_id === null && t.title.includes('習慣')) ids.add(t.id)
        }
        return ids
    }, [localTasks])

    // Habit tasks
    const habitTasks = useMemo(() =>
        localTasks.filter(t => habitGroupIds.has(t.parent_task_id ?? '') && t.status !== 'archived'),
        [localTasks, habitGroupIds]
    )

    // Today's scheduled tasks (excluding habits)
    const todayScheduledTasks = useMemo(() => {
        const todayStr = today.toISOString().split('T')[0]
        return localTasks.filter(t => {
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            return t.scheduled_at.startsWith(todayStr)
        })
    }, [localTasks, habitGroupIds, today])

    // Unscheduled active tasks (excluding habits, max display)
    const unscheduledTasks = useMemo(() => {
        return localTasks.filter(t => {
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (t.scheduled_at) return false
            if (t.status === 'done' || t.status === 'archived') return false
            return true
        })
    }, [localTasks, habitGroupIds])

    // Merge calendar events + scheduled tasks into timeline
    const timelineItems = useMemo(() => {
        const items: TimelineItem[] = []

        // Calendar events (skip all-day)
        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            items.push({
                type: 'event',
                data: event,
                startTime: new Date(event.start_time),
                endTime: new Date(event.end_time),
            })
        }

        // Scheduled tasks (skip if already represented by a calendar event)
        const eventGoogleIds = new Set(calendarEvents.map(e => e.google_event_id))
        for (const task of todayScheduledTasks) {
            if (!task.scheduled_at) continue
            if (task.google_event_id && eventGoogleIds.has(task.google_event_id)) continue

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

    // Toggle habit/task completion
    const toggleTask = useCallback(async (taskId: string) => {
        const task = localTasks.find(t => t.id === taskId)
        if (!task) return
        const newStatus = task.status === 'done' ? 'todo' : 'done'
        setLocalTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: newStatus } : t
        ))
        await onUpdateTask(taskId, { status: newStatus })
    }, [localTasks, onUpdateTask])

    // Date header
    const dateStr = today.toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
    })

    // Current time (for indicator)
    const [currentTime, setCurrentTime] = useState(new Date())
    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(interval)
    }, [])

    const doneHabitCount = habitTasks.filter(t => t.status === 'done').length
    const displayedUnscheduled = showAllUnscheduled ? unscheduledTasks : unscheduledTasks.slice(0, 5)

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Date Header */}
            <div className="flex-shrink-0 px-4 py-3 border-b">
                <h1 className="text-xl font-bold">{dateStr}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                    {timelineItems.length}件のスケジュール
                    {habitTasks.length > 0 && ` · ${doneHabitCount}/${habitTasks.length} 習慣完了`}
                </p>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* Habit Bar (horizontal pills) */}
                {habitTasks.length > 0 && (
                    <div className="px-4 py-3 border-b bg-muted/20">
                        <div className="flex items-center gap-2 mb-2">
                            <Target className="w-3.5 h-3.5 text-primary" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">習慣</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                            {habitTasks.map(task => (
                                <button
                                    key={task.id}
                                    onClick={() => toggleTask(task.id)}
                                    className={cn(
                                        "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                                        task.status === 'done'
                                            ? "bg-primary/10 text-primary border-primary/30"
                                            : "bg-background text-muted-foreground border-border hover:border-primary/30"
                                    )}
                                >
                                    {task.status === 'done' ? (
                                        <CheckSquare className="w-3 h-3" />
                                    ) : (
                                        <Square className="w-3 h-3" />
                                    )}
                                    <span className="truncate max-w-24">{task.title}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Active Timer Banner */}
                {timer.runningTask && (
                    <div className="mx-4 mt-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                                <span className="text-sm font-medium truncate">{timer.runningTask.title}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className="text-base font-mono font-bold text-primary tabular-nums">
                                    {formatTime(timer.currentElapsedSeconds)}
                                </span>
                                <button
                                    onClick={() => timer.pauseTimer()}
                                    className="p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary"
                                >
                                    <Pause className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => timer.completeTimer()}
                                    className="p-1.5 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-600"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* All-day Events */}
                {allDayEvents.length > 0 && (
                    <div className="px-4 mt-3">
                        {allDayEvents.map(event => (
                            <div
                                key={event.id}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 mb-1.5"
                            >
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate">
                                    {event.title}
                                </span>
                                <span className="text-[10px] text-blue-500 dark:text-blue-400 flex-shrink-0">終日</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Timeline */}
                <div className="px-4 mt-3">
                    <div className="flex items-center gap-2 mb-2">
                        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            スケジュール
                        </span>
                    </div>

                    {timelineItems.length === 0 && !eventsLoading && (
                        <div className="py-6 text-center text-muted-foreground text-sm">
                            今日のスケジュールはありません
                        </div>
                    )}

                    {eventsLoading && timelineItems.length === 0 && (
                        <div className="py-6 text-center text-muted-foreground text-sm">
                            読み込み中...
                        </div>
                    )}

                    <div className="space-y-1.5">
                        {timelineItems.map((item) => (
                            <TimelineCard
                                key={item.type === 'event' ? `e-${item.data.id}` : `t-${(item.data as Task).id}`}
                                item={item}
                                currentTime={currentTime}
                                timer={timer}
                            />
                        ))}
                    </div>
                </div>

                {/* Unscheduled Tasks */}
                {unscheduledTasks.length > 0 && (
                    <div className="px-4 mt-5">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                未スケジュール
                            </span>
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                {unscheduledTasks.length}
                            </span>
                        </div>
                        <div className="space-y-0.5">
                            {displayedUnscheduled.map(task => (
                                <div
                                    key={task.id}
                                    className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/50 group"
                                >
                                    <button
                                        onClick={() => toggleTask(task.id)}
                                        className="flex-shrink-0"
                                    >
                                        {task.status === 'done' ? (
                                            <CheckSquare className="w-4 h-4 text-primary" />
                                        ) : (
                                            <Square className="w-4 h-4 text-muted-foreground" />
                                        )}
                                    </button>
                                    <span className={cn(
                                        "text-sm flex-1 truncate",
                                        task.status === 'done' && "line-through text-muted-foreground"
                                    )}>
                                        {task.title}
                                    </span>
                                    {task.estimated_time > 0 && (
                                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                            {task.estimated_time}分
                                        </span>
                                    )}
                                    {timer.runningTaskId !== task.id && (
                                        <button
                                            onClick={() => timer.startTimer(task)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {unscheduledTasks.length > 5 && (
                            <button
                                onClick={() => setShowAllUnscheduled(prev => !prev)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1"
                            >
                                {showAllUnscheduled ? (
                                    <><ChevronUp className="w-3 h-3" />折りたたむ</>
                                ) : (
                                    <><ChevronDown className="w-3 h-3" />他 {unscheduledTasks.length - 5}件を表示</>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Habit Checklist (bottom section) */}
                {habitTasks.length > 0 && (
                    <div className="px-4 mt-5 mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Target className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                習慣チェックリスト
                            </span>
                        </div>
                        <div className="space-y-0.5 rounded-xl border bg-card p-1">
                            {habitTasks.map(task => (
                                <button
                                    key={task.id}
                                    onClick={() => toggleTask(task.id)}
                                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 text-left transition-colors"
                                >
                                    {task.status === 'done' ? (
                                        <CheckSquare className="w-4.5 h-4.5 text-primary flex-shrink-0" />
                                    ) : (
                                        <Square className="w-4.5 h-4.5 text-muted-foreground flex-shrink-0" />
                                    )}
                                    <span className={cn(
                                        "text-sm",
                                        task.status === 'done' && "line-through text-muted-foreground"
                                    )}>
                                        {task.title}
                                    </span>
                                    {task.estimated_time > 0 && (
                                        <span className="text-[10px] text-muted-foreground ml-auto">
                                            {task.estimated_time}分
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Bottom spacer for scroll */}
                <div className="h-4" />
            </div>
        </div>
    )
}

// --- Timeline Card ---

function TimelineCard({
    item,
    currentTime,
    timer,
}: {
    item: TimelineItem
    currentTime: Date
    timer: ReturnType<typeof useTimer>
}) {
    const startStr = item.startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const endStr = item.endTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const isNow = currentTime >= item.startTime && currentTime < item.endTime
    const isPast = currentTime >= item.endTime

    if (item.type === 'event') {
        const event = item.data as CalendarEvent
        return (
            <div className={cn(
                "flex gap-3 p-3 rounded-xl border transition-colors",
                isNow ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/30" : "border-border",
                isPast && "opacity-50"
            )}>
                <div className="flex-shrink-0 w-12 pt-0.5">
                    <div className="text-xs font-semibold">{startStr}</div>
                    <div className="text-[10px] text-muted-foreground">{endStr}</div>
                </div>
                <div className="w-0.5 rounded-full bg-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{event.title}</div>
                    {event.location && (
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            📍 {event.location}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // Task card
    const task = item.data as Task
    const isRunning = timer.runningTaskId === task.id

    return (
        <div className={cn(
            "flex gap-3 p-3 rounded-xl border transition-colors",
            isRunning
                ? "border-primary bg-primary/5"
                : isNow
                    ? "border-green-300 bg-green-50/50 dark:border-green-700 dark:bg-green-950/30"
                    : "border-border",
            isPast && !isRunning && "opacity-50"
        )}>
            <div className="flex-shrink-0 w-12 pt-0.5">
                <div className="text-xs font-semibold">{startStr}</div>
                <div className="text-[10px] text-muted-foreground">{endStr}</div>
            </div>
            <div className="w-0.5 rounded-full bg-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{task.title}</div>
                {task.estimated_time > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                        ⏱ {task.estimated_time}分
                    </div>
                )}
                {isRunning && (
                    <div className="text-xs font-mono text-primary mt-0.5 tabular-nums">
                        {formatTime(timer.currentElapsedSeconds)}
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 flex items-center">
                {isRunning ? (
                    <button
                        onClick={() => timer.pauseTimer()}
                        className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 text-primary"
                    >
                        <Pause className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        onClick={() => timer.startTimer(task)}
                        className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-primary"
                    >
                        <Play className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    )
}
