"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { useTouchDrag, DragItem } from "@/hooks/useTouchDrag"
import { Play, Pause, Check, Square, CheckSquare, GripVertical, Plus, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { SubTaskSection } from "./sub-task-list"

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
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
    completedEventIds: Set<string>
    onToggleEventCompletion: (googleEventId: string, calendarId: string) => void
    onItemTap?: (item: TimelineItem) => void
    onDragDrop?: (item: DragItem, newStartTime: Date, newEndTime: Date) => void
    childTasksMap?: Map<string, Task[]>
    onCreateSubTask?: (parentTaskId: string, title: string) => void
    onDeleteSubTask?: (taskId: string) => void
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
    allDayEvents,
    eventsLoading,
    currentTime,
    onToggleTask,
    completedEventIds,
    onToggleEventCompletion,
    onItemTap,
    onDragDrop,
    childTasksMap,
    onCreateSubTask,
    onDeleteSubTask,
}: TodayTimelineCalendarProps) {
    const timer = useTimer()
    const gridRef = useRef<HTMLDivElement>(null)
    const timeLabelRef = useRef<HTMLDivElement>(null)
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

    // Touch drag & drop
    const handleDrop = useCallback((item: DragItem, newStart: Date, newEnd: Date) => {
        onDragDrop?.(item, newStart, newEnd)
    }, [onDragDrop])

    const { dragState, createItemTouchHandlers } = useTouchDrag({
        gridRef,
        onDrop: handleDrop,
        enabled: !!onDragDrop,
    })

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
                        {allDayEvents.map(event => {
                            const isEventCompleted = completedEventIds.has(event.google_event_id)
                            const hex = getEventColor(event)
                            const rgb = hexToRgb(hex)
                            return (
                                <div
                                    key={event.id}
                                    className={cn(
                                        "flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border",
                                        isEventCompleted && "opacity-50"
                                    )}
                                    style={{
                                        backgroundColor: isEventCompleted ? 'var(--color-muted)' : rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)` : undefined,
                                        borderColor: isEventCompleted ? 'var(--color-border)' : rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)` : undefined,
                                    }}
                                >
                                    <button
                                        onClick={() => onToggleEventCompletion(event.google_event_id, event.calendar_id)}
                                        className="flex-shrink-0 focus:outline-none"
                                    >
                                        {isEventCompleted ? (
                                            <CheckSquare className="w-3 h-3 text-primary" />
                                        ) : (
                                            <Square className="w-3 h-3" style={{ color: hex }} />
                                        )}
                                    </button>
                                    <span className={cn(
                                        "text-[11px] font-medium truncate max-w-32",
                                        isEventCompleted && "line-through text-muted-foreground"
                                    )}
                                        style={!isEventCompleted ? { color: hex } : undefined}
                                    >
                                        {event.title}
                                    </span>
                                </div>
                            )
                        })}
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
                    className={cn("flex-1 overflow-y-auto overflow-x-hidden", dragState.isDragging && "select-none")}
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

                            // Build drag item for touch handlers
                            const durationMinutes = Math.round(
                                (item.endTime.getTime() - item.startTime.getTime()) / 60000
                            )
                            const dragItem: DragItem = {
                                type: item.type,
                                id,
                                startTime: item.startTime,
                                endTime: item.endTime,
                                durationMinutes,
                            }
                            const touchHandlers = createItemTouchHandlers(dragItem, item.top)
                            const isDragTarget = dragState.isDragging && dragState.dragItem?.id === id
                            const isExpanded = !isEvent && expandedTaskId === id
                            const taskChildTasks = !isEvent ? childTasksMap?.get(id) : undefined

                            return (
                                <div
                                    key={`${item.type}-${id}`}
                                    className={cn(
                                        "absolute touch-none select-none",
                                        isDragTarget && "opacity-30",
                                        isExpanded ? "z-30" : "z-20"
                                    )}
                                    style={{
                                        top: item.top,
                                        height: item.height,
                                        left: `calc(${leftPercent}% + 2px)`,
                                        width: `calc(${widthPercent}% - 4px)`,
                                    }}
                                    {...touchHandlers}
                                >
                                    {isEvent ? (
                                        <EventBlock
                                            event={item.data as CalendarEvent}
                                            currentTime={currentTime}
                                            height={item.height}
                                            isCompleted={completedEventIds.has((item.data as CalendarEvent).google_event_id)}
                                            onToggleCompletion={() => onToggleEventCompletion(
                                                (item.data as CalendarEvent).google_event_id,
                                                (item.data as CalendarEvent).calendar_id
                                            )}
                                            onTap={!dragState.isDragging && onItemTap ? () => onItemTap(item) : undefined}
                                        />
                                    ) : (
                                        <>
                                            <TaskBlock
                                                task={item.data as Task}
                                                currentTime={currentTime}
                                                startTime={item.startTime}
                                                endTime={item.endTime}
                                                height={item.height}
                                                timer={timer}
                                                onToggle={onToggleTask}
                                                onTap={!dragState.isDragging && onItemTap ? () => onItemTap(item) : undefined}
                                                childTaskCount={taskChildTasks?.length ?? 0}
                                                childDoneCount={taskChildTasks?.filter(t => t.status === 'done').length ?? 0}
                                                isExpanded={isExpanded}
                                                onToggleExpand={onCreateSubTask ? () => setExpandedTaskId(prev => prev === id ? null : id) : undefined}
                                            />
                                            {isExpanded && onCreateSubTask && (
                                                <div className="relative z-40">
                                                    <SubTaskSection
                                                        parentTaskId={id}
                                                        childTasks={taskChildTasks || []}
                                                        onCreateSubTask={onCreateSubTask}
                                                        onToggleSubTask={onToggleTask}
                                                        onDeleteSubTask={onDeleteSubTask}
                                                    />
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )
                        })}

                        {/* Drag Preview Ghost */}
                        {dragState.isDragging && dragState.dragItem && dragState.previewStartTime && (
                            <DragPreview
                                dragState={dragState}
                                item={dragState.dragItem}
                            />
                        )}

                        {/* Loading indicator */}
                        {eventsLoading && layoutItems.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground">読み込み中...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

// --- Helpers: event color utilities ---
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (!match) return null
    return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
}

function getEventColor(event: CalendarEvent) {
    const hex = event.background_color || event.color || '#039BE5'
    return hex
}

// --- Event Block (Calendar event in the grid) ---
function EventBlock({
    event,
    currentTime,
    height,
    isCompleted,
    onToggleCompletion,
    onTap,
}: {
    event: CalendarEvent
    currentTime: Date
    height: number
    isCompleted: boolean
    onToggleCompletion: () => void
    onTap?: () => void
}) {
    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)
    const isNow = currentTime >= startTime && currentTime < endTime
    const isPast = currentTime >= endTime
    const isCompact = height < 40

    const startStr = startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

    const eventHex = getEventColor(event)
    const rgb = hexToRgb(eventHex)
    const bgRgba = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)` : undefined
    const bgNowRgba = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)` : undefined

    return (
        <div
            onClick={onTap}
            className={cn(
                "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden transition-colors",
                onTap ? "cursor-pointer active:opacity-70" : "cursor-default",
                isCompleted && "opacity-40",
                !isCompleted && isNow && "ring-1",
                isPast && !isCompleted && "opacity-40"
            )}
            style={{
                borderLeftColor: isCompleted ? 'var(--color-muted-foreground)' : eventHex,
                backgroundColor: isCompleted
                    ? 'var(--color-muted)'
                    : isNow ? bgNowRgba : bgRgba,
                ...(isNow && !isCompleted ? { boxShadow: `0 0 0 1px ${eventHex}40` } : {}),
            }}
        >
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleCompletion() }}
                        className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                    >
                        {isCompleted ? (
                            <CheckSquare className="w-3 h-3 text-primary" />
                        ) : (
                            <Square className="w-3 h-3" style={{ color: eventHex }} />
                        )}
                    </button>
                    <span className="text-[10px] font-medium" style={{ color: isCompleted ? undefined : eventHex }}>{startStr}</span>
                    <span className={cn(
                        "text-[11px] font-medium truncate",
                        isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                    )}>
                        {event.title}
                    </span>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleCompletion() }}
                            className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                        >
                            {isCompleted ? (
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                            ) : (
                                <Square className="w-3.5 h-3.5" style={{ color: eventHex }} />
                            )}
                        </button>
                        <span className={cn(
                            "text-[11px] font-medium truncate leading-tight",
                            isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                        )}>
                            {event.title}
                        </span>
                    </div>
                    <div className="text-[10px] font-medium mt-0.5 pl-5" style={{ color: isCompleted ? undefined : eventHex }}>{startStr}</div>
                    {event.location && height > 55 && (
                        <div className="text-[9px] truncate mt-0.5 pl-5" style={{ color: isCompleted ? undefined : eventHex, opacity: 0.7 }}>
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
    onTap,
    childTaskCount = 0,
    childDoneCount = 0,
    isExpanded = false,
    onToggleExpand,
}: {
    task: Task
    currentTime: Date
    startTime: Date
    endTime: Date
    height: number
    timer: ReturnType<typeof useTimer>
    onToggle: (taskId: string) => void
    onTap?: () => void
    childTaskCount?: number
    childDoneCount?: number
    isExpanded?: boolean
    onToggleExpand?: () => void
}) {
    const isNow = currentTime >= startTime && currentTime < endTime
    const isPast = currentTime >= endTime
    const isRunning = timer.runningTaskId === task.id
    const isDone = task.status === 'done'
    const isCompact = height < 40

    const startStr = startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

    return (
        <div
            onClick={onTap}
            className={cn(
            "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden transition-colors",
            onTap ? "cursor-pointer active:opacity-70" : "cursor-default",
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
                        onClick={(e) => { e.stopPropagation(); onToggle(task.id) }}
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
                    <div className="ml-auto flex-shrink-0 flex items-center gap-0.5">
                        {isRunning ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); timer.pauseTimer() }}
                                aria-label="タイマーを一時停止"
                                className="p-0.5 text-primary focus:outline-none rounded"
                            >
                                <Pause className="w-3 h-3" />
                            </button>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); timer.startTimer(task) }}
                                aria-label={`${task.title}のタイマーを開始`}
                                className="p-0.5 text-muted-foreground focus:outline-none rounded"
                            >
                                <Play className="w-3 h-3" />
                            </button>
                        )}
                        {onToggleExpand && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
                                aria-label={childTaskCount > 0 ? "サブタスクを展開" : "サブタスクを追加"}
                                className={cn(
                                    "p-0.5 rounded focus:outline-none flex items-center gap-0.5",
                                    isExpanded ? "text-primary" : "text-muted-foreground/60"
                                )}
                            >
                                {childTaskCount > 0 ? (
                                    <>
                                        <span className="text-[9px] tabular-nums">{childDoneCount}/{childTaskCount}</span>
                                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </>
                                ) : (
                                    <Plus className="w-3 h-3" />
                                )}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggle(task.id) }}
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
                        <div className="flex-shrink-0 ml-1 flex items-center gap-0.5">
                            {isRunning ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); timer.pauseTimer() }}
                                    aria-label="タイマーを一時停止"
                                    className="p-1 rounded-full bg-primary/10 text-primary focus:outline-none"
                                >
                                    <Pause className="w-3.5 h-3.5" />
                                </button>
                            ) : (
                                <button
                                    onClick={(e) => { e.stopPropagation(); timer.startTimer(task) }}
                                    aria-label={`${task.title}のタイマーを開始`}
                                    className="p-1 rounded-full active:bg-muted text-muted-foreground focus:outline-none"
                                >
                                    <Play className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {onToggleExpand && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
                                    aria-label={childTaskCount > 0 ? "サブタスクを展開" : "サブタスクを追加"}
                                    className={cn(
                                        "p-1 rounded-full focus:outline-none flex items-center gap-0.5",
                                        isExpanded
                                            ? "bg-primary/10 text-primary"
                                            : "active:bg-muted text-muted-foreground/60"
                                    )}
                                >
                                    {childTaskCount > 0 ? (
                                        <>
                                            <span className="text-[9px] tabular-nums">{childDoneCount}/{childTaskCount}</span>
                                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </>
                                    ) : (
                                        <Plus className="w-3.5 h-3.5" />
                                    )}
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

// --- Drag Preview Ghost ---
function DragPreview({
    dragState,
    item,
}: {
    dragState: { previewTop: number; previewStartTime: Date | null; previewEndTime: Date | null }
    item: DragItem
}) {
    if (!dragState.previewStartTime || !dragState.previewEndTime) return null

    const startStr = dragState.previewStartTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const endStr = dragState.previewEndTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const heightPx = (item.durationMinutes / (24 * 60)) * TOTAL_HEIGHT

    const isTask = item.type === 'task'

    return (
        <div
            className="absolute z-40 left-[2px] right-[2px] pointer-events-none"
            style={{
                top: dragState.previewTop,
                height: Math.max(heightPx, HOUR_HEIGHT * 0.4),
            }}
        >
            {/* Preview block */}
            <div className={cn(
                "h-full rounded-md border-2 border-dashed px-2 py-1 overflow-hidden",
                isTask
                    ? "bg-green-100/80 dark:bg-green-900/40 border-green-500"
                    : "bg-blue-100/80 dark:bg-blue-900/40 border-blue-500"
            )}>
                <div className="flex items-center gap-1.5">
                    <GripVertical className="w-3 h-3 text-muted-foreground" />
                    <span className={cn(
                        "text-[11px] font-bold",
                        isTask ? "text-green-700 dark:text-green-300" : "text-blue-700 dark:text-blue-300"
                    )}>
                        {startStr} - {endStr}
                    </span>
                </div>
            </div>
        </div>
    )
}
