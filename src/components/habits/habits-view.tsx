"use client"

import { useState, useMemo, useEffect } from "react"
import { Task, IdealGoalWithItems } from "@/types/database"
import {
    useHabits, HabitWithDetails, DAY_KEYS, formatDateString, getTodayDateString, parseFrequency
} from "@/hooks/useHabits"
import {
    Target, ChevronDown, ChevronRight, ChevronLeft, Flame, Trash2,
    Calendar as CalendarIcon, Repeat, Loader2, CheckCircle2, Settings2, Star
} from "lucide-react"
import { cn } from "@/lib/utils"
import { HabitSettingsSheet } from "./habit-settings-sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

// --- Types ---

const HABIT_DAYS = [
    { key: 'mon', label: '月' },
    { key: 'tue', label: '火' },
    { key: 'wed', label: '水' },
    { key: 'thu', label: '木' },
    { key: 'fri', label: '金' },
    { key: 'sat', label: '土' },
    { key: 'sun', label: '日' },
] as const

interface HabitsViewProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

// --- Helper functions ---

function getFrequencyLabel(freq: string | null): string {
    const days = parseFrequency(freq)
    if (days.length === 0) return '未設定'
    if (days.length === 7) return '毎日'
    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri']
    const weekend = ['sat', 'sun']
    if (days.length === 5 && weekdays.every(d => days.includes(d))) return '平日'
    if (days.length === 2 && weekend.every(d => days.includes(d))) return '土日'
    return days.map(d => HABIT_DAYS.find(h => h.key === d)?.label || d).join('・')
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
}

// Get the Monday of the week containing the given date
function getWeekStart(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    const dayOfWeek = d.getDay()
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Monday = 1
    d.setDate(d.getDate() + diff)
    return d
}

// Get achievement rate for a habit on a given date
function getAchievementRate(
    item: HabitWithDetails,
    dateStr: string,
): number {
    if (item.childTasks.length === 0) {
        return item.completions.some(c => c.completed_date === dateStr) ? 100 : 0
    }
    const doneCount = item.childTasks.filter(child =>
        item.taskCompletions.some(tc => tc.task_id === child.id && tc.completed_date === dateStr)
    ).length
    return Math.round((doneCount / item.childTasks.length) * 100)
}

// Get heatmap color class based on achievement rate
function getHeatmapColor(rate: number, isApplicable: boolean): string {
    if (!isApplicable) return 'bg-transparent'
    if (rate === 0) return 'bg-gray-200 dark:bg-gray-700'
    if (rate < 50) return 'bg-green-200 dark:bg-green-900'
    if (rate < 100) return 'bg-green-400 dark:bg-green-700'
    return 'bg-green-600 dark:bg-green-500'
}

// --- Main Component ---

export function HabitsView({ onUpdateTask }: HabitsViewProps) {
    const { habits, todayHabits, otherHabits, isLoading, error, toggleCompletion, toggleChildTaskCompletion, removeHabit } = useHabits()
    const [expandedHabits, setExpandedHabits] = useState<Set<string>>(new Set())
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [weekOffset, setWeekOffset] = useState(0) // 0 = this week, -1 = last week, etc.
    const [settingsHabit, setSettingsHabit] = useState<Task | null>(null)

    // 理想像データを取得して習慣との紐付きマップを構築
    const [habitIdealMap, setHabitIdealMap] = useState<Map<string, { idealTitle: string; idealColor: string | null }>>(new Map())
    useEffect(() => {
        fetch('/api/ideals')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (!data?.ideals) return
                const map = new Map<string, { idealTitle: string; idealColor: string | null }>()
                for (const ideal of data.ideals as IdealGoalWithItems[]) {
                    for (const item of ideal.ideal_items ?? []) {
                        if (item.linked_habit_id) {
                            map.set(item.linked_habit_id, {
                                idealTitle: ideal.title,
                                idealColor: ideal.color,
                            })
                        }
                    }
                }
                setHabitIdealMap(map)
            })
            .catch(() => {})
    }, [])

    const toggleExpand = (habitId: string) => {
        setExpandedHabits(prev => {
            const next = new Set(prev)
            if (next.has(habitId)) next.delete(habitId)
            else next.add(habitId)
            return next
        })
    }

    const toggleChildTask = async (taskId: string, currentStatus: string, habitItem?: HabitWithDetails) => {
        if (habitItem) {
            await toggleChildTaskCompletion(habitItem.habit.id, taskId)
        } else if (onUpdateTask) {
            const newStatus = currentStatus === 'done' ? 'todo' : 'done'
            await onUpdateTask(taskId, { status: newStatus })
        }
    }

    // Week dates for heatmap
    const weekDates = useMemo(() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const weekStart = getWeekStart(today)
        weekStart.setDate(weekStart.getDate() + weekOffset * 7)

        const dates: { date: Date; dateStr: string; dayKey: string; label: string; isToday: boolean }[] = []
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart)
            d.setDate(d.getDate() + i)
            const todayDate = new Date()
            todayDate.setHours(0, 0, 0, 0)
            dates.push({
                date: d,
                dateStr: formatDateString(d),
                dayKey: DAY_KEYS[d.getDay()],
                label: HABIT_DAYS[i].label,
                isToday: d.getTime() === todayDate.getTime(),
            })
        }
        return dates
    }, [weekOffset])

    // Week label
    const weekLabel = useMemo(() => {
        if (weekDates.length === 0) return ''
        const start = weekDates[0].date
        const end = weekDates[6].date
        return `${start.getMonth() + 1}/${start.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}`
    }, [weekDates])

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center text-muted-foreground">
                    <p className="text-sm">{error}</p>
                </div>
            </div>
        )
    }

    if (todayHabits.length === 0 && otherHabits.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-sm">
                    <Target className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                    <h3 className="font-medium text-lg mb-1">習慣がまだありません</h3>
                    <p className="text-sm text-muted-foreground">
                        マインドマップのタスクメニューから「習慣として設定」をオンにすると、ここに表示されます。
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Target className="h-5 w-5" />
                            習慣トラッカー
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            今日: {todayHabits.length}件の習慣
                        </p>
                    </div>
                </div>

                {/* Heatmap Grid */}
                {habits.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                <CalendarIcon className="h-3.5 w-3.5" />
                                週間達成率
                            </h3>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setWeekOffset(prev => Math.max(prev - 1, -3))}
                                    className="p-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="text-xs text-muted-foreground min-w-[100px] text-center">
                                    {weekOffset === 0 ? '今週' : weekLabel}
                                </span>
                                <button
                                    onClick={() => setWeekOffset(prev => Math.min(prev + 1, 0))}
                                    className={cn(
                                        "p-1 rounded-md transition-colors",
                                        weekOffset >= 0 ? "text-muted-foreground/20" : "hover:bg-muted/50 text-muted-foreground"
                                    )}
                                    disabled={weekOffset >= 0}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="border rounded-lg overflow-x-auto">
                            {/* Day headers */}
                            <div className="grid grid-cols-[120px_repeat(7,_minmax(40px,_1fr))] min-w-[400px] gap-0 bg-muted/30">
                                <div className="p-2 text-[10px] text-muted-foreground" />
                                {weekDates.map((wd, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            "p-1.5 text-center text-[10px] font-medium",
                                            wd.isToday ? "text-primary bg-primary/10" : "text-muted-foreground"
                                        )}
                                    >
                                        <div>{wd.label}</div>
                                        <div className="text-[9px] opacity-60">{wd.date.getDate()}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Habit rows */}
                            {habits.map(item => {
                                const activeDays = parseFrequency(item.habit.habit_frequency)
                                return (
                                    <div
                                        key={item.habit.id}
                                        className="grid grid-cols-[120px_repeat(7,_minmax(40px,_1fr))] min-w-[400px] gap-0 border-t"
                                    >
                                        {/* Habit name */}
                                        <div className="p-2 flex items-center gap-1.5 min-w-0">
                                            <span className="text-xs flex-shrink-0">{item.habit.habit_icon || '🔄'}</span>
                                            <span className="text-xs truncate">{item.habit.title}</span>
                                        </div>
                                        {/* Day cells */}
                                        {weekDates.map((wd, i) => {
                                            const isApplicable = activeDays.length === 0 || activeDays.includes(wd.dayKey)
                                            const rate = isApplicable ? getAchievementRate(item, wd.dateStr) : -1
                                            return (
                                                <div
                                                    key={i}
                                                    className={cn(
                                                        "flex items-center justify-center p-1.5",
                                                        wd.isToday && "bg-primary/5"
                                                    )}
                                                    title={isApplicable ? `${rate}%` : '対象外'}
                                                >
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-sm transition-colors",
                                                        isApplicable
                                                            ? getHeatmapColor(rate, true)
                                                            : "bg-transparent border border-dashed border-muted-foreground/15"
                                                    )} />
                                                </div>
                                            )
                                        })}
                                    </div>
                                )
                            })}

                            {/* Legend */}
                            <div className="border-t px-3 py-2 flex items-center justify-end gap-1.5">
                                <span className="text-[9px] text-muted-foreground mr-1">達成率:</span>
                                <div className="w-3 h-3 rounded-sm bg-gray-200 dark:bg-gray-700" title="0%" />
                                <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900" title="1-49%" />
                                <div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700" title="50-99%" />
                                <div className="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500" title="100%" />
                            </div>
                        </div>
                    </section>
                )}

                {/* Habits Tabs */}
                <Tabs defaultValue="today" className="w-full">
                    <TabsList className="w-fit mx-auto">
                        <TabsTrigger value="today" className="gap-2">
                            今日の習慣
                            {todayHabits.length > 0 && (
                                <span className="text-[10px] bg-primary/20 px-1.5 rounded-full">
                                    {todayHabits.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="other" className="gap-2">
                            その他の習慣
                            {otherHabits.length > 0 && (
                                <span className="text-[10px] bg-muted-foreground/20 px-1.5 rounded-full">
                                    {otherHabits.length}
                                </span>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="today" className="mt-4 space-y-2">
                        {todayHabits.length > 0 ? (
                            todayHabits.map(item => (
                                <HabitCard
                                    key={item.habit.id}
                                    item={item}
                                    isExpanded={expandedHabits.has(item.habit.id)}
                                    onToggleExpand={() => toggleExpand(item.habit.id)}
                                    onToggleCompletion={() => toggleCompletion(item.habit.id)}
                                    onToggleChild={(taskId, status) => toggleChildTask(taskId, status, item)}
                                    isToday
                                    isConfirmingDelete={confirmDeleteId === item.habit.id}
                                    onRequestDelete={() => setConfirmDeleteId(item.habit.id)}
                                    onConfirmDelete={() => { removeHabit(item.habit.id); setConfirmDeleteId(null) }}
                                    onCancelDelete={() => setConfirmDeleteId(null)}
                                    onOpenSettings={() => setSettingsHabit(item.habit)}
                                    idealInfo={habitIdealMap.get(item.habit.id)}
                                />
                            ))
                        ) : (
                            <div className="text-center text-sm text-muted-foreground py-8">
                                今日の習慣はありません
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="other" className="mt-4 space-y-2">
                        {otherHabits.length > 0 ? (
                            otherHabits.map(item => (
                                <HabitCard
                                    key={item.habit.id}
                                    item={item}
                                    isExpanded={expandedHabits.has(item.habit.id)}
                                    onToggleExpand={() => toggleExpand(item.habit.id)}
                                    onToggleCompletion={() => toggleCompletion(item.habit.id)}
                                    onToggleChild={(taskId, status) => toggleChildTask(taskId, status, item)}
                                    isToday={false}
                                    isConfirmingDelete={confirmDeleteId === item.habit.id}
                                    onRequestDelete={() => setConfirmDeleteId(item.habit.id)}
                                    onConfirmDelete={() => { removeHabit(item.habit.id); setConfirmDeleteId(null) }}
                                    onCancelDelete={() => setConfirmDeleteId(null)}
                                    onOpenSettings={() => setSettingsHabit(item.habit)}
                                    idealInfo={habitIdealMap.get(item.habit.id)}
                                />
                            ))
                        ) : (
                            <div className="text-center text-sm text-muted-foreground py-8">
                                その他の習慣はありません
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* Habit Settings Sheet */}
            {settingsHabit && onUpdateTask && (
                <HabitSettingsSheet
                    open={!!settingsHabit}
                    onOpenChange={(open) => { if (!open) setSettingsHabit(null) }}
                    habit={settingsHabit}
                    onUpdate={onUpdateTask}
                />
            )}
        </div>
    )
}

// --- HabitCard Component ---

interface HabitCardProps {
    item: HabitWithDetails
    isExpanded: boolean
    onToggleExpand: () => void
    onToggleCompletion: () => void
    onToggleChild: (taskId: string, currentStatus: string) => void
    isToday: boolean
    isConfirmingDelete: boolean
    onRequestDelete: () => void
    onConfirmDelete: () => void
    onCancelDelete: () => void
    onOpenSettings: () => void
    idealInfo?: { idealTitle: string; idealColor: string | null }
}

function HabitCard({ item, isExpanded, onToggleExpand, onToggleCompletion, onToggleChild, isToday, isConfirmingDelete, onRequestDelete, onConfirmDelete, onCancelDelete, onOpenSettings, idealInfo }: HabitCardProps) {
    const { habit, childTasks, streak, isCompletedToday } = item
    const freq = habit.habit_frequency
    const icon = habit.habit_icon
    const startDate = habit.habit_start_date
    const endDate = habit.habit_end_date
    const frequencyLabel = getFrequencyLabel(freq)
    const activeDays = parseFrequency(freq)
    const todayStr = getTodayDateString()

    // 日次ベースの子タスク完了数
    const doneChildCount = childTasks.length > 0
        ? childTasks.filter(c => item.taskCompletions.some(tc => tc.task_id === c.id && tc.completed_date === todayStr)).length
        : 0

    return (
        <div className={cn(
            "border rounded-lg transition-all",
            isToday && isCompletedToday && "border-green-500/30 bg-green-50/50 dark:bg-green-950/20",
            isToday && !isCompletedToday && "border-border bg-background",
            !isToday && "border-border/50 bg-muted/30 opacity-75"
        )}>
            {/* Card Header */}
            <div className="flex items-center gap-3 p-3">
                {/* Completion toggle (today only) */}
                {isToday ? (
                    <button
                        className="flex-shrink-0 transition-colors"
                        onClick={(e) => { e.stopPropagation(); onToggleCompletion() }}
                    >
                        <CheckCircle2 className={cn(
                            "h-5 w-5",
                            isCompletedToday
                                ? "text-green-500 fill-green-500"
                                : "text-muted-foreground/30 hover:text-muted-foreground/60"
                        )} />
                    </button>
                ) : (
                    <div className="w-5" />
                )}

                {/* Expand button + Icon + Title */}
                <button
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                    onClick={onToggleExpand}
                >
                    {/* Icon */}
                    <span className="text-lg flex-shrink-0">{icon || '🔄'}</span>

                    {/* Title + Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                "font-medium text-sm truncate",
                                isCompletedToday && isToday && "line-through text-muted-foreground"
                            )}>
                                {habit.title}
                            </span>
                            {isCompletedToday && isToday && (
                                <span className="text-green-600 text-xs font-medium">完了</span>
                            )}
                            {childTasks.length > 0 && isToday && (
                                <span className="text-[10px] text-muted-foreground">
                                    {doneChildCount}/{childTasks.length}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-muted-foreground">{frequencyLabel}</span>
                            {(startDate || endDate) && (
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(startDate)}〜{formatDate(endDate)}
                                </span>
                            )}
                            {idealInfo && (
                                <span
                                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                >
                                    <Star className="w-2.5 h-2.5" />
                                    {idealInfo.idealTitle}
                                </span>
                            )}
                        </div>
                    </div>
                </button>

                {/* Streak */}
                {streak > 0 && (
                    <div className="flex items-center gap-0.5 flex-shrink-0 text-orange-500">
                        <Flame className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium">{streak}</span>
                    </div>
                )}

                {/* Day dots */}
                <div className="flex gap-0.5 flex-shrink-0 hidden md:flex">
                    {HABIT_DAYS.map(day => (
                        <div
                            key={day.key}
                            className={cn(
                                "w-5 h-5 rounded text-[10px] flex items-center justify-center font-medium",
                                activeDays.includes(day.key) || activeDays.length === 0
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted/50 text-muted-foreground/40"
                            )}
                        >
                            {day.label}
                        </div>
                    ))}
                </div>

                {/* Expand chevron */}
                {childTasks.length > 0 && (
                    <button onClick={onToggleExpand} className="flex-shrink-0 text-muted-foreground">
                        {isExpanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />
                        }
                    </button>
                )}

                {/* Settings button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettings() }}
                    className="flex-shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors p-0.5"
                    title="習慣設定"
                >
                    <Settings2 className="h-3.5 w-3.5" />
                </button>

                {/* Delete button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                    className="flex-shrink-0 text-muted-foreground/40 hover:text-red-500 transition-colors p-0.5"
                    title="この習慣を削除"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Delete confirmation bar */}
            {isConfirmingDelete && (
                <div className="border-t px-3 py-2 bg-red-50 dark:bg-red-950/20 flex items-center justify-between gap-2">
                    <span className="text-xs text-red-600 dark:text-red-400">
                        「{habit.title}」を削除しますか？子タスクも削除されます。
                    </span>
                    <div className="flex gap-1.5 flex-shrink-0">
                        <button
                            onClick={onCancelDelete}
                            className="px-2.5 py-1 text-xs rounded bg-background border hover:bg-muted transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={onConfirmDelete}
                            className="px-2.5 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                        >
                            削除
                        </button>
                    </div>
                </div>
            )}

            {/* Expanded: Child Tasks (date-based completion) */}
            {isExpanded && childTasks.length > 0 && (
                <div className="border-t px-3 py-2 space-y-1">
                    {childTasks.map(child => {
                        const isDoneToday = item.taskCompletions.some(
                            tc => tc.task_id === child.id && tc.completed_date === todayStr
                        )
                        return (
                            <button
                                key={child.id}
                                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors text-left"
                                onClick={() => onToggleChild(child.id, child.status || 'todo')}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                                    isDoneToday
                                        ? "bg-primary border-primary text-primary-foreground"
                                        : "border-muted-foreground/30"
                                )}>
                                    {isDoneToday && (
                                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    )}
                                </div>
                                <span className={cn(
                                    "text-sm flex-1",
                                    isDoneToday && "line-through text-muted-foreground"
                                )}>
                                    {child.title}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
