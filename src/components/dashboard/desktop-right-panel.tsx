"use client"

import { useState, useCallback, useRef, forwardRef, useImperativeHandle, useMemo } from "react"
import {
    ChevronLeft, ChevronRight, Target, ChevronDown, ChevronUp,
    CheckSquare, Square, Flame, Play, Pause, CalendarDays, Check, RefreshCw
} from "lucide-react"
import { format, isSameDay } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { SidebarCalendar, SidebarCalendarRef } from "@/components/dashboard/sidebar-calendar"
import { CalendarToast, useCalendarToast } from "@/components/calendar/calendar-toast"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { useHabits, formatDateString } from "@/hooks/useHabits"
import { useTimer, formatTime } from "@/contexts/TimerContext"

export interface DesktopRightPanelRef {
    refreshCalendar: () => Promise<void>
    addOptimisticEvent: (event: CalendarEvent) => void
    removeOptimisticEvent: (eventId: string) => void
}

interface DesktopRightPanelProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    tasks?: Task[]
}

export const DesktopRightPanel = forwardRef<DesktopRightPanelRef, DesktopRightPanelProps>(
    function DesktopRightPanel({ onUpdateTask, tasks = [] }, ref) {
        const { toast, showToast, hideToast } = useCalendarToast()
        const calendarRef = useRef<SidebarCalendarRef>(null)

        // — Date state (synced to SidebarCalendar)
        const [selectedDate, setSelectedDate] = useState<Date>(() => {
            const d = new Date(); d.setHours(0, 0, 0, 0); return d
        })
        const [calendarOpen, setCalendarOpen] = useState(false)
        const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date())

        // — Habit state
        const { getHabitsForDate, isLoading: habitsLoading, toggleCompletion, toggleChildTaskCompletion } = useHabits()
        const [habitsExpanded, setHabitsExpanded] = useState(false)

        // — Timer
        const timer = useTimer()

        const isToday = useMemo(() => {
            const now = new Date(); now.setHours(0, 0, 0, 0)
            return selectedDate.getTime() === now.getTime()
        }, [selectedDate])

        const selectedDateStr = useMemo(() => formatDateString(selectedDate), [selectedDate])

        const dateHabits = useMemo(() => getHabitsForDate(selectedDate), [getHabitsForDate, selectedDate])

        const doneHabitCount = useMemo(() => {
            return dateHabits.filter(h => {
                if (isToday) return h.isCompletedToday
                return h.completions.some(c => c.completed_date === selectedDateStr)
            }).length
        }, [dateHabits, isToday, selectedDateStr])

        // — Date navigation
        const goToPrevDay = useCallback(() => {
            setSelectedDate(prev => {
                const d = new Date(prev); d.setDate(d.getDate() - 1); return d
            })
        }, [])

        const goToNextDay = useCallback(() => {
            setSelectedDate(prev => {
                const d = new Date(prev); d.setDate(d.getDate() + 1); return d
            })
        }, [])

        const goToToday = useCallback(() => {
            const d = new Date(); d.setHours(0, 0, 0, 0)
            setSelectedDate(d)
            setCalendarMonth(new Date())
            setCalendarOpen(false)
        }, [])

        const handleDateSelect = useCallback((date: Date | undefined) => {
            if (!date) return
            const normalized = new Date(date); normalized.setHours(0, 0, 0, 0)
            setSelectedDate(normalized)
            setCalendarOpen(false)
        }, [])

        // — Task drop onto calendar
        const handleTaskDrop = useCallback(async (taskId: string, dateTime: Date) => {
            if (!taskId || taskId.length < 10) {
                showToast('error', '無効なタスクIDです。')
                return
            }
            if (!onUpdateTask) {
                showToast('error', 'タスク更新機能が利用できません。')
                return
            }
            showToast('info', 'スケジュール設定中...')
            try {
                await onUpdateTask(taskId, { scheduled_at: dateTime.toISOString() })
                const timeStr = format(dateTime, 'M月d日 HH:mm', { locale: ja })
                showToast('success', `${timeStr}にスケジュール設定しました`)
                await calendarRef.current?.refetch()
            } catch (error) {
                showToast('error', error instanceof Error ? error.message : 'カレンダーへの追加に失敗しました')
            }
        }, [showToast, onUpdateTask])

        // — Expose ref methods
        useImperativeHandle(ref, () => ({
            refreshCalendar: async () => { await calendarRef.current?.refetch() },
            addOptimisticEvent: (event: CalendarEvent) => { calendarRef.current?.addOptimisticEvent(event) },
            removeOptimisticEvent: (eventId: string) => { calendarRef.current?.removeOptimisticEvent(eventId) },
        }), [])

        const dateFmt = format(selectedDate, 'M/d (E)', { locale: ja })
        const dateLabel = isToday ? `今日 · ${dateFmt}` : dateFmt

        // — Active timer task name
        const runningTask = useMemo(() => tasks.find(t => t.id === timer.runningTaskId), [tasks, timer.runningTaskId])

        return (
            <>
                <div className="h-full flex flex-col bg-background/50 backdrop-blur-sm border-l border-border/30 relative overflow-hidden">

                    {/* ① Date Navigation Header */}
                    <div className="flex-shrink-0 px-3 py-2 border-b border-border/30 bg-background/80">
                        <div className="flex items-center justify-between">
                            {/* Left: prev + date label + next */}
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={goToPrevDay}
                                    className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setCalendarOpen(prev => !prev)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-colors text-sm font-semibold",
                                        calendarOpen ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                                    )}
                                >
                                    <CalendarDays className="w-3.5 h-3.5" />
                                    {dateLabel}
                                </button>
                                <button
                                    onClick={goToNextDay}
                                    className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Right: Today button + habit count */}
                            <div className="flex items-center gap-2">
                                {dateHabits.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground">
                                        <Target className="w-2.5 h-2.5 inline mr-0.5 text-primary" />
                                        {doneHabitCount}/{dateHabits.length}
                                    </span>
                                )}
                                {!isToday && (
                                    <button
                                        onClick={goToToday}
                                        className="text-[10px] px-2 py-0.5 rounded-full border border-muted-foreground/30 text-muted-foreground hover:bg-muted/60 transition-colors"
                                    >
                                        今日
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ② Collapsible mini-calendar */}
                    {calendarOpen && (
                        <div className="flex-shrink-0 border-b border-border/30 px-3 py-2 bg-background/60 animate-in slide-in-from-top-2 duration-200">
                            <SimpleCalendar
                                selected={selectedDate}
                                onSelect={handleDateSelect}
                                month={calendarMonth}
                                onMonthChange={setCalendarMonth}
                                className="w-full"
                            />
                        </div>
                    )}

                    {/* ③ Habit Bar */}
                    {!habitsLoading && dateHabits.length > 0 && (
                        <div className="flex-shrink-0 border-b border-border/30 bg-background/40">
                            <div className="px-3 py-1.5">
                                {/* Habit header */}
                                <button
                                    onClick={() => setHabitsExpanded(prev => !prev)}
                                    className="flex items-center gap-1.5 mb-1.5 w-full text-left"
                                >
                                    <Target className="w-3 h-3 text-primary flex-shrink-0" />
                                    <span className="text-[10px] font-medium text-muted-foreground flex-1">
                                        {isToday ? '今日の習慣' : `${format(selectedDate, 'M/d', { locale: ja })}の習慣`}
                                    </span>
                                    {habitsExpanded
                                        ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                        : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                    }
                                </button>

                                {/* Habit pills */}
                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                                    {dateHabits.map(item => {
                                        const hasChildren = item.childTasks.length > 0
                                        const isCompleted = isToday
                                            ? item.isCompletedToday
                                            : item.completions.some(c => c.completed_date === selectedDateStr)
                                        const doneChildCount = hasChildren
                                            ? item.childTasks.filter(c =>
                                                item.taskCompletions.some(tc => tc.task_id === c.id && tc.completed_date === selectedDateStr)
                                            ).length
                                            : 0
                                        return (
                                            <button
                                                key={item.habit.id}
                                                onClick={() => { if (!hasChildren && isToday) toggleCompletion(item.habit.id) }}
                                                className={cn(
                                                    "flex items-center gap-1 px-2 py-1 rounded-full transition-all flex-shrink-0 border text-[11px]",
                                                    !hasChildren && isToday && "active:scale-[0.98]",
                                                    isCompleted
                                                        ? "bg-primary/10 border-primary/30"
                                                        : !hasChildren && isToday
                                                            ? "border-border hover:bg-muted/40"
                                                            : "border-border"
                                                )}
                                            >
                                                {isCompleted
                                                    ? <CheckSquare className={cn("w-3 h-3 flex-shrink-0", hasChildren ? "text-primary/50" : "text-primary")} />
                                                    : <Square className={cn("w-3 h-3 flex-shrink-0", hasChildren ? "text-muted-foreground/20" : "text-muted-foreground/40")} />
                                                }
                                                <span className="text-xs flex-shrink-0">{item.habit.habit_icon || '🔄'}</span>
                                                <span className={cn(
                                                    "whitespace-nowrap",
                                                    isCompleted ? "text-primary font-medium line-through" : "text-foreground"
                                                )}>
                                                    {item.habit.title}
                                                </span>
                                                {hasChildren && (
                                                    <span className="text-muted-foreground flex-shrink-0">
                                                        {doneChildCount}/{item.childTasks.length}
                                                    </span>
                                                )}
                                                {item.streak > 0 && (
                                                    <span className="flex items-center gap-0.5 text-[10px] text-orange-500 font-medium flex-shrink-0">
                                                        <Flame className="w-2.5 h-2.5" />
                                                        {item.streak}
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Expanded habit detail */}
                            {habitsExpanded && (
                                <div className="px-3 pb-2 space-y-0.5 animate-in slide-in-from-top-2 duration-200">
                                    {dateHabits.map(item => {
                                        if (item.childTasks.length === 0) return null
                                        return (
                                            <div key={item.habit.id} className="space-y-0">
                                                {item.childTasks.map(child => {
                                                    const isRunning = isToday && timer.runningTaskId === child.id
                                                    const isDoneForDate = item.taskCompletions.some(
                                                        tc => tc.task_id === child.id && tc.completed_date === selectedDateStr
                                                    )
                                                    const todayCompletion = item.taskCompletions.find(
                                                        tc => tc.task_id === child.id && tc.completed_date === selectedDateStr
                                                    )
                                                    const todayElapsed = todayCompletion?.elapsed_seconds ?? 0
                                                    return (
                                                        <div
                                                            key={child.id}
                                                            className={cn(
                                                                "flex items-center gap-1.5 rounded-md transition-colors",
                                                                isRunning && "bg-primary/10"
                                                            )}
                                                        >
                                                            {isToday ? (
                                                                <button
                                                                    className="flex items-center gap-1.5 flex-1 min-w-0 py-1 px-2 rounded-md active:bg-muted/50 transition-colors"
                                                                    onClick={() => toggleChildTaskCompletion(item.habit.id, child.id)}
                                                                >
                                                                    {isDoneForDate
                                                                        ? <CheckSquare className="w-3 h-3 text-primary flex-shrink-0" />
                                                                        : <Square className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                                                                    }
                                                                    <span className={cn(
                                                                        "text-xs flex-1 truncate text-left",
                                                                        isDoneForDate ? "line-through text-muted-foreground" : "text-foreground"
                                                                    )}>
                                                                        {child.title}
                                                                    </span>
                                                                    {todayElapsed > 0 && (
                                                                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                                                            {formatTime(todayElapsed)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5 flex-1 min-w-0 py-1 px-2">
                                                                    {isDoneForDate
                                                                        ? <CheckSquare className="w-3 h-3 text-primary/50 flex-shrink-0" />
                                                                        : <Square className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                                                                    }
                                                                    <span className={cn(
                                                                        "text-xs flex-1 truncate",
                                                                        isDoneForDate ? "line-through text-muted-foreground/50" : "text-muted-foreground"
                                                                    )}>
                                                                        {child.title}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Timer control — today only */}
                                                            {isToday && (
                                                                <button
                                                                    onClick={() => {
                                                                        if (isRunning) timer.pauseTimer()
                                                                        else {
                                                                            const taskObj = tasks.find(t => t.id === child.id)
                                                                            if (taskObj) timer.startTimer(taskObj)
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "p-1 rounded-full transition-all flex-shrink-0 mr-1",
                                                                        isRunning ? "bg-primary text-white shadow-sm" : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
                                                                    )}
                                                                >
                                                                    {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ④ Active Timer Banner — shown only when a timer is running */}
                    {timer.runningTaskId && (
                        <div className="flex-shrink-0 px-3 py-1.5 border-b border-border/30 bg-primary/5">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                                <span className="text-xs text-foreground flex-1 truncate">
                                    {runningTask?.title || 'タイマー実行中'}
                                </span>
                                <span className="text-xs font-mono text-primary font-semibold flex-shrink-0">
                                    {formatTime(timer.currentElapsedSeconds)}
                                </span>
                                <button
                                    onClick={() => timer.pauseTimer()}
                                    className="p-1 rounded-full bg-primary text-white hover:bg-primary/80 transition-colors flex-shrink-0"
                                >
                                    <Pause className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ⑤ SidebarCalendar (full calendar view with day/week/month toggle) */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <SidebarCalendar
                            ref={calendarRef}
                            onTaskDrop={handleTaskDrop}
                            onUpdateTask={onUpdateTask}
                            tasks={tasks}
                            selectedDate={selectedDate}
                            onSelectedDateChange={setSelectedDate}
                        />
                    </div>
                </div>

                {/* Toast */}
                {toast && (
                    <CalendarToast
                        type={toast.type}
                        message={toast.message}
                        onClose={hideToast}
                    />
                )}
            </>
        )
    }
)

DesktopRightPanel.displayName = 'DesktopRightPanel'
