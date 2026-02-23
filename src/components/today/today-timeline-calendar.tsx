"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { useTouchDrag, DragItem } from "@/hooks/useTouchDrag"
import { Play, Pause, Check, Square, CheckSquare, GripVertical, Plus, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { SubTaskSection } from "./sub-task-list"
import type { TimeBlock } from "@/lib/time-block"

// --- Constants ---
const HOUR_HEIGHT = 56 // px per hour (slightly compact for mobile)
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DEFAULT_SCROLL_HOUR = 7 // scroll to 7am by default
const TOTAL_HEIGHT = HOUR_HEIGHT * 24

// --- Types ---

interface TodayTimelineCalendarProps {
    timelineItems: TimeBlock[]
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
    onItemTap?: (item: TimeBlock) => void
    onDragDrop?: (item: DragItem, newStartTime: Date, newEndTime: Date) => void
    childTasksMap?: Map<string, Task[]>
    onCreateSubTask?: (parentTaskId: string, title: string) => void
    onDeleteSubTask?: (taskId: string) => void
    projectNameMap?: Map<string, string>
    initialScrollTop?: number
    onScrollPositionChange?: (scrollTop: number) => void
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
    onItemTap,
    onDragDrop,
    childTasksMap,
    onCreateSubTask,
    onDeleteSubTask,
    projectNameMap,
    initialScrollTop,
    onScrollPositionChange,
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

    // Scroll to saved position (or default hour) on mount
    useEffect(() => {
        const scrollTo = initialScrollTop ?? DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
        if (gridRef.current) {
            gridRef.current.scrollTop = scrollTo
        }
        if (timeLabelRef.current) {
            timeLabelRef.current.scrollTop = scrollTo
        }
    }, [])

    // Sync scroll between time labels and grid + notify parent
    const handleGridScroll = () => {
        if (gridRef.current && timeLabelRef.current) {
            timeLabelRef.current.scrollTop = gridRef.current.scrollTop
            onScrollPositionChange?.(gridRef.current.scrollTop)
        }
    }

    // Current time position
    const currentTimeTop = useMemo(() => getTopPx(currentTime), [currentTime])
    // currentTime は親コンポーネントから渡される現在時刻（常に「今」を表す）
    // SSRセーフ: new Date()を使わず、currentTimeのみで判定
    const isToday = useMemo(() => {
        const ct = new Date(currentTime)
        ct.setHours(0, 0, 0, 0)
        const today = new Date(currentTime)
        today.setHours(0, 0, 0, 0)
        return ct.getTime() === today.getTime()
    }, [currentTime])

    // Calculate event layout (handle overlapping)
    const layoutItems = useMemo(() => {
        const items = timelineItems.map(item => {
            const top = getTopPx(item.startTime)
            let height = getHeightPx(item.startTime, item.endTime)
            // 24:00（TOTAL_HEIGHT）を超えないようにクランプ
            if (top + height > TOTAL_HEIGHT) {
                height = Math.max(TOTAL_HEIGHT - top, HOUR_HEIGHT * 0.4)
            }
            return { ...item, top, height }
        })

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
                if (group.some(g => g === r || (g.source === r.source && g.id === r.id))) {
                    r.totalColumns = maxCol
                }
            }
        }

        return result
    }, [timelineItems])

    // 日付をまたぐアイテムは today-view.tsx 側でクランプ済み

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* All-day Events Bar */}
            {allDayEvents.length > 0 && (
                <div className="px-2 py-1.5 border-b bg-muted/20 flex-shrink-0">
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                        {allDayEvents.map(event => {
                            const hex = getEventColor(event)
                            const rgb = hexToRgb(hex)
                            return (
                                <div
                                    key={event.id}
                                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
                                    style={{
                                        backgroundColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)` : undefined,
                                        borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` : undefined,
                                    }}
                                >
                                    <span
                                        className="text-[11px] font-medium truncate max-w-32"
                                        style={{ color: hex }}
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
                <div className="mx-2 mt-2 mb-1 rounded-xl border border-primary/30 bg-primary/8 dark:bg-primary/12 overflow-hidden flex-shrink-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0 shadow-[0_0_6px_rgba(var(--color-primary-rgb,99,102,241),0.8)]" />
                        <span className="text-xs font-medium truncate flex-1">{timer.runningTask.title}</span>
                        <span className="text-sm font-mono font-bold text-primary tabular-nums flex-shrink-0">
                            {formatTime(timer.currentElapsedSeconds)}
                        </span>
                        <button
                            onClick={() => timer.pauseTimer()}
                            aria-label="タイマーを一時停止"
                            className="p-1.5 rounded-full bg-primary/15 active:bg-primary/25 text-primary focus:outline-none flex-shrink-0"
                        >
                            <Pause className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => timer.completeTimer()}
                            aria-label="タスクを完了"
                            className="p-1.5 rounded-full bg-emerald-500/15 active:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 focus:outline-none flex-shrink-0"
                        >
                            <Check className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    {/* Shimmer progress bar (loops every 8s to indicate running) */}
                    <div className="h-[2px] bg-primary/20 overflow-hidden">
                        <div className="h-full w-1/3 bg-primary/60 animate-[shimmer_2s_linear_infinite] rounded-full" />
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
                            const isEvent = !!item.originalEvent
                            const id = item.id

                            const leftPercent = (item.column / item.totalColumns) * 100
                            const widthPercent = (1 / item.totalColumns) * 100

                            // Build drag item for touch handlers
                            const durationMinutes = Math.round(
                                (item.endTime.getTime() - item.startTime.getTime()) / 60000
                            )
                            const dragItem: DragItem = {
                                type: isEvent ? 'event' : 'task',
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
                                    key={`${item.source}-${id}`}
                                    className={cn(
                                        "absolute touch-none select-none",
                                        isDragTarget && "invisible",
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
                                            event={item.originalEvent!}
                                            currentTime={currentTime}
                                            height={item.height}
                                            onTap={!dragState.isDragging && onItemTap ? () => onItemTap(item) : undefined}
                                        />
                                    ) : (
                                        <>
                                            <TaskBlock
                                                task={item.originalTask!}
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
                                                projectName={item.projectId ? projectNameMap?.get(item.projectId) : undefined}
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

                        {/* Loading indicator — skeleton blocks */}
                        {eventsLoading && timelineItems.length === 0 && (
                            <div className="absolute inset-0 pointer-events-none">
                                {[{ top: 120, h: 56 }, { top: 224, h: 84 }, { top: 364, h: 56 }, { top: 476, h: 112 }].map((s, i) => (
                                    <div
                                        key={i}
                                        className="absolute left-[14px] right-[2px] rounded-md bg-muted/40 animate-pulse"
                                        style={{ top: s.top, height: s.h, animationDelay: `${i * 0.12}s` }}
                                    />
                                ))}
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
    onTap,
}: {
    event: CalendarEvent
    currentTime: Date
    height: number
    onTap?: () => void
}) {
    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)
    const isNow = currentTime >= startTime && currentTime < endTime
    const isCompact = height < 40

    const startStr = format(startTime, 'HH:mm')

    const eventHex = getEventColor(event)
    const rgb = hexToRgb(eventHex)
    const bgRgba = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)` : undefined
    const bgNowRgba = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)` : undefined

    return (
        <div
            onClick={onTap}
            className={cn(
                "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden transition-colors",
                onTap ? "cursor-pointer active:opacity-70" : "cursor-default",
                isNow && "ring-1"
            )}
            style={{
                borderLeftColor: eventHex,
                backgroundColor: isNow ? bgNowRgba : bgRgba,
                ...(isNow ? { boxShadow: `0 0 0 1px ${eventHex}60` } : {}),
            }}
        >
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    <span className="text-[10px] font-medium text-muted-foreground">{startStr}</span>
                    <span className="text-[11px] font-medium truncate text-foreground">
                        {event.title}
                    </span>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium truncate leading-tight text-foreground">
                            {event.title}
                        </span>
                    </div>
                    <div className="text-[10px] font-medium mt-0.5 text-muted-foreground">{startStr}</div>
                    {event.location && height > 55 && (
                        <div className="text-[9px] truncate mt-0.5 text-muted-foreground/70">
                            {event.location}
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
    projectName,
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
    projectName?: string
}) {
    const isNow = currentTime >= startTime && currentTime < endTime
    const isPast = currentTime >= endTime
    const isRunning = timer.runningTaskId === task.id
    const isDone = task.status === 'done'
    const isCompact = height < 40

    const startStr = format(startTime, 'HH:mm')

    // EventBlock と完全に同じ rgba 方式でタスク色を定義
    const TASK_HEX = '#F97316' // orange-500
    const TASK_RGB = { r: 249, g: 115, b: 22 }
    const taskBg = `rgba(${TASK_RGB.r}, ${TASK_RGB.g}, ${TASK_RGB.b}, 0.25)`
    const taskBgNow = `rgba(${TASK_RGB.r}, ${TASK_RGB.g}, ${TASK_RGB.b}, 0.35)`

    return (
        <div
            onClick={onTap}
            className={cn(
                "h-full rounded-md border-l-3 px-2 py-1 overflow-hidden transition-colors",
                onTap ? "cursor-pointer active:opacity-70" : "cursor-default",
                isRunning && "ring-1",
                isDone && !isRunning && "opacity-40",
                isNow && !isRunning && "ring-1"
            )}
            style={isRunning
                ? { borderLeftColor: 'var(--color-primary)', backgroundColor: 'rgba(var(--color-primary-rgb, 59,130,246), 0.15)', boxShadow: '0 0 0 1px rgba(var(--color-primary-rgb, 59,130,246), 0.4)' }
                : isDone
                    ? { borderLeftColor: 'var(--color-muted-foreground)', backgroundColor: 'var(--color-muted)' }
                    : isNow
                        ? { borderLeftColor: TASK_HEX, backgroundColor: taskBgNow, boxShadow: `0 0 0 1px ${TASK_HEX}60` }
                        : { borderLeftColor: TASK_HEX, backgroundColor: taskBg }
            }
        >
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggle(task.id) }}
                        aria-label={isDone ? `${task.title}を未完了に戻す` : `${task.title}を完了にする`}
                        className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                    >
                        {isDone ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                            <Square className="w-4 h-4" style={{ color: TASK_HEX }} />
                        )}
                    </button>
                    <span className={cn(
                        "text-[11px] font-medium truncate",
                        isDone ? "line-through text-muted-foreground" : "text-foreground"
                    )}>
                        {task.title}
                    </span>
                    <div className="ml-auto flex-shrink-0 flex items-center gap-1">
                        {isRunning ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); timer.pauseTimer() }}
                                aria-label="タイマーを一時停止"
                                className="p-0.5 text-primary focus:outline-none rounded"
                            >
                                <Pause className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); timer.startTimer(task) }}
                                aria-label={`${task.title}のタイマーを開始`}
                                className="p-0.5 text-muted-foreground focus:outline-none rounded"
                            >
                                <Play className="w-3.5 h-3.5" />
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
                                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </>
                                ) : (
                                    <Plus className="w-3.5 h-3.5" />
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
                                    <CheckSquare className="w-4.5 h-4.5 text-primary" />
                                ) : (
                                    <Square className="w-4.5 h-4.5" style={{ color: TASK_HEX }} />
                                )}
                            </button>
                            <span className={cn(
                                "text-[11px] font-medium truncate",
                                isDone ? "line-through text-muted-foreground" : "text-foreground"
                            )}>
                                {task.title}
                            </span>
                        </div>
                        <div className="flex-shrink-0 ml-1 flex items-center gap-1">
                            {isRunning ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); timer.pauseTimer() }}
                                    aria-label="タイマーを一時停止"
                                    className="p-1 rounded-full bg-primary/10 text-primary focus:outline-none"
                                >
                                    <Pause className="w-4 h-4" />
                                </button>
                            ) : (
                                <button
                                    onClick={(e) => { e.stopPropagation(); timer.startTimer(task) }}
                                    aria-label={`${task.title}のタイマーを開始`}
                                    className="p-1 rounded-full active:bg-muted text-muted-foreground focus:outline-none"
                                >
                                    <Play className="w-4 h-4" />
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
                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </>
                                    ) : (
                                        <Plus className="w-4 h-4" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                            {startStr}–{format(endTime, 'HH:mm')}
                        </span>
                        {task.estimated_time > 0 && (
                            <span className="text-[9px] text-muted-foreground">⏱ {task.estimated_time}分</span>
                        )}
                        {projectName && (
                            <span className="text-[9px] text-muted-foreground bg-muted/60 px-1 py-0.5 rounded truncate max-w-20">
                                {projectName}
                            </span>
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

    const startStr = format(dragState.previewStartTime, 'HH:mm')
    const endStr = format(dragState.previewEndTime, 'HH:mm')
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
