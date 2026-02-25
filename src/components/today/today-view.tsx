"use client"

import { useRef } from "react"
import { Task, Project } from "@/types/database"
import {
    Square, CheckSquare, Target, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    LayoutGrid, List, Flame, Play, Pause, RefreshCw, Check, CalendarDays, Loader2
} from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TodayTimelineCards } from "./today-timeline-cards"
import { TodayTimelineCalendar } from "./today-timeline-calendar"
import { MobileEventEditModal } from "./mobile-event-edit-modal"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { QuickTaskFab, type QuickTaskData } from "./quick-task-fab"
import { useTodayViewLogic } from "@/hooks/useTodayViewLogic"
import { formatTime } from "@/contexts/TimerContext"

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

    const logic = useTodayViewLogic({
        allTasks,
        onUpdateTask,
        projects,
        onCreateSubTask,
        onDeleteTask,
    })

    // Swipe left/right to change date
    useSwipeNavigation({
        containerRef: timelineContainerRef,
        onSwipeLeft: logic.goToNextDay,
        onSwipeRight: logic.goToPrevDay,
    })

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
            {/* Date Header + Mode Toggle */}
            <div className="flex-shrink-0 px-4 py-2 border-b" style={{ touchAction: 'none' }}>
                <div className="flex items-center justify-between gap-2 min-h-[56px]">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <button
                            onClick={logic.goToPrevDay}
                            className="p-1 rounded-full active:bg-muted transition-colors text-muted-foreground flex-shrink-0"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                {logic.isToday && (
                                    <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none flex-shrink-0">
                                        今日
                                    </span>
                                )}
                                <h1 className="text-lg font-bold leading-tight truncate whitespace-nowrap">{logic.dateFmt}</h1>
                                <button
                                    onClick={() => logic.setCalendarOpen(prev => !prev)}
                                    className={cn(
                                        "p-1 rounded-md transition-colors flex-shrink-0",
                                        logic.calendarOpen
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <CalendarDays className="w-4 h-4" />
                                </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate whitespace-nowrap min-h-[16px]">
                                {logic.eventsLoading ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /><span>取得中...</span></>
                                ) : (
                                    <>
                                        {logic.displayItems.length}件のスケジュール
                                        {logic.dateHabits.length > 0 && ` · ${logic.doneHabitCount}/${logic.dateHabits.length} 習慣完了`}
                                    </>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={logic.goToNextDay}
                            className="p-1 rounded-full active:bg-muted transition-colors text-muted-foreground flex-shrink-0"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    {/* Sync indicator + Timeline mode toggle */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="w-4 h-4 flex items-center justify-center text-xs text-muted-foreground" aria-hidden={logic.syncState === 'idle'}>
                            {logic.syncState === 'syncing' ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                            ) : logic.syncState === 'done' ? (
                                <Check className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                                <span className="opacity-0">•</span>
                            )}
                        </div>
                        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                            <button
                                onClick={() => logic.setTimelineMode('calendar')}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    logic.timelineMode === 'calendar'
                                        ? "bg-background shadow-sm text-foreground"
                                        : "text-muted-foreground"
                                )}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => logic.setTimelineMode('cards')}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    logic.timelineMode === 'cards'
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
            {logic.calendarOpen && (
                <div className="flex-shrink-0 border-b px-4 py-3 animate-in slide-in-from-top-2 duration-200">
                    <SimpleCalendar
                        selected={logic.selectedDate}
                        onSelect={logic.handleDateSelect}
                        month={logic.calendarMonth}
                        onMonthChange={logic.setCalendarMonth}
                        className="w-full"
                    />
                </div>
            )}

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
                                        <span className={cn(
                                            "text-xs whitespace-nowrap",
                                            isCompleted
                                                ? "text-primary font-medium line-through"
                                                : "text-foreground"
                                        )}>
                                            {item.habit.title}
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
                                    onClick={() => window.location.href = '/api/calendar/connect'}
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
                            initialScrollTop={logic.scrollPositionRef.current}
                            onScrollPositionChange={(pos) => { logic.scrollPositionRef.current = pos }}
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
                            <div className="h-4" />
                        </div>
                    )}
                </div>
            </div>

            {/* Unscheduled Tasks */}
            {logic.unscheduledTasks.length > 0 && (
                <div className="flex-shrink-0 border-t px-4 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">未スケジュール</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {logic.unscheduledTasks.map(task => (
                            <div key={task.id} className="flex items-center gap-2 py-1.5 px-1 rounded-md active:bg-muted/50 transition-colors">
                                <button
                                    className="flex-shrink-0"
                                    onClick={() => logic.toggleTask(task.id)}
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

            {/* Quick Task FAB */}
            {onCreateQuickTask && (
                <QuickTaskFab
                    projects={projects}
                    calendars={logic.writableCalendars}
                    onCreateTask={onCreateQuickTask}
                    onOpenAiChat={onOpenAiChat}
                />
            )}
        </div>
    )
}
