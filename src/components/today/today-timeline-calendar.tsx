"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { Play, Pause, Check, Square, CheckSquare } from "lucide-react"
import { cn } from "@/lib/utils"

// --- Constants ---
const HOUR_HEIGHT = 56 // px per hour (slightly compact for mobile)
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DEFAULT_SCROLL_HOUR = 7 // scroll to 7am by default
const TOTAL_HEIGHT = HOUR_HEIGHT * 24

// --- Types ---
type TimelineItem =
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }

interface TodayTimelineCalendarProps {
    timelineItems: TimelineItem[]
    unscheduledTasks: Task[]
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
}

// --- Helpers ---
function getMinutesFromMidnight(date: Date): number {
    return date.getHours() * 60 + date.getMinutes()
}

function getTopPx(date: Date): number {
    return (getMinutesFromMidnight(date) / (24 * 60)) * TOTAL_HEIGHT
}

function getHeightPx(startDate: Date, endDate: Date): number {
    const durationMin = (endDate.getTime() - startDate.getTime()) / (1000 * 60)
    return Math.max((durationMin / (24 * 60)) * TOTAL_HEIGHT, HOUR_HEIGHT * 0.4) // min 40% of hour
}

// --- Main Component ---
export function TodayTimelineCalendar({
    timelineItems,
    unscheduledTasks,
    allDayEvents,
    eventsLoading,
    currentTime,
    onToggleTask,
}: TodayTimelineCalendarProps) {
    const timer = useTimer()
    const gridRef = useRef<HTMLDivElement>(null)
    const timeLabelRef = useRef<HTMLDivElement>(null)

    // Scroll to default hour on mount
    useEffect(() => {
        if (gridRef.current) {
            gridRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
        }
        if (timeLabelRef.current) {
            timeLabelRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
        }
    }, [])

    // Sync scroll between time labels and grid
    const handleGridScroll = () => {
        if (gridRef.current && timeLabelRef.current) {
            timeLabelRef.current.scrollTop = gridRef.current.scrollTop
        }
    }

    // Current time position
    const currentTimeTop = useMemo(() => getTopPx(currentTime), [currentTime])
    const isToday = useMemo(() => {
        const now = new Date()
        return currentTime.toDateString() === now.toDateString()
    }, [currentTime])

    // Calculate event layout (handle overlapping)
    const layoutItems = useMemo(() => {
        const items = timelineItems.map(item => ({
            ...item,
            top: getTopPx(item.startTime),
            height: getHeightPx(item.startTime, item.endTime),
        }))

        // Simple overlap detection: assign columns
        const result: (typeof items[number] & { column: number; totalColumns: number })[] = []
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const itemEnd = item.top + item.height

            // Find overlapping items already placed
            const overlapping = result.filter(r => {
                const rEnd = r.top + r.height
                return r.top < itemEnd && rEnd > item.top
            })

            const usedColumns = new Set(overlapping.map(r => r.column))
            let column = 0
            while (usedColumns.has(column)) column++

            result.push({ ...item, column, totalColumns: 1 })

            // Update totalColumns for all overlapping
            const group = [...overlapping, { ...item, column, totalColumns: 1 }]
            const maxCol = Math.max(...group.map(g => g.column)) + 1
            for (const r of result) {
                if (group.some(g => g === r || (g.type === r.type && (g.data as { id: string }).id === (r.data as { id: string }).id))) {
                    r.totalColumns = maxCol
                }
            }
        }

        return result
    }, [timelineItems])

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* All-day Events Bar */}
            {allDayEvents.length > 0 && (
                <div className="px-2 py-1.5 border-b bg-muted/20 flex-shrink-0">
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                        {allDayEvents.map(event => (
                            <div
                                key={event.id}
                                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
                            >
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                                <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 truncate max-w-32">
                                    {event.title}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Active Timer Banner */}
            {timer.runningTask && (
                <div className="mx-2 mt-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 dark:bg-primary/10 dark:border-primary/30 flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                            <span className="text-xs font-medium truncate">{timer.runningTask.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <span className="text-sm font-mono font-bold text-primary tabular-nums">
                                {formatTime(timer.currentElapsedSeconds)}
                            </span>
                            <button
                                onClick={() => timer.pauseTimer()}
                                aria-label="タイマーを一時停止"
                                className="p-1 rounded-full bg-primary/10 active:bg-primary/20 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                            >
                                <Pause className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => timer.completeTimer()}
                                aria-label="タスクを完了"
                                className="p-1 rounded-full bg-green-500/10 active:bg-green-500/20 text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                            >
                                <Check className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Calendar Day Grid */}
            <div className="flex flex-1 overflow-hidden">
                {/* Time Labels */}
                <div
                    ref={timeLabelRef}
                    className="w-12 flex-shrink-0 overflow-hidden"
                >
                    <div className="relative" style={{ height: TOTAL_HEIGHT }}>
                        {HOURS.map((hour) => (
                            <div
                                key={hour}
                                className="absolute w-full flex justify-end pr-2 text-[10px] font-medium text-muted-foreground/70"
                                style={{ top: hour * HOUR_HEIGHT - 6 }}
                            >
                                {hour !== 0 && `${hour}:00`}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main Grid */}
                <div
                    ref={gridRef}
                    className="flex-1 overflow-y-auto overflow-x-hidden"
                    onScroll={handleGridScroll}
                >
                    <div className="relative" style={{ height: TOTAL_HEIGHT }}>
                        {/* Hour Grid Lines */}
                        {HOURS.map((hour) => (
                            <div
                                key={`grid-${hour}`}
                                className="absolute w-full border-t border-border/20"
                                style={{ top: hour * HOUR_HEIGHT }}
                            />
                        ))}

                        {/* Half-hour dashed lines */}
                        {HOURS.map((hour) => (
                            <div
                                key={`half-${hour}`}
                                className="absolute w-full border-t border-border/10 border-dashed"
                                style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                            />
                        ))}

                        {/* Current Time Indicator */}
                        {isToday && (
                            <div
                                className="absolute z-30 w-full flex items-center pointer-events-none"
                                style={{ top: currentTimeTop }}
                            >
                                <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500 left-[-5px] shadow-lg shadow-red-500/30 z-40" />
                                <div className="h-[1.5px] bg-red-500 w-full opacity-70" />
                            </div>
                        )}

                        {/* Calendar Events & Tasks */}
                        {layoutItems.map((item) => {
                            const isEvent = item.type === 'event'
                            const id = isEvent ? (item.data as CalendarEvent).id : (item.data as Task).id

                            const leftPercent = (item.column / item.totalColumns) * 100
                            const widthPercent = (1 / item.totalColumns) * 100

                            return (
                                <div
                                    key={`${item.type}-${id}`}
                                    className="absolute z-20"
                                    style={{
                                        top: item.top,
                                        height: item.height,
                                        left: `calc(${leftPercent}% + 2px)`,
                                        width: `calc(${widthPercent}% - 4px)`,
                                    }}
                                >
                                    {isEvent ? (
                                        <EventBlock
                                            event={item.data as CalendarEvent}
                                            currentTime={currentTime}
                                            height={item.height}
                                        />
                                    ) : (
                                        <TaskBlock
                                            task={item.data as Task}
                                            currentTime={currentTime}
                                            startTime={item.startTime}
                                            endTime={item.endTime}
                                            height={item.height}
                                            timer={timer}
                                            onToggle={onToggleTask}
                                        />
                                    )}
                                </div>
                            )
                        })}

                        {/* Loading indicator */}
                        {eventsLoading && layoutItems.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground">読み込み中...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Unscheduled Tasks (below the grid) */}
            {unscheduledTasks.length > 0 && (
                <div className="flex-shrink-0 border-t bg-background px-3 py-2 max-h-40 overflow-y-auto">
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            未スケジュール
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted px-1 py-0.5 rounded-full">
                            {unscheduledTasks.length}
                        </span>
                    </div>
                    <div className="space-y-0.5">
                        {unscheduledTasks.slice(0, 5).map(task => (
                            <div
                                key={task.id}
                                className="flex items-center gap-2 py-1.5 px-1.5 rounded-md active:bg-muted/50"
                            >
                                <button onClick={() => onToggleTask(task.id)} className="flex-shrink-0">
                                    {task.status === 'done' ? (
                                        <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                    ) : (
                                        <Square className="w-3.5 h-3.5 text-muted-foreground" />
                                    )}
                                </button>
                                <span className={cn(
                                    "text-xs flex-1 truncate",
                                    task.status === 'done' && "line-through text-muted-foreground"
                                )}>
                                    {task.title}
                                </span>
                                {task.estimated_time > 0 && (
                                    <span className="text-[9px] text-muted-foreground">{task.estimated_time}分</span>
                                )}
                                {timer.runningTaskId !== task.id && (
                                    <button
                                        onClick={() => timer.startTimer(task)}
                                        className="p-1.5 rounded active:bg-muted text-muted-foreground"
                                    >
                                        <Play className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Event Block (Calendar event in the grid) ---
function EventBlock({
    event,
    currentTime,
    height,
}: {
    event: CalendarEvent
    currentTime: Date
    height: number
}) {
    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)
    const isNow = currentTime >= startTime && currentTime < endTime
    const isPast = currentTime >= endTime
    const isCompact = height < 40

    const startStr = startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

    return (
        <div className={cn(
            "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden cursor-default transition-colors",
            "bg-blue-50 dark:bg-blue-950/40 border-blue-400",
            isNow && "ring-1 ring-blue-400/50 bg-blue-100/80 dark:bg-blue-900/50",
            isPast && "opacity-40"
        )}>
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    <span className="text-[10px] text-blue-600 dark:text-blue-300 font-medium">{startStr}</span>
                    <span className="text-[11px] font-medium text-blue-800 dark:text-blue-200 truncate">{event.title}</span>
                </div>
            ) : (
                <>
                    <div className="text-[10px] text-blue-600 dark:text-blue-300 font-medium">{startStr}</div>
                    <div className="text-[11px] font-medium text-blue-800 dark:text-blue-200 truncate leading-tight mt-0.5">
                        {event.title}
                    </div>
                    {event.location && height > 55 && (
                        <div className="text-[9px] text-blue-500 dark:text-blue-400 truncate mt-0.5">
                            📍 {event.location}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// --- Task Block (Task in the grid) ---
function TaskBlock({
    task,
    currentTime,
    startTime,
    endTime,
    height,
    timer,
    onToggle,
}: {
    task: Task
    currentTime: Date
    startTime: Date
    endTime: Date
    height: number
    timer: ReturnType<typeof useTimer>
    onToggle: (taskId: string) => void
}) {
    const isNow = currentTime >= startTime && currentTime < endTime
    const isPast = currentTime >= endTime
    const isRunning = timer.runningTaskId === task.id
    const isDone = task.status === 'done'
    const isCompact = height < 40

    const startStr = startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

    return (
        <div className={cn(
            "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden transition-colors",
            isRunning
                ? "bg-primary/15 dark:bg-primary/10 border-primary ring-1 ring-primary/40 dark:ring-primary/30"
                : isDone
                    ? "bg-muted/30 border-muted-foreground/30"
                    : "bg-green-50 dark:bg-green-950/40 border-green-400",
            isNow && !isRunning && "ring-1 ring-green-400/50 bg-green-100/80 dark:bg-green-900/50",
            isPast && !isRunning && "opacity-40"
        )}>
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    <button
                        onClick={() => onToggle(task.id)}
                        aria-label={isDone ? `${task.title}を未完了に戻す` : `${task.title}を完了にする`}
                        className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                    >
                        {isDone ? (
                            <CheckSquare className="w-3 h-3 text-primary" />
                        ) : (
                            <Square className="w-3 h-3 text-green-600 dark:text-green-400" />
                        )}
                    </button>
                    <span className={cn(
                        "text-[11px] font-medium truncate",
                        isDone ? "line-through text-muted-foreground" : "text-green-800 dark:text-green-200"
                    )}>
                        {task.title}
                    </span>
                    <div className="ml-auto flex-shrink-0">
                        {isRunning ? (
                            <button
                                onClick={() => timer.pauseTimer()}
                                aria-label="タイマーを一時停止"
                                className="p-0.5 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                            >
                                <Pause className="w-3 h-3" />
                            </button>
                        ) : (
                            <button
                                onClick={() => timer.startTimer(task)}
                                aria-label={`${task.title}のタイマーを開始`}
                                className="p-0.5 text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                            >
                                <Play className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <button
                                onClick={() => onToggle(task.id)}
                                aria-label={isDone ? `${task.title}を未完了に戻す` : `${task.title}を完了にする`}
                                className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                            >
                                {isDone ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                ) : (
                                    <Square className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                )}
                            </button>
                            <span className={cn(
                                "text-[11px] font-medium truncate",
                                isDone ? "line-through text-muted-foreground" : "text-green-800 dark:text-green-200"
                            )}>
                                {task.title}
                            </span>
                        </div>
                        <div className="flex-shrink-0 ml-1">
                            {isRunning ? (
                                <button
                                    onClick={() => timer.pauseTimer()}
                                    aria-label="タイマーを一時停止"
                                    className="p-1 rounded-full bg-primary/10 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                                >
                                    <Pause className="w-3.5 h-3.5" />
                                </button>
                            ) : (
                                <button
                                    onClick={() => timer.startTimer(task)}
                                    aria-label={`${task.title}のタイマーを開始`}
                                    className="p-1 rounded-full active:bg-muted text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                                >
                                    <Play className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-green-600 dark:text-green-300 font-medium">{startStr}</span>
                        {task.estimated_time > 0 && (
                            <span className="text-[9px] text-muted-foreground">⏱ {task.estimated_time}分</span>
                        )}
                    </div>
                    {isRunning && (
                        <div className="text-[11px] font-mono text-primary mt-0.5 tabular-nums">
                            {formatTime(timer.currentElapsedSeconds)}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
