"use client"

import { useRef, useState, useEffect, useMemo, useCallback } from "react"
import { Task, Project, IdealGoalWithItems } from "@/types/database"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    LayoutGrid, List, Flame, Play, Pause, RefreshCw, Check, CalendarDays, Loader2, Inbox, Trash2
} from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TodayTimelineCalendar } from "@/components/today/today-timeline-calendar"
import { TodayTimelineCards } from "@/components/today/today-timeline-cards"
import { MobileEventEditModal } from "@/components/today/mobile-event-edit-modal"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { useTodayViewLogic } from "@/hooks/useTodayViewLogic"
import { formatTime } from "@/contexts/TimerContext"
import { type QuickTaskData } from "@/components/today/quick-task-fab"
import { PanelQuickTaskForm } from "@/components/dashboard/panel-quick-task-form"
import { DesktopPanelFab } from "@/components/dashboard/desktop-panel-fab"
import { useTrackpadNavigation } from "@/hooks/useTrackpadNavigation"
import { useIdealTracking } from "@/hooks/useIdealTracking"
import { Star } from "lucide-react"

// --- Types ---

interface DesktopTodayPanelProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onOpenAiChat?: () => void
}

// --- Component ---

export function DesktopTodayPanel({
    allTasks,
    onUpdateTask,
    projects = [],
    onCreateQuickTask,
    onCreateSubTask,
    onDeleteTask,
    onOpenAiChat,
}: DesktopTodayPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null)
    const [isTaskFormOpen, setIsTaskFormOpen] = useState(false)
    const [taskFormPreset, setTaskFormPreset] = useState<{ scheduledDate: Date; estimatedTime: number } | null>(null)
    const [taskFormDraft, setTaskFormDraft] = useState<{
        title: string
        scheduledDate: Date | null
        estimatedTime: number
        calendarId: string | null
    } | null>(null)
    const [activeTab, setActiveTab] = useState<'today' | 'inbox'>('today')

    const logic = useTodayViewLogic({
        allTasks,
        onUpdateTask,
        projects,
        onCreateSubTask,
        onDeleteTask,
    })
    const scrollPositionRef = logic.scrollPositionRef

    // 2-finger horizontal trackpad swipe for date navigation
    useTrackpadNavigation({
        containerRef: panelRef,
        onNavigateLeft: logic.goToNextDay,
        onNavigateRight: logic.goToPrevDay,
    })

    // 理想像データ取得
    const [ideals, setIdeals] = useState<IdealGoalWithItems[]>([])
    const [habitIdealMap, setHabitIdealMap] = useState<Map<string, string>>(new Map())
    useEffect(() => {
        fetch('/api/ideals')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (!data?.ideals) return
                const allIdeals = data.ideals as IdealGoalWithItems[]
                setIdeals(allIdeals)
                const map = new Map<string, string>()
                for (const ideal of allIdeals) {
                    for (const item of ideal.ideal_items ?? []) {
                        if (item.linked_habit_id) {
                            map.set(item.linked_habit_id, ideal.title)
                        }
                    }
                }
                setHabitIdealMap(map)
            })
            .catch(() => {})
    }, [])

    // 理想進捗トラッキング
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const idealDateRange = useMemo(() => ({ from: todayStr, to: todayStr }), [todayStr])
    const { todaySummary, toggleItemCompletion, refresh: refreshIdealTracking } = useIdealTracking(ideals, idealDateRange)

    // 習慣完了時に理想進捗もリフレッシュ
    const originalToggleCompletion = logic.toggleCompletion
    const wrappedToggleCompletion = useCallback(async (habitId: string) => {
        await originalToggleCompletion(habitId)
        // 少し待ってからリフレッシュ（DB反映を待つ）
        setTimeout(() => refreshIdealTracking(), 500)
    }, [originalToggleCompletion, refreshIdealTracking])

    const runningTask = allTasks.find(t => t.id === logic.timer.runningTaskId)
    const defaultQuickCreateCalendarId =
        logic.calendars.find(c =>
            c.selected && (c.access_level === 'owner' || c.access_level === 'writer')
        )?.google_calendar_id
        ?? logic.writableCalendars[0]?.id
        ?? null
    const showSideTaskForm = !!(isTaskFormOpen && onCreateQuickTask && activeTab === 'today' && logic.timelineMode === 'calendar')
    const showBottomTaskForm = !!(isTaskFormOpen && onCreateQuickTask && !showSideTaskForm)
    const draftCalendarColor = taskFormDraft?.calendarId
        ? logic.writableCalendars.find(c => c.id === taskFormDraft.calendarId)?.background_color
        : undefined
    const draftPreview = taskFormDraft?.scheduledDate
        ? {
            title: taskFormDraft.title?.trim() || '新しい予定',
            startTime: taskFormDraft.scheduledDate,
            endTime: new Date(taskFormDraft.scheduledDate.getTime() + Math.max(15, taskFormDraft.estimatedTime || 30) * 60 * 1000),
            color: draftCalendarColor || '#F97316',
        }
        : null

    return (
        <div ref={panelRef} className="h-full flex flex-col bg-background/50 backdrop-blur-sm border-l border-border/30 relative overflow-hidden">

            {/* ① Header: date nav + add button + mode toggle */}
            <div className="flex-shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-border/30 bg-background/80 gap-1">
                {/* Date navigation */}
                <div className="flex items-center gap-0.5 min-w-0 flex-1">
                    <button
                        onClick={logic.goToPrevDay}
                        className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground flex-shrink-0"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => logic.setCalendarOpen(prev => !prev)}
                        className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors text-sm font-semibold min-w-0",
                            logic.calendarOpen ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                        )}
                    >
                        <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">
                            {logic.isToday ? `今日 · ${logic.dateFmt}` : logic.dateFmt}
                        </span>
                    </button>
                    <button
                        onClick={logic.goToNextDay}
                        className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground flex-shrink-0"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Sync indicator + mode toggle */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    <div className="w-4 h-4 flex items-center justify-center" aria-hidden={logic.syncState === 'idle'}>
                        {logic.syncState === 'syncing' ? (
                            <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                        ) : logic.syncState === 'done' ? (
                            <Check className="w-3 h-3 text-green-500" />
                        ) : null}
                    </div>
                    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                        <button
                            onClick={() => logic.setTimelineMode('calendar')}
                            className={cn(
                                "p-1 rounded transition-colors",
                                logic.timelineMode === 'calendar'
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground"
                            )}
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => logic.setTimelineMode('cards')}
                            className={cn(
                                "p-1 rounded transition-colors",
                                logic.timelineMode === 'cards'
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground"
                            )}
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-shrink-0 border-b border-border/20 px-3 py-1.5 bg-background/70">
                <div className="inline-flex items-center rounded-md bg-muted p-0.5 gap-0.5">
                    <button
                        onClick={() => setActiveTab('today')}
                        className={cn(
                            "px-2.5 py-1 text-xs rounded transition-colors",
                            activeTab === 'today'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        Today
                    </button>
                    <button
                        onClick={() => setActiveTab('inbox')}
                        className={cn(
                            "px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1",
                            activeTab === 'inbox'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Inbox className="w-3.5 h-3.5" />
                        Inbox
                        <span className="text-[10px] tabular-nums">({logic.unscheduledTasks.length})</span>
                    </button>
                </div>
            </div>

            {/* ② Collapsible mini-calendar */}
            {activeTab === 'today' && logic.calendarOpen && (
                <div className="flex-shrink-0 border-b border-border/30 px-3 py-2 bg-background/60 animate-in slide-in-from-top-2 duration-200">
                    <SimpleCalendar
                        selected={logic.selectedDate}
                        onSelect={logic.handleDateSelect}
                        month={logic.calendarMonth}
                        onMonthChange={logic.setCalendarMonth}
                        className="w-full"
                    />
                </div>
            )}

            {/* ③ Habit Bar */}
            {activeTab === 'today' && logic.habitsLoading ? (
                <div className="flex-shrink-0 border-b border-border/30 bg-background/40 px-3 py-1.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <Target className="w-3 h-3 text-primary/40 flex-shrink-0" />
                        <span className="text-[10px] font-medium text-muted-foreground/40">主の習慣</span>
                    </div>
                    <div className="flex gap-1.5">
                        {[60, 80, 68].map((w, i) => (
                            <div
                                key={i}
                                className="h-7 rounded-full bg-muted/50 animate-pulse flex-shrink-0"
                                style={{ width: w, animationDelay: `${i * 0.1}s` }}
                            />
                        ))}
                    </div>
                </div>
            ) : activeTab === 'today' && logic.dateHabits.length > 0 ? (
                <div className="flex-shrink-0 border-b border-border/30 bg-background/40">
                    <div className="px-3 py-1.5">
                        <button
                            onClick={() => logic.setHabitsExpanded(prev => !prev)}
                            className="flex items-center gap-1.5 mb-1.5 w-full text-left"
                        >
                            <Target className="w-3 h-3 text-primary flex-shrink-0" />
                            <span className="text-[10px] font-medium text-muted-foreground flex-1">
                                {logic.isToday ? '今日の習慣' : `${format(logic.selectedDate, 'M/d', { locale: ja })}の習慣`}
                            </span>
                            <span className="text-[10px] text-muted-foreground mr-1">
                                {logic.doneHabitCount}/{logic.dateHabits.length}
                            </span>
                            {logic.habitsExpanded
                                ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                            }
                        </button>

                        {/* Habit pills */}
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                            {logic.dateHabits.map(item => {
                                const hasChildren = item.childTasks.length > 0
                                const isCompleted = logic.isToday
                                    ? item.isCompletedToday
                                    : item.completions.some(c => c.completed_date === logic.selectedDateStr)
                                const doneChildCount = hasChildren
                                    ? item.childTasks.filter(c =>
                                        item.taskCompletions.some(tc => tc.task_id === c.id && tc.completed_date === logic.selectedDateStr)
                                    ).length
                                    : 0
                                return (
                                    <button
                                        key={item.habit.id}
                                        onClick={() => {
                                            if (hasChildren) {
                                                logic.setHabitsExpanded(true)
                                                logic.setExpandedHabitId(prev => prev === item.habit.id ? null : item.habit.id)
                                                return
                                            }
                                            if (logic.isToday) wrappedToggleCompletion(item.habit.id)
                                        }}
                                        className={cn(
                                            "flex items-center gap-1 px-2 py-1 rounded-full transition-all flex-shrink-0 border text-[11px]",
                                            !hasChildren && logic.isToday && "active:scale-[0.98]",
                                            isCompleted
                                                ? "bg-primary/10 border-primary/30"
                                                : !hasChildren && logic.isToday
                                                    ? "border-border hover:bg-muted/40"
                                                    : "border-border"
                                        )}
                                    >
                                        {isCompleted
                                            ? <CheckSquare className={cn("w-3 h-3 flex-shrink-0", hasChildren ? "text-primary/50" : "text-primary")} />
                                            : <Square className={cn("w-3 h-3 flex-shrink-0", hasChildren ? "text-muted-foreground/20" : "text-muted-foreground/40")} />
                                        }
                                        <span className="text-xs flex-shrink-0">{item.habit.habit_icon || '🔄'}</span>
                                        <span className="flex flex-col leading-tight">
                                            <span className={cn(
                                                "whitespace-nowrap",
                                                isCompleted ? "text-primary font-medium line-through" : "text-foreground"
                                            )}>
                                                {item.habit.title}
                                            </span>
                                            {habitIdealMap.get(item.habit.id) && (
                                                <span className="text-[8px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                                                    {habitIdealMap.get(item.habit.id)}
                                                </span>
                                            )}
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
                    {logic.habitsExpanded && (
                        <div className="px-3 pb-2 space-y-0.5 animate-in slide-in-from-top-2 duration-200">
                            {(() => {
                                const expandedHabit = logic.dateHabits.find(h => h.habit.id === logic.expandedHabitId && h.childTasks.length > 0)
                                if (!expandedHabit) {
                                    return (
                                        <div className="px-2 py-1 text-[11px] text-muted-foreground">
                                            習慣をタップすると小タスクを表示できます
                                        </div>
                                    )
                                }

                                return (
                                    <div key={expandedHabit.habit.id} className="space-y-0">
                                        {expandedHabit.childTasks.map(child => {
                                            const isRunning = logic.isToday && logic.timer.runningTaskId === child.id
                                            const isDoneForDate = expandedHabit.taskCompletions.some(
                                                tc => tc.task_id === child.id && tc.completed_date === logic.selectedDateStr
                                            )
                                            const todayCompletion = expandedHabit.taskCompletions.find(
                                                tc => tc.task_id === child.id && tc.completed_date === logic.selectedDateStr
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
                                                    {logic.isToday ? (
                                                        <button
                                                            className="flex items-center gap-1.5 flex-1 min-w-0 py-1 px-2 rounded-md hover:bg-muted/50 transition-colors"
                                                            onClick={() => logic.toggleChildTask(child.id, child.status || 'todo', expandedHabit)}
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

                                                    {/* Timer control */}
                                                    {logic.isToday && (
                                                        <button
                                                            onClick={() => {
                                                                if (isRunning) logic.timer.pauseTimer()
                                                                else {
                                                                    const taskObj = allTasks.find(t => t.id === child.id)
                                                                    if (taskObj) logic.timer.startTimer(taskObj)
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
                            })()}
                        </div>
                    )}
                </div>
            ) : null}

            {/* ④ 理想の今日の進捗 */}
            {activeTab === 'today' && todaySummary && todaySummary.totalCount > 0 && (
                <div className="flex-shrink-0 border-b border-border/30 bg-background/40 px-3 py-1.5">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        <span className="text-[10px] font-medium text-muted-foreground flex-1">
                            理想の進捗
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            {todaySummary.completedCount}/{todaySummary.totalCount}
                        </span>
                    </div>
                    {/* アイテム単位のチェックリスト */}
                    <div className="space-y-0.5">
                        {todaySummary.items.map(item => {
                            const isCompleted = item.completionStatus === 'completed'
                            const isHabitSource = item.source === 'habit'
                            return (
                                <button
                                    key={item.idealItem.id}
                                    onClick={() => {
                                        if (!isHabitSource) {
                                            toggleItemCompletion(item.idealItem.id, todayStr)
                                        }
                                    }}
                                    disabled={isHabitSource}
                                    className={cn(
                                        "w-full flex items-center gap-1.5 py-0.5 rounded transition-colors text-left",
                                        !isHabitSource && "hover:bg-muted/40 active:bg-muted/60"
                                    )}
                                >
                                    {isCompleted
                                        ? <CheckSquare className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                        : <Square className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                                    }
                                    <span className={cn(
                                        "text-[11px] flex-1 truncate",
                                        isCompleted && "line-through text-muted-foreground"
                                    )}>
                                        {item.idealItem.title}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/50 flex-shrink-0">
                                        {item.idealGoalTitle}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* ⑤ Timeline content */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
                {/* Schedule summary */}
                <div className="flex-shrink-0 px-3 py-1 border-b border-border/20">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        {activeTab === 'today' && logic.eventsLoading ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /><span>取得中...</span></>
                        ) : activeTab === 'inbox' ? (
                            <>{logic.unscheduledTasks.length}件の未スケジュール</>
                        ) : (
                            <>
                                {logic.displayItems.length}件のスケジュール
                                {logic.dateHabits.length > 0 && ` · ${logic.doneHabitCount}/${logic.dateHabits.length} 習慣完了`}
                            </>
                        )}
                    </p>
                </div>
                <div className="relative flex-1 min-h-0">
                    {activeTab === 'inbox' ? (
                        <div className="h-full overflow-y-auto no-scrollbar px-3 py-2">
                            {logic.unscheduledTasks.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                                    Inbox は空です
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {logic.unscheduledTasks.map(task => (
                                        <div
                                            key={task.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => logic.openTaskEditModal(task.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    logic.openTaskEditModal(task.id)
                                                }
                                            }}
                                            className="w-full text-left flex items-center justify-between gap-2 px-2 py-2 rounded-md border border-border/50 bg-background/60 hover:bg-muted/40 transition-colors"
                                        >
                                            <span className="text-sm truncate flex-1">{task.title}</span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    logic.handleDeleteTask(task.id)
                                                }}
                                                className="p-1 rounded-md text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                                aria-label={`${task.title}を削除`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                    <div className={cn("h-full min-h-0 flex flex-col transition-all duration-200", showSideTaskForm && "pl-[352px]")}>
                {/* Calendar Connection Required */}
                {!logic.eventsLoading && !logic.calendarsLoading && logic.calendars.length === 0 && (
                    <div className="mx-3 mt-2 py-3 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                        <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                            カレンダーに接続されていません
                        </p>
                        <p className="text-[10px] text-blue-700 dark:text-blue-300 mt-1">
                            Googleカレンダーと連携すると、予定を自動で表示できます
                        </p>
                        <button
                            onClick={() => window.location.href = '/api/calendar/connect'}
                            className="mt-2 px-2.5 py-1 text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                        >
                            カレンダーを接続
                        </button>
                    </div>
                )}

                {/* Calendar Events Error */}
                {logic.eventsError && logic.calendars.length > 0 && (
                    <div className="mx-3 mt-2 py-3 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                            カレンダーデータの取得に失敗しました
                        </p>
                        <div className="mt-2 flex gap-2">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-2.5 py-1 text-[10px] font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors"
                            >
                                再読み込み
                            </button>
                            <button
                                onClick={() => window.location.href = logic.calendarReauthUrl}
                                className="px-2.5 py-1 text-[10px] font-medium bg-white dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-50 transition-colors"
                            >
                                再接続
                            </button>
                        </div>
                    </div>
                )}

                {/* Timeline */}
                {logic.timelineMode === 'calendar' ? (
                    <TodayTimelineCalendar
                        timelineItems={logic.displayItems}
                        allDayEvents={logic.displayAllDayEvents}
                        eventsLoading={logic.eventsLoading}
                        currentTime={logic.currentTime}
                        onToggleTask={logic.toggleTask}
                        onItemTap={logic.handleItemTap}
                        onDragDrop={logic.handleDragDrop}
                        childTasksMap={logic.childTasksMap}
                        onCreateSubTask={logic.onCreateSubTask}
                        onDeleteSubTask={logic.handleDeleteTask}
                        projectNameMap={logic.projectNameMap}
                        initialScrollTop={scrollPositionRef.current}
                        onScrollPositionChange={(pos) => { scrollPositionRef.current = pos }}
                        onQuickCreateTask={onCreateQuickTask}
                        defaultQuickCreateCalendarId={defaultQuickCreateCalendarId}
                        draftPreview={draftPreview}
                        onQuickCreateRangeSelect={({ scheduledAt, estimatedTime }) => {
                            setTaskFormPreset({ scheduledDate: scheduledAt, estimatedTime })
                            setTaskFormDraft({
                                title: '',
                                scheduledDate: scheduledAt,
                                estimatedTime,
                                calendarId: defaultQuickCreateCalendarId,
                            })
                            setIsTaskFormOpen(true)
                        }}
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <TodayTimelineCards
                            timelineItems={logic.displayItems}
                            allDayEvents={logic.displayAllDayEvents}
                            eventsLoading={logic.eventsLoading}
                            currentTime={logic.currentTime}
                            onToggleTask={logic.toggleTask}
                            onItemTap={logic.handleItemTap}
                            projectNameMap={logic.projectNameMap}
                        />
                    </div>
                )}
                    </div>
                    )}

                    {showSideTaskForm && onCreateQuickTask && (
                        <div className="absolute inset-y-0 left-0 z-20 w-[352px] border-r border-border/30 bg-background/95">
                            <PanelQuickTaskForm
                                variant="side-panel"
                                projects={projects}
                                calendars={logic.writableCalendars}
                                onCreateTask={async (data) => {
                                    await onCreateQuickTask(data)
                                    setTaskFormPreset(null)
                                    setTaskFormDraft(null)
                                    setIsTaskFormOpen(false)
                                }}
                                isOpen={true}
                                onClose={() => {
                                    setTaskFormPreset(null)
                                    setTaskFormDraft(null)
                                    setIsTaskFormOpen(false)
                                }}
                                initialScheduledDate={taskFormPreset?.scheduledDate ?? null}
                                initialEstimatedTime={taskFormPreset?.estimatedTime}
                                initialCalendarId={defaultQuickCreateCalendarId}
                                onDraftChange={setTaskFormDraft}
                            />
                        </div>
                    )}
                </div>

            </div>

            {/* Edit Modal (shared with mobile for consistent UX) */}
            <MobileEventEditModal
                target={logic.editTarget}
                isOpen={logic.isEditModalOpen}
                onClose={logic.handleCloseEditModal}
                onSaveTask={logic.handleSaveTask}
                onSaveEvent={logic.handleSaveEvent}
                onDeleteTask={logic.handleDeleteTask}
                onDeleteEvent={logic.handleDeleteEvent}
                availableCalendars={logic.writableCalendars}
                onScheduleReminder={async (targetType, targetId, scheduledAt, title, advanceMinutes) => {
                    await logic.cancelNotifications(targetType, targetId)
                    await logic.scheduleNotification({
                        targetType,
                        targetId,
                        notificationType: targetType === 'task' ? 'task_start' : 'event_start',
                        scheduledAt,
                        title: `リマインダー: ${title}`,
                        body: `${advanceMinutes}分後に開始します`,
                    })
                }}
            />

            {/* Task form (opened from FAB) */}
            {showBottomTaskForm && onCreateQuickTask && (
                <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border/30 bg-background/95 backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-200">
                    <PanelQuickTaskForm
                        projects={projects}
                        calendars={logic.writableCalendars}
                        onCreateTask={async (data) => {
                            await onCreateQuickTask(data)
                            setTaskFormPreset(null)
                            setTaskFormDraft(null)
                            setIsTaskFormOpen(false)
                        }}
                        isOpen={true}
                        onClose={() => {
                            setTaskFormPreset(null)
                            setTaskFormDraft(null)
                            setIsTaskFormOpen(false)
                        }}
                        initialScheduledDate={taskFormPreset?.scheduledDate ?? null}
                        initialEstimatedTime={taskFormPreset?.estimatedTime}
                        initialCalendarId={defaultQuickCreateCalendarId}
                        onDraftChange={setTaskFormDraft}
                    />
                </div>
            )}

            {/* Desktop Panel FAB */}
            {onCreateQuickTask && onOpenAiChat && !logic.isEditModalOpen && (
                <DesktopPanelFab
                    onOpenAiChat={onOpenAiChat}
                    onOpenTaskForm={() => {
                        setTaskFormPreset(null)
                        setTaskFormDraft({
                            title: '',
                            scheduledDate: null,
                            estimatedTime: 30,
                            calendarId: defaultQuickCreateCalendarId,
                        })
                        setIsTaskFormOpen(true)
                    }}
                    isTaskFormOpen={isTaskFormOpen}
                />
            )}
        </div>
    )
}
