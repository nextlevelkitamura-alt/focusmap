"use client"

import { useState } from "react"
import { Task } from "@/types/database"
import { useHabits, HabitWithDetails } from "@/hooks/useHabits"
import {
    Target, ChevronDown, ChevronRight, Flame, Trash2,
    Calendar as CalendarIcon, Repeat, Loader2, CheckCircle2
} from "lucide-react"
import { cn } from "@/lib/utils"

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

function parseFrequency(freq: string | null): string[] {
    if (!freq) return []
    return freq.split(',').map(s => s.trim()).filter(Boolean)
}

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

// --- Main Component ---

export function HabitsView({ onUpdateTask }: HabitsViewProps) {
    const { todayHabits, otherHabits, isLoading, error, toggleCompletion, removeHabit } = useHabits()
    const [expandedHabits, setExpandedHabits] = useState<Set<string>>(new Set())
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    const toggleExpand = (habitId: string) => {
        setExpandedHabits(prev => {
            const next = new Set(prev)
            if (next.has(habitId)) next.delete(habitId)
            else next.add(habitId)
            return next
        })
    }

    const toggleChildTask = async (taskId: string, currentStatus: string) => {
        if (!onUpdateTask) return
        const newStatus = currentStatus === 'done' ? 'todo' : 'done'
        await onUpdateTask(taskId, { status: newStatus })
    }

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

                {/* Today's Habits */}
                {todayHabits.length > 0 && (
                    <section>
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                            <CalendarIcon className="h-3.5 w-3.5" />
                            今日の習慣
                        </h3>
                        <div className="space-y-2">
                            {todayHabits.map(item => (
                                <HabitCard
                                    key={item.habit.id}
                                    item={item}
                                    isExpanded={expandedHabits.has(item.habit.id)}
                                    onToggleExpand={() => toggleExpand(item.habit.id)}
                                    onToggleCompletion={() => toggleCompletion(item.habit.id)}
                                    onToggleChild={toggleChildTask}
                                    isToday
                                    isConfirmingDelete={confirmDeleteId === item.habit.id}
                                    onRequestDelete={() => setConfirmDeleteId(item.habit.id)}
                                    onConfirmDelete={() => { removeHabit(item.habit.id); setConfirmDeleteId(null) }}
                                    onCancelDelete={() => setConfirmDeleteId(null)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Other Habits */}
                {otherHabits.length > 0 && (
                    <section>
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                            <Repeat className="h-3.5 w-3.5" />
                            その他の習慣
                        </h3>
                        <div className="space-y-2">
                            {otherHabits.map(item => (
                                <HabitCard
                                    key={item.habit.id}
                                    item={item}
                                    isExpanded={expandedHabits.has(item.habit.id)}
                                    onToggleExpand={() => toggleExpand(item.habit.id)}
                                    onToggleCompletion={() => toggleCompletion(item.habit.id)}
                                    onToggleChild={toggleChildTask}
                                    isToday={false}
                                    isConfirmingDelete={confirmDeleteId === item.habit.id}
                                    onRequestDelete={() => setConfirmDeleteId(item.habit.id)}
                                    onConfirmDelete={() => { removeHabit(item.habit.id); setConfirmDeleteId(null) }}
                                    onCancelDelete={() => setConfirmDeleteId(null)}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>
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
}

function HabitCard({ item, isExpanded, onToggleExpand, onToggleCompletion, onToggleChild, isToday, isConfirmingDelete, onRequestDelete, onConfirmDelete, onCancelDelete }: HabitCardProps) {
    const { habit, childTasks, streak, isCompletedToday } = item
    const freq = habit.habit_frequency
    const icon = habit.habit_icon
    const startDate = habit.habit_start_date
    const endDate = habit.habit_end_date
    const frequencyLabel = getFrequencyLabel(freq)
    const activeDays = parseFrequency(freq)

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
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">{frequencyLabel}</span>
                            {(startDate || endDate) && (
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(startDate)}〜{formatDate(endDate)}
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

            {/* Expanded: Child Tasks */}
            {isExpanded && childTasks.length > 0 && (
                <div className="border-t px-3 py-2 space-y-1">
                    {childTasks.map(child => (
                        <button
                            key={child.id}
                            className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors text-left"
                            onClick={() => onToggleChild(child.id, child.status || 'todo')}
                        >
                            <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                                child.status === 'done'
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "border-muted-foreground/30"
                            )}>
                                {child.status === 'done' && (
                                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                )}
                            </div>
                            <span className={cn(
                                "text-sm flex-1",
                                child.status === 'done' && "line-through text-muted-foreground"
                            )}>
                                {child.title}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
