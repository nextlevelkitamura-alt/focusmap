"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useCalendarEvents } from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, LayoutGrid, List, Flame
} from "lucide-react"
import { cn } from "@/lib/utils"
import { TodayTimelineCards } from "./today-timeline-cards"
import { TodayTimelineCalendar } from "./today-timeline-calendar"

// --- Types ---

type TimelineItem =
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }

type TimelineMode = 'calendar' | 'cards'

interface TodayViewProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
}

// --- Mock habits data (will be replaced with real DB data later) ---
interface MockHabit {
    id: string
    title: string
    icon: string
    color: string
    streak: number
    weekDots: boolean[] // last 7 days, [6]=today
    completedToday: boolean
}

const MOCK_HABITS: MockHabit[] = [
    { id: 'h1', title: '水を飲む', icon: '💧', color: '#3b82f6', streak: 12, weekDots: [true, true, true, false, true, true, false], completedToday: false },
    { id: 'h2', title: '読書 30分', icon: '📖', color: '#8b5cf6', streak: 3, weekDots: [true, true, false, true, false, false, false], completedToday: false },
    { id: 'h3', title: '運動', icon: '🏃', color: '#10b981', streak: 0, weekDots: [false, true, false, true, false, false, false], completedToday: false },
    { id: 'h4', title: '瞑想 5分', icon: '🧘', color: '#f59e0b', streak: 5, weekDots: [true, true, true, true, true, false, false], completedToday: false },
]

// --- Main Component ---

export function TodayView({ allTasks, onUpdateTask }: TodayViewProps) {
    const { selectedCalendarIds, calendars } = useCalendars()
    const [localTasks, setLocalTasks] = useState<Task[]>(allTasks)
    const [timelineMode, setTimelineMode] = useState<TimelineMode>('calendar')
    const [habitsExpanded, setHabitsExpanded] = useState(false)

    // Mock habits state
    const [habits, setHabits] = useState<MockHabit[]>(MOCK_HABITS)

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
    const { events: calendarEvents, isLoading: eventsLoading, error: eventsError } = useCalendarEvents({
        timeMin: today,
        timeMax: tomorrow,
        calendarIds: selectedCalendarIds,
    })

    // Habit groups: root tasks with "習慣" in title (legacy, kept for backward compat)
    const habitGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of localTasks) {
            if (t.parent_task_id === null && t.title.includes('習慣')) ids.add(t.id)
        }
        return ids
    }, [localTasks])

    // Today's scheduled tasks (excluding habits)
    const todayScheduledTasks = useMemo(() => {
        const todayStr = today.toISOString().split('T')[0]
        return localTasks.filter(t => {
            if (habitGroupIds.has(t.parent_task_id ?? '')) return false
            if (!t.scheduled_at) return false
            return t.scheduled_at.startsWith(todayStr)
        })
    }, [localTasks, habitGroupIds, today])


    // Merge calendar events + scheduled tasks into timeline
    const timelineItems = useMemo(() => {
        const items: TimelineItem[] = []

        for (const event of calendarEvents) {
            if (event.is_all_day) continue
            items.push({
                type: 'event',
                data: event,
                startTime: new Date(event.start_time),
                endTime: new Date(event.end_time),
            })
        }

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

    // Toggle mock habit
    const toggleHabit = useCallback((habitId: string) => {
        setHabits(prev => prev.map(h => {
            if (h.id !== habitId) return h
            const newCompleted = !h.completedToday
            const newWeekDots = [...h.weekDots]
            newWeekDots[6] = newCompleted
            return {
                ...h,
                completedToday: newCompleted,
                weekDots: newWeekDots,
                streak: newCompleted ? h.streak + 1 : Math.max(0, h.streak - 1),
            }
        }))
    }, [])

    // Date header
    const dateStr = today.toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
    })

    // Current time
    const [currentTime, setCurrentTime] = useState(new Date())
    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(interval)
    }, [])

    const doneHabitCount = habits.filter(h => h.completedToday).length

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
                    <div>
                        <h1 className="text-xl font-bold">{dateStr}</h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {timelineItems.length}件のスケジュール
                            {habits.length > 0 && ` · ${doneHabitCount}/${habits.length} 習慣完了`}
                        </p>
                    </div>
                    {/* Timeline mode toggle */}
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

            {/* Habit Bar (fixed) + Expandable Detail */}
            {habits.length > 0 && (
                <div className="flex-shrink-0 border-b">
                    {/* Compact Habit Bar */}
                    <button
                        onClick={() => setHabitsExpanded(prev => !prev)}
                        className="w-full px-4 py-2.5 flex items-center gap-3 active:bg-muted/30 transition-colors"
                    >
                        <Target className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                        <div className="flex gap-1.5 flex-1 overflow-x-auto no-scrollbar">
                            {habits.map(habit => (
                                <span
                                    key={habit.id}
                                    className={cn(
                                        "flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all",
                                        habit.completedToday
                                            ? "bg-primary/10 text-primary border-primary/30 dark:bg-primary/20 dark:border-primary/40"
                                            : "bg-background text-muted-foreground border-border"
                                    )}
                                >
                                    <span>{habit.icon}</span>
                                    {habit.completedToday ? (
                                        <CheckSquare className="w-3 h-3" />
                                    ) : (
                                        <Square className="w-3 h-3" />
                                    )}
                                </span>
                            ))}
                        </div>
                        {habitsExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                    </button>

                    {/* Expanded Habit Detail */}
                    {habitsExpanded && (
                        <div className="px-4 pb-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                            {/* Week day header */}
                            <div className="flex items-center gap-2 pl-8">
                                <div className="flex gap-1.5 ml-auto">
                                    {weekDayLabels.map((label, i) => (
                                        <span
                                            key={i}
                                            className={cn(
                                                "w-5 text-center text-[9px] font-medium",
                                                i === 6 ? "text-primary" : "text-muted-foreground/60"
                                            )}
                                        >
                                            {label}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Habit rows */}
                            {habits.map(habit => (
                                <div key={habit.id} className="flex items-center gap-2">
                                    {/* Toggle button */}
                                    <button
                                        onClick={() => toggleHabit(habit.id)}
                                        className="flex items-center gap-1.5 flex-1 min-w-0 py-1 rounded-md active:bg-muted/50"
                                    >
                                        <span className="text-sm flex-shrink-0">{habit.icon}</span>
                                        <span className={cn(
                                            "text-xs font-medium truncate",
                                            habit.completedToday ? "text-primary" : "text-foreground"
                                        )}>
                                            {habit.title}
                                        </span>
                                    </button>

                                    {/* Week dots */}
                                    <div className="flex gap-1.5 flex-shrink-0">
                                        {habit.weekDots.map((done, i) => (
                                            <div
                                                key={i}
                                                className={cn(
                                                    "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
                                                    i === 6
                                                        ? done
                                                            ? "bg-primary text-primary-foreground"
                                                            : "border-2 border-primary/40"
                                                        : done
                                                            ? "bg-primary/30"
                                                            : "bg-muted/40"
                                                )}
                                            >
                                                {i === 6 && done && <CheckSquare className="w-2.5 h-2.5" />}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Streak */}
                                    {habit.streak > 0 && (
                                        <div className="flex items-center gap-0.5 text-[10px] text-orange-500 font-medium flex-shrink-0 w-10 justify-end">
                                            <Flame className="w-3 h-3" />
                                            {habit.streak}
                                        </div>
                                    )}
                                    {habit.streak === 0 && <div className="w-10 flex-shrink-0" />}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Timeline Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
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
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <TodayTimelineCards
                            timelineItems={timelineItems}
                            allDayEvents={allDayEvents}
                            eventsLoading={eventsLoading}
                            currentTime={currentTime}
                            onToggleTask={toggleTask}
                        />
                        <div className="h-4" />
                    </div>
                )}
            </div>
        </div>
    )
}
