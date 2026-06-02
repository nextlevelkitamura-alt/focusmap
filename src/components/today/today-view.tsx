"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Task, Project } from "@/types/database"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp,
    List, Flame, Play, Pause, RefreshCw, Check, Loader2
} from "lucide-react"
import { addDays, addMonths, format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TodayTimelineCards } from "./today-timeline-cards"
import { TodayTimelineCalendar } from "./today-timeline-calendar"
import { Today3DaysCalendar } from "./today-3days-calendar"
import { TodayMonthCalendar } from "./today-month-calendar"
import { MobileEventEditModal } from "./mobile-event-edit-modal"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { QuickTaskFab, type QuickTaskData } from "./quick-task-fab"
import { useTodayViewLogic } from "@/hooks/useTodayViewLogic"
import { formatTime } from "@/contexts/TimerContext"
import { countScheduleItemsForDateRange, countScheduleItemsForMonth } from "@/lib/today-range-blocks"
import { startCalendarOAuth } from "@/lib/external-auth-launch"

// --- Types ---

interface TodayViewProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onOpenAiChat?: () => void
}

// --- Main Component ---

export function TodayView({ allTasks, onUpdateTask, projects = [], onCreateQuickTask, onCreateSubTask, onDeleteTask, onOpenAiChat }: TodayViewProps) {
    const timelineContainerRef = useRef<HTMLDivElement>(null)
    const [calendarRangeMode, setCalendarRangeMode] = useState<'day' | '3days' | 'month'>('day')

    const logic = useTodayViewLogic({
        allTasks,
        onUpdateTask,
        projects,
        onCreateSubTask,
        onDeleteTask,
    })
    const { scrollPositionRef } = logic
    const setSelectedDate = logic.setSelectedDate
    const getTimelineInitialScrollTop = useCallback(() => scrollPositionRef.current, [scrollPositionRef])
    const handleTimelineScrollPositionChange = useCallback((pos: number) => {
        scrollPositionRef.current = pos
    }, [scrollPositionRef])
    const handleCalendarRangeModeChange = useCallback((mode: 'day' | '3days' | 'month') => {
        setCalendarRangeMode(mode)
    }, [])
    const handleRangeDateSelect = useCallback((date: Date) => {
        const normalized = new Date(date)
        normalized.setHours(0, 0, 0, 0)
        setSelectedDate(normalized)
        handleCalendarRangeModeChange('day')
    }, [handleCalendarRangeModeChange, setSelectedDate])
    const moveSelectedDateByDays = useCallback((amount: number) => {
        setSelectedDate(prev => {
            const next = addDays(prev, amount)
            next.setHours(0, 0, 0, 0)
            return next
        })
    }, [setSelectedDate])
    const moveSelectedDateByMonths = useCallback((amount: number) => {
        setSelectedDate(prev => {
            const next = addMonths(prev, amount)
            next.setHours(0, 0, 0, 0)
            return next
        })
    }, [setSelectedDate])
    const handleRangeSwipeLeft = useCallback(() => {
        if (calendarRangeMode === 'month') {
            moveSelectedDateByMonths(1)
            return
        }
        if (calendarRangeMode === '3days') {
            moveSelectedDateByDays(1)
            return
        }
        logic.goToNextDay()
    }, [calendarRangeMode, logic, moveSelectedDateByDays, moveSelectedDateByMonths])
    const handleRangeSwipeRight = useCallback(() => {
        if (calendarRangeMode === 'month') {
            moveSelectedDateByMonths(-1)
            return
        }
        if (calendarRangeMode === '3days') {
            moveSelectedDateByDays(-1)
            return
        }
        logic.goToPrevDay()
    }, [calendarRangeMode, logic, moveSelectedDateByDays, moveSelectedDateByMonths])
    const rangeHeader = useMemo(() => {
        if (calendarRangeMode === '3days') {
            const rangeEnd = addDays(logic.selectedDate, 2)
            const count = countScheduleItemsForDateRange({
                startDate: logic.selectedDate,
                dayCount: 3,
                events: logic.allFetchedEvents,
                tasks: logic.visibleTasks,
                calendarColorMap: logic.stableCalendarColorMap,
            })
            return {
                title: `${format(logic.selectedDate, 'M/d(E)', { locale: ja })} - ${format(rangeEnd, 'M/d(E)', { locale: ja })}`,
                subtitle: `${count}件のスケジュール`,
            }
        }

        if (calendarRangeMode === 'month') {
            const count = countScheduleItemsForMonth({
                date: logic.selectedDate,
                events: logic.allFetchedEvents,
                tasks: logic.visibleTasks,
                calendarColorMap: logic.stableCalendarColorMap,
            })
            return {
                title: format(logic.selectedDate, 'yyyy年M月', { locale: ja }),
                subtitle: `${count}件のスケジュール`,
            }
        }

        return {
            title: logic.dateFmt,
            subtitle: `${logic.displayItems.length}件のスケジュール${logic.dateHabits.length > 0 ? ` · ${logic.doneHabitCount}/${logic.dateHabits.length} 習慣完了` : ''}`,
        }
    }, [
        calendarRangeMode,
        logic.allFetchedEvents,
        logic.dateFmt,
        logic.dateHabits.length,
        logic.displayItems.length,
        logic.doneHabitCount,
        logic.selectedDate,
        logic.stableCalendarColorMap,
        logic.visibleTasks,
    ])

    // Swipe left/right to change date
    useSwipeNavigation({
        containerRef: timelineContainerRef,
        onSwipeLeft: handleRangeSwipeLeft,
        onSwipeRight: handleRangeSwipeRight,
    })

    const defaultQuickCreateCalendarId =
        logic.calendars.find(c =>
            c.selected && (c.access_level === 'owner' || c.access_level === 'writer')
        )?.google_calendar_id
        ?? logic.writableCalendars[0]?.id
        ?? null

    // タイムライングリッドのクリック/ドラッグ → FABシート連携
    const [fabRangeSelect, setFabRangeSelect] = useState<{
        scheduledAt: Date
        estimatedTime: number
    } | null>(null)

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
            {/* Date Header + Mode Toggle */}
            <div className="flex-shrink-0 border-b px-4 py-1.5" style={{ touchAction: 'none' }}>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <h1 className="min-w-0 truncate whitespace-nowrap text-left text-lg font-bold leading-tight">
                                {rangeHeader.title}
                            </h1>
                        </div>
                        <p className="mt-0.5 flex min-h-[16px] min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                            {calendarRangeMode === 'day' && logic.isToday && (
                                <span className="inline-flex flex-shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                                    今日
                                </span>
                            )}
                            {logic.eventsLoading ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /><span>取得中...</span></>
                            ) : (
                                <span className="min-w-0 truncate">{rangeHeader.subtitle}</span>
                            )}
                        </p>
                    </div>
                    {/* Range + Day-only timeline mode toggle */}
                    <div className="flex flex-shrink-0 items-start gap-1">
                        <div className="mt-1 flex h-4 w-4 items-center justify-center text-xs text-muted-foreground" aria-hidden={logic.syncState === 'idle'}>
                            {logic.syncState === 'syncing' ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                            ) : logic.syncState === 'done' ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <span className="opacity-0">•</span>
                            )}
                        </div>
                        {calendarRangeMode === 'day' && (
                            <button
                                type="button"
                                onClick={() => logic.setTimelineMode(logic.timelineMode === 'cards' ? 'calendar' : 'cards')}
                                className={cn(
                                    "grid h-8 w-8 place-items-center rounded-md border border-border/50 transition-colors",
                                    logic.timelineMode === 'cards'
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground active:bg-muted/70"
                                )}
                                aria-label={logic.timelineMode === 'cards' ? "通常表示に戻す" : "タイムライン表示"}
                                aria-pressed={logic.timelineMode === 'cards'}
                            >
                                <List className="h-3.5 w-3.5" />
                            </button>
                        )}
                        <div className="inline-flex w-fit items-center rounded-lg bg-muted p-0.5 gap-0.5">
                            {(['day', '3days', 'month'] as const).map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => handleCalendarRangeModeChange(mode)}
                                    aria-pressed={calendarRangeMode === mode}
                                    className={cn(
                                        "min-w-[54px] rounded-md px-1.5 py-1 text-[11px] font-semibold leading-5 transition-colors",
                                        calendarRangeMode === mode
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground"
                                    )}
                                >
                                    {mode === 'day' && 'Day'}
                                    {mode === '3days' && '3days'}
                                    {mode === 'month' && 'Month'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Habit Bar (fixed) + Expandable Detail */}
            {logic.habitsLoading ? (
                <div className="flex-shrink-0 border-b px-4 py-2">
                    <div className="flex items-center gap-2 mb-1.5">
                        <Target className="w-3.5 h-3.5 text-primary/40 flex-shrink-0" />
                        <span className="text-xs font-medium text-muted-foreground/50">主の習慣</span>
                    </div>
                    <div className="flex gap-2">
                        {[72, 96, 84].map((w, i) => (
                            <div
                                key={i}
                                className="h-8 rounded-full bg-muted/50 animate-pulse flex-shrink-0"
                                style={{ width: w, animationDelay: `${i * 0.1}s` }}
                            />
                        ))}
                    </div>
                </div>
            ) : logic.dateHabits.length > 0 ? (
                <div className="flex-shrink-0 border-b max-h-[40vh] overflow-y-auto">
                    {/* Compact Habit Bar */}
                    <div className="px-4 py-2">
                        <button
                            onClick={() => logic.setHabitsExpanded(prev => !prev)}
                            className="flex items-center gap-2 mb-1.5 w-full text-left"
                        >
                            <Target className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <span className="text-xs font-medium text-muted-foreground flex-1">
                                {logic.isToday ? '今日の習慣' : `${format(logic.selectedDate, 'M/d', { locale: ja })}の習慣`}
                            </span>
                            {logic.habitsExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                        </button>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                            {logic.dateHabits.map(item => {
                                const hasChildren = item.childTasks.length > 0
                                const isCompleted = logic.isToday
                                    ? item.isCompletedToday
                                    : item.completions.some(c => c.completed_date === logic.selectedDateStr)
                                const doneChildCount = hasChildren
                                    ? item.childTasks.filter(c => item.taskCompletions.some(tc => tc.task_id === c.id && tc.completed_date === logic.selectedDateStr)).length
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
                                            if (logic.isToday) logic.toggleCompletion(item.habit.id)
                                        }}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all flex-shrink-0 border",
                                            !hasChildren && logic.isToday && "active:scale-[0.98]",
                                            isCompleted
                                                ? "bg-primary/10 border-primary/30 dark:bg-primary/15"
                                                : !hasChildren && logic.isToday
                                                    ? "border-border hover:bg-muted/40 active:bg-muted/60"
                                                    : "border-border"
                                        )}
                                    >
                                        {isCompleted ? (
                                            <CheckSquare className={cn("w-3.5 h-3.5 flex-shrink-0", hasChildren ? "text-primary/50" : "text-primary")} />
                                        ) : (
                                            <Square className={cn("w-3.5 h-3.5 flex-shrink-0", hasChildren ? "text-muted-foreground/20" : "text-muted-foreground/40")} />
                                        )}
                                        <span className="text-sm flex-shrink-0">{item.habit.habit_icon || '🔄'}</span>
                                        <span className="flex flex-col leading-tight">
                                            <span className={cn(
                                                "text-xs whitespace-nowrap",
                                                isCompleted
                                                    ? "text-primary font-medium line-through"
                                                    : "text-foreground"
                                            )}>
                                                {item.habit.title}
                                            </span>
                                        </span>
                                        {hasChildren && (
                                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                                {doneChildCount}/{item.childTasks.length}
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
                    {logic.habitsExpanded && (
                        <div className="px-4 pb-2 space-y-0.5 animate-in slide-in-from-top-2 duration-200">
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
                                            const hasElapsed = todayElapsed > 0
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
                                                            className="no-tap-highlight flex items-center gap-1.5 flex-1 min-w-0 py-1.5 px-2 rounded-md active:bg-muted/50 transition-colors"
                                                            onClick={() => logic.toggleChildTask(child.id, child.status || 'todo', expandedHabit)}
                                                        >
                                                            {isDoneForDate ? (
                                                                <CheckSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                                                            ) : (
                                                                <Square className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                                                            )}
                                                            <span className={cn(
                                                                "text-xs flex-1 truncate text-left",
                                                                isDoneForDate ? "line-through text-muted-foreground" : "text-foreground"
                                                            )}>
                                                                {child.title}
                                                            </span>
                                                        </button>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 px-2">
                                                            {isDoneForDate ? (
                                                                <CheckSquare className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
                                                            ) : (
                                                                <Square className="w-3.5 h-3.5 text-muted-foreground/20 flex-shrink-0" />
                                                            )}
                                                            <span className={cn(
                                                                "text-xs flex-1 truncate text-left",
                                                                isDoneForDate ? "line-through text-muted-foreground" : "text-foreground/70"
                                                            )}>
                                                                {child.title}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {logic.isToday && (
                                                        <>
                                                            {isRunning ? (
                                                                <span className="text-[10px] font-mono text-primary flex-shrink-0">
                                                                    {formatTime(todayElapsed + (logic.timer.currentElapsedSeconds - (child.total_elapsed_seconds ?? 0)))}
                                                                </span>
                                                            ) : hasElapsed ? (
                                                                <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                                                                    {formatTime(todayElapsed)}
                                                                </span>
                                                            ) : null}
                                                            <button
                                                                className={cn(
                                                                    "p-1.5 rounded-full flex-shrink-0",
                                                                    isRunning ? "text-primary bg-primary/10" : "text-muted-foreground/50 active:bg-muted/50"
                                                                )}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    if (isRunning) logic.timer.pauseTimer()
                                                                    else logic.timer.startTimer(child)
                                                                }}
                                                            >
                                                                {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                                            </button>
                                                        </>
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

            {/* Timeline Content (swipeable) */}
            <div ref={timelineContainerRef} className="flex-1 overflow-hidden flex flex-col">
                <div
                    key={logic.selectedDate.getTime()}
                    className={cn(
                        "flex-1 flex flex-col overflow-hidden",
                        logic.slideDirection === 'left' && "animate-in slide-in-from-right-12 duration-250",
                        logic.slideDirection === 'right' && "animate-in slide-in-from-left-12 duration-250"
                    )}
                    onAnimationEnd={() => logic.setSlideDirection(null)}
                >
                    {/* Calendar Connection Required */}
                    {!logic.eventsLoading && !logic.calendarsLoading && logic.calendars.length === 0 && (
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
                                    onClick={() => startCalendarOAuth()}
                                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                >
                                    カレンダーを接続
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Calendar Events Error */}
                    {logic.eventsError && logic.calendars.length > 0 && (
                        <div className="mx-4 mt-3 py-4 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                            <div className="flex items-start gap-2">
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                        カレンダーデータの取得に失敗しました
                                    </p>
                                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                        {logic.eventsError.message}
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
                                    onClick={() => window.location.href = logic.calendarReauthUrl}
                                    className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                                >
                                    再接続
                                </button>
                            </div>
                        </div>
                    )}

                    {calendarRangeMode === '3days' ? (
                        <Today3DaysCalendar
                            selectedDate={logic.selectedDate}
                            events={logic.allFetchedEvents}
                            tasks={logic.visibleTasks}
                            calendarColorMap={logic.stableCalendarColorMap}
                            eventsLoading={logic.eventsLoading}
                            getInitialScrollTop={getTimelineInitialScrollTop}
                            onScrollPositionChange={handleTimelineScrollPositionChange}
                            onDateSelect={handleRangeDateSelect}
                            onItemTap={logic.handleItemTap}
                        />
                    ) : calendarRangeMode === 'month' ? (
                        <TodayMonthCalendar
                            selectedDate={logic.selectedDate}
                            events={logic.allFetchedEvents}
                            tasks={logic.visibleTasks}
                            calendarColorMap={logic.stableCalendarColorMap}
                            eventsLoading={logic.eventsLoading}
                            onDateSelect={handleRangeDateSelect}
                        />
                    ) : logic.timelineMode === 'calendar' ? (
                        <TodayTimelineCalendar
                            timelineItems={logic.displayItems}
                            allDayEvents={logic.displayAllDayEvents}
                            eventsLoading={logic.eventsLoading}
                            currentTime={logic.currentTime}
                            onToggleTask={logic.toggleTask}
                            onToggleEvent={logic.toggleEventCompletion}
                            onItemTap={logic.handleItemTap}
                            onDragDrop={logic.handleDragDrop}
                            childTasksMap={logic.childTasksMap}
                            onCreateSubTask={logic.onCreateSubTask}
                            onDeleteSubTask={logic.handleDeleteTask}
                            projectNameMap={logic.projectNameMap}
                            getInitialScrollTop={getTimelineInitialScrollTop}
                            onScrollPositionChange={handleTimelineScrollPositionChange}
                            onQuickCreateTask={onCreateQuickTask}
                            defaultQuickCreateCalendarId={defaultQuickCreateCalendarId}
                            selectedDate={logic.selectedDate}
                            onQuickCreateRangeSelect={setFabRangeSelect}
                            onConvertEventAndStartTimer={logic.handleEventStartTimer}
                            onConvertEventAndExpand={logic.handleEventToggleExpand}
                            pendingExpandTaskId={logic.pendingExpandTaskId}
                        />
                    ) : (
                        <div className="flex-1 overflow-y-auto no-scrollbar">
                            <TodayTimelineCards
                                timelineItems={logic.displayItems}
                                allDayEvents={logic.displayAllDayEvents}
                                eventsLoading={logic.eventsLoading}
                                currentTime={logic.currentTime}
                                onToggleTask={logic.toggleTask}
                                onToggleEvent={logic.toggleEventCompletion}
                                onItemTap={logic.handleItemTap}
                                projectNameMap={logic.projectNameMap}
                            />
                            <div className="h-4" />
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal */}
            <MobileEventEditModal
                target={logic.editTarget}
                isOpen={logic.isEditModalOpen}
                onClose={logic.handleCloseEditModal}
                onSaveTask={logic.handleSaveTask}
                onSaveEvent={logic.handleSaveEvent}
                onDeleteTask={logic.handleDeleteTask}
                onDeleteEvent={logic.handleDeleteEvent}
                availableCalendars={logic.writableCalendars}
                onCreateSubTask={logic.onCreateSubTask}
                childTasks={logic.childTasksMap?.get(logic.editTarget?.taskId ?? '') ?? []}
                onToggleSubTask={logic.toggleTask}
                onConvertEventToTask={logic.handleConvertEventToTask}
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

            {/* Quick Task FAB */}
            {calendarRangeMode === 'day' && onCreateQuickTask && !logic.isEditModalOpen && (
                <QuickTaskFab
                    projects={projects}
                    calendars={logic.writableCalendars}
                    onCreateTask={onCreateQuickTask}
                    onOpenAiChat={onOpenAiChat}
                    externalOpen={!!fabRangeSelect}
                    onExternalOpenChange={(open) => { if (!open) setFabRangeSelect(null) }}
                    initialScheduledAt={fabRangeSelect?.scheduledAt}
                    initialEstimatedTime={fabRangeSelect?.estimatedTime}
                />
            )}
        </div>
    )
}
