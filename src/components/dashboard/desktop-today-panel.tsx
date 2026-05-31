"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Task, Project } from "@/types/database"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    List, Flame, Play, Pause, RefreshCw, Check, Loader2
} from "lucide-react"
import { addDays, addMonths, format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TodayTimelineCalendar } from "@/components/today/today-timeline-calendar"
import { TodayTimelineCards } from "@/components/today/today-timeline-cards"
import { Today3DaysCalendar } from "@/components/today/today-3days-calendar"
import { TodayMonthCalendar } from "@/components/today/today-month-calendar"
import { MobileEventEditModal } from "@/components/today/mobile-event-edit-modal"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { useTodayViewLogic } from "@/hooks/useTodayViewLogic"
import { formatTime } from "@/contexts/TimerContext"
import { type QuickTaskData } from "@/components/today/quick-task-fab"
import { PanelQuickTaskForm } from "@/components/dashboard/panel-quick-task-form"
import { DesktopPanelFab } from "@/components/dashboard/desktop-panel-fab"
import { useTrackpadNavigation } from "@/hooks/useTrackpadNavigation"
import { useClickOutside } from "@/hooks/useClickOutside"
import { countScheduleItemsForDateRange, countScheduleItemsForMonth } from "@/lib/today-range-blocks"

// --- Types ---

interface DesktopTodayPanelProps {
    allTasks: Task[]
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    projects?: Project[]
    selectedProjectId?: string | null
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onOpenAiChat?: () => void
    syncFailedIds?: Set<string>
    calendarScrollToHour?: number
    calendarScrollRequestKey?: number
}

// --- Component ---

export function DesktopTodayPanel({
    allTasks,
    onUpdateTask,
    projects = [],
    selectedProjectId = null,
    onCreateQuickTask,
    onCreateSubTask,
    onDeleteTask,
    onOpenAiChat,
    syncFailedIds,
    calendarScrollToHour,
    calendarScrollRequestKey,
}: DesktopTodayPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null)
    const calendarAreaRef = useRef<HTMLDivElement>(null)
    const [isTaskFormOpen, setIsTaskFormOpen] = useState(false)
    const [taskFormPreset, setTaskFormPreset] = useState<{ scheduledDate: Date; estimatedTime: number } | null>(null)
    const [taskFormDraft, setTaskFormDraft] = useState<{
        title: string
        scheduledDate: Date | null
        estimatedTime: number
        calendarId: string | null
    } | null>(null)
    const [calendarRangeMode, setCalendarRangeMode] = useState<'day' | '3days' | 'month'>('day')

    const logic = useTodayViewLogic({
        allTasks,
        onUpdateTask,
        projects,
        selectedProjectId,
        onCreateSubTask,
        onDeleteTask,
    })
    const {
        calendarMonth,
        calendarOpen,
        calendarReauthUrl,
        calendars,
        cancelNotifications,
        childTasksMap,
        currentTime,
        dateFmt,
        dateHabits,
        displayAllDayEvents,
        displayItems,
        doneHabitCount,
        editTarget,
        allFetchedEvents,
        eventsError,
        eventsLoading,
        expandedHabitId,
        goToNextDay,
        goToPrevDay,
        habitsExpanded,
        habitsLoading,
        handleCloseEditModal,
        handleDateSelect,
        handleDeleteEvent,
        handleDeleteTask,
        handleDragDrop,
        handleItemTap,
        handleSaveEvent,
        handleSaveTask,
        isEditModalOpen,
        isToday,
        onCreateSubTask: logicOnCreateSubTask,
        projectNameMap,
        scheduleNotification,
        scrollPositionRef,
        selectedDate,
        selectedDateStr,
        setSelectedDate,
        setCalendarMonth,
        setCalendarOpen,
        setExpandedHabitId,
        setHabitsExpanded,
        setTimelineMode,
        syncState,
        timelineMode,
        timer,
        toggleChildTask,
        toggleCompletion,
        toggleEventCompletion,
        toggleTask,
        handleConvertEventToMemo,
        handleConvertCalendarPayloadToMemo,
        writableCalendars,
        visibleTasks,
        stableCalendarColorMap,
    } = logic
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
    const handleRangeNavigateLeft = useCallback(() => {
        if (calendarRangeMode === 'month') {
            moveSelectedDateByMonths(1)
            return
        }
        if (calendarRangeMode === '3days') {
            moveSelectedDateByDays(3)
            return
        }
        goToNextDay()
    }, [calendarRangeMode, goToNextDay, moveSelectedDateByDays, moveSelectedDateByMonths])
    const handleRangeNavigateRight = useCallback(() => {
        if (calendarRangeMode === 'month') {
            moveSelectedDateByMonths(-1)
            return
        }
        if (calendarRangeMode === '3days') {
            moveSelectedDateByDays(-3)
            return
        }
        goToPrevDay()
    }, [calendarRangeMode, goToPrevDay, moveSelectedDateByDays, moveSelectedDateByMonths])

    // Close calendar on outside click
    useClickOutside(calendarAreaRef, useCallback(() => setCalendarOpen(false), [setCalendarOpen]), calendarOpen)

    // 2-finger horizontal trackpad swipe for date navigation
    useTrackpadNavigation({
        containerRef: panelRef,
        onNavigateLeft: handleRangeNavigateLeft,
        onNavigateRight: handleRangeNavigateRight,
    })

    const defaultQuickCreateCalendarId =
        calendars.find(c =>
            c.selected && (c.access_level === 'owner' || c.access_level === 'writer')
        )?.google_calendar_id
        ?? writableCalendars[0]?.id
        ?? null
    const draftCalendarColor = taskFormDraft?.calendarId
        ? writableCalendars.find(c => c.id === taskFormDraft.calendarId)?.background_color
        : undefined
    const draftPreview = taskFormDraft?.scheduledDate
        ? {
            title: taskFormDraft.title?.trim() || '新しい予定',
            startTime: taskFormDraft.scheduledDate,
            endTime: new Date(taskFormDraft.scheduledDate.getTime() + Math.max(15, taskFormDraft.estimatedTime || 30) * 60 * 1000),
            color: draftCalendarColor || '#F97316',
        }
        : null
    const effectiveTimelineMode = calendarScrollRequestKey != null ? 'calendar' : timelineMode
    const showSideTaskForm = !!(calendarRangeMode === 'day' && isTaskFormOpen && onCreateQuickTask && effectiveTimelineMode === 'calendar')
    const showBottomTaskForm = !!(calendarRangeMode === 'day' && isTaskFormOpen && onCreateQuickTask && !showSideTaskForm)
    const rangeHeader = useMemo(() => {
        if (calendarRangeMode === '3days') {
            const rangeEnd = addDays(selectedDate, 2)
            const count = countScheduleItemsForDateRange({
                startDate: selectedDate,
                dayCount: 3,
                events: allFetchedEvents,
                tasks: visibleTasks,
                calendarColorMap: stableCalendarColorMap,
            })
            return {
                title: `${format(selectedDate, 'M/d(E)', { locale: ja })} - ${format(rangeEnd, 'M/d(E)', { locale: ja })}`,
                subtitle: `${count}件のスケジュール`,
            }
        }

        if (calendarRangeMode === 'month') {
            const count = countScheduleItemsForMonth({
                date: selectedDate,
                events: allFetchedEvents,
                tasks: visibleTasks,
                calendarColorMap: stableCalendarColorMap,
            })
            return {
                title: format(selectedDate, 'yyyy年M月', { locale: ja }),
                subtitle: `${count}件のスケジュール`,
            }
        }

        return {
            title: dateFmt,
            subtitle: `${displayItems.length}件のスケジュール${dateHabits.length > 0 ? ` · ${doneHabitCount}/${dateHabits.length} 習慣完了` : ''}`,
        }
    }, [
        allFetchedEvents,
        calendarRangeMode,
        dateFmt,
        dateHabits.length,
        displayItems.length,
        doneHabitCount,
        selectedDate,
        stableCalendarColorMap,
        visibleTasks,
    ])

    return (
        <div ref={panelRef} className="h-full flex flex-col bg-background/50 backdrop-blur-sm border-l border-border/30 relative overflow-hidden">

            {/* ① Header: left-aligned date nav + schedule count + mode toggle */}
            <div className="flex-shrink-0 border-b border-border/30 bg-background/80">
                <div className="flex items-start justify-between gap-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                            {calendarRangeMode === 'day' && (
                                <button
                                    type="button"
                                    onClick={goToPrevDay}
                                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                                    aria-label="前の日へ"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setCalendarOpen(prev => !prev)}
                                className={cn(
                                    "min-w-0 rounded-md px-1 py-0.5 text-left text-sm font-semibold leading-tight transition-colors",
                                    calendarOpen ? "bg-muted/70 text-foreground" : "hover:bg-muted/60"
                                )}
                                aria-label="日付を選択"
                            >
                                <span className="block truncate">{rangeHeader.title}</span>
                            </button>
                            {calendarRangeMode === 'day' && (
                                <button
                                    type="button"
                                    onClick={goToNextDay}
                                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                                    aria-label="次の日へ"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <p className="mt-1 flex min-h-[14px] min-w-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
                            {calendarRangeMode === 'day' && isToday && (
                                <span className="inline-flex flex-shrink-0 rounded border border-primary/25 bg-primary/10 px-1 py-0.5 text-[9px] font-semibold leading-none text-primary">
                                    Today
                                </span>
                            )}
                            {eventsLoading ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /><span>取得中...</span></>
                            ) : (
                                <span className="min-w-0 truncate">{rangeHeader.subtitle}</span>
                            )}
                        </p>
                    </div>

                    {/* Range + Day-only mode toggle */}
                    <div className="flex flex-shrink-0 items-start gap-1">
                        <div className="mt-1 flex h-4 w-4 items-center justify-center" aria-hidden={syncState === 'idle'}>
                            {syncState === 'syncing' ? (
                                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                            ) : syncState === 'done' ? (
                                <Check className="h-3 w-3 text-green-500" />
                            ) : null}
                        </div>
                        {calendarRangeMode === 'day' && (
                            <button
                                type="button"
                                onClick={() => setTimelineMode(effectiveTimelineMode === 'cards' ? 'calendar' : 'cards')}
                                className={cn(
                                    "grid h-8 w-8 place-items-center rounded-md border border-border/50 transition-colors",
                                    effectiveTimelineMode === 'cards'
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground hover:text-foreground active:bg-muted/70"
                                )}
                                aria-label={effectiveTimelineMode === 'cards' ? "通常表示に戻す" : "タイムライン表示"}
                                aria-pressed={effectiveTimelineMode === 'cards'}
                            >
                                <List className="h-3.5 w-3.5" />
                            </button>
                        )}
                        <div className="inline-flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
                            {(['day', '3days', 'month'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleCalendarRangeModeChange(mode)}
                                    aria-pressed={calendarRangeMode === mode}
                                    className={cn(
                                        "min-w-[52px] rounded-md px-1.5 py-1 text-[11px] font-semibold leading-5 transition-colors",
                                        calendarRangeMode === mode
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
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

            {/* ② Collapsible mini-calendar */}
            {calendarOpen && (
                <div ref={calendarAreaRef} className="flex-shrink-0 border-b border-border/30 px-3 py-2 bg-background/60 animate-in slide-in-from-top-2 duration-200">
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
            {habitsLoading ? (
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
            ) : dateHabits.length > 0 ? (
                <div className="flex-shrink-0 border-b border-border/30 bg-background/40">
                    <div className="px-3 py-1.5">
                        <button
                            onClick={() => setHabitsExpanded(prev => !prev)}
                            className="flex items-center gap-1.5 mb-1.5 w-full text-left"
                        >
                            <Target className="w-3 h-3 text-primary flex-shrink-0" />
                            <span className="text-[10px] font-medium text-muted-foreground flex-1">
                                {isToday ? '今日の習慣' : `${format(selectedDate, 'M/d', { locale: ja })}の習慣`}
                            </span>
                            <span className="text-[10px] text-muted-foreground mr-1">
                                {doneHabitCount}/{dateHabits.length}
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
                                        onClick={() => {
                                            if (hasChildren) {
                                                setHabitsExpanded(true)
                                                setExpandedHabitId(prev => prev === item.habit.id ? null : item.habit.id)
                                                return
                                            }
                                            if (isToday) toggleCompletion(item.habit.id)
                                        }}
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
                                        <span className="flex flex-col leading-tight">
                                            <span className={cn(
                                                "whitespace-nowrap",
                                                isCompleted ? "text-primary font-medium line-through" : "text-foreground"
                                            )}>
                                                {item.habit.title}
                                            </span>
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
                            {(() => {
                                const expandedHabit = dateHabits.find(h => h.habit.id === expandedHabitId && h.childTasks.length > 0)
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
                                            const isRunning = isToday && timer.runningTaskId === child.id
                                            const isDoneForDate = expandedHabit.taskCompletions.some(
                                                tc => tc.task_id === child.id && tc.completed_date === selectedDateStr
                                            )
                                            const todayCompletion = expandedHabit.taskCompletions.find(
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
                                                            className="flex items-center gap-1.5 flex-1 min-w-0 py-1 px-2 rounded-md hover:bg-muted/50 transition-colors"
                                                            onClick={() => toggleChildTask(child.id, child.status || 'todo', expandedHabit)}
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
                                                    {isToday && (
                                                        <button
                                                            onClick={() => {
                                                                if (isRunning) timer.pauseTimer()
                                                                else {
                                                                    const taskObj = allTasks.find(t => t.id === child.id)
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
                            })()}
                        </div>
                    )}
                </div>
            ) : null}

            {/* Timeline content */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
                <div className="relative flex-1 min-h-0">
                    <div className={cn("h-full min-h-0 flex flex-col transition-all duration-200", showSideTaskForm && "pl-[352px]")}>
                {/* Calendar Events Error */}
                {eventsError && calendars.length > 0 && (
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
                                onClick={() => window.location.href = calendarReauthUrl}
                                className="px-2.5 py-1 text-[10px] font-medium bg-white dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-50 transition-colors"
                            >
                                再接続
                            </button>
                        </div>
                    </div>
                )}

                {/* Timeline */}
                {calendarRangeMode === '3days' ? (
                    <Today3DaysCalendar
                        selectedDate={selectedDate}
                        events={allFetchedEvents}
                        tasks={visibleTasks}
                        calendarColorMap={stableCalendarColorMap}
                        eventsLoading={eventsLoading}
                        getInitialScrollTop={getTimelineInitialScrollTop}
                        onScrollPositionChange={handleTimelineScrollPositionChange}
                        onDateSelect={handleRangeDateSelect}
                        onItemTap={handleItemTap}
                    />
                ) : calendarRangeMode === 'month' ? (
                    <TodayMonthCalendar
                        selectedDate={selectedDate}
                        events={allFetchedEvents}
                        tasks={visibleTasks}
                        calendarColorMap={stableCalendarColorMap}
                        eventsLoading={eventsLoading}
                        onDateSelect={handleRangeDateSelect}
                    />
                ) : effectiveTimelineMode === 'calendar' ? (
                    <TodayTimelineCalendar
                        timelineItems={displayItems}
                        allDayEvents={displayAllDayEvents}
                        eventsLoading={eventsLoading}
                        currentTime={currentTime}
                        onToggleTask={toggleTask}
                        onToggleEvent={toggleEventCompletion}
                        onItemTap={handleItemTap}
                        onDragDrop={handleDragDrop}
                        childTasksMap={childTasksMap}
                        onCreateSubTask={logicOnCreateSubTask}
                        onDeleteSubTask={handleDeleteTask}
                        onCreateMemoFromEvent={handleConvertEventToMemo}
                        onCreateMemoFromCalendarPayload={handleConvertCalendarPayloadToMemo}
                        projectNameMap={projectNameMap}
                        getInitialScrollTop={getTimelineInitialScrollTop}
                        onScrollPositionChange={handleTimelineScrollPositionChange}
                        onQuickCreateTask={onCreateQuickTask}
                        defaultQuickCreateCalendarId={defaultQuickCreateCalendarId}
                        draftPreview={draftPreview}
                        selectedDate={selectedDate}
                        onQuickCreateRangeSelect={({ scheduledAt, estimatedTime }) => {
                            setTaskFormPreset({ scheduledDate: scheduledAt, estimatedTime })
                            setIsTaskFormOpen(true)
                        }}
                        syncFailedIds={syncFailedIds}
                        scrollToHourRequest={
                            calendarScrollToHour != null && calendarScrollRequestKey != null
                                ? { hour: calendarScrollToHour, requestKey: calendarScrollRequestKey }
                                : undefined
                        }
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        <TodayTimelineCards
                            timelineItems={displayItems}
                            allDayEvents={displayAllDayEvents}
                            eventsLoading={eventsLoading}
                            currentTime={currentTime}
                            onToggleTask={toggleTask}
                            onToggleEvent={toggleEventCompletion}
                            onItemTap={handleItemTap}
                            projectNameMap={projectNameMap}
                        />
                    </div>
                )}
                    </div>

                    {showSideTaskForm && onCreateQuickTask && (
                        <div className="absolute inset-y-0 left-0 z-20 w-[352px] border-r border-border/30 bg-background/95">
                            <PanelQuickTaskForm
                                variant="side-panel"
                                projects={projects}
                                calendars={writableCalendars}
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
                target={editTarget}
                isOpen={isEditModalOpen}
                onClose={handleCloseEditModal}
                onSaveTask={handleSaveTask}
                onSaveEvent={handleSaveEvent}
                onDeleteTask={handleDeleteTask}
                onDeleteEvent={handleDeleteEvent}
                availableCalendars={writableCalendars}
                onScheduleReminder={async (targetType, targetId, scheduledAt, title, advanceMinutes) => {
                    await cancelNotifications(targetType, targetId)
                    await scheduleNotification({
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
                        calendars={writableCalendars}
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
            {calendarRangeMode === 'day' && onCreateQuickTask && onOpenAiChat && !isEditModalOpen && (
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
