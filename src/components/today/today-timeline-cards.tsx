"use client"

import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import {
    Play, Pause, Check, Square, CheckSquare, Clock,
    Calendar as CalendarIcon
} from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { useState, useEffect, useMemo } from "react"
import type { TimeBlock } from "@/lib/time-block"

// --- Types ---

interface TodayTimelineCardsProps {
    timelineItems: TimeBlock[]
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
    completedEventIds: Set<string>
    onToggleEventCompletion: (googleEventId: string, calendarId: string) => void
    onItemTap?: (item: TimeBlock) => void
    projectNameMap?: Map<string, string>
}

export function TodayTimelineCards({
    timelineItems,
    allDayEvents,
    eventsLoading,
    currentTime,
    onToggleTask,
    completedEventIds,
    onToggleEventCompletion,
    onItemTap,
    projectNameMap,
}: TodayTimelineCardsProps) {
    const timer = useTimer()

    // Calculate free time slots (gaps between timeline items)
    const freeTimeSlots = useMemo(() => {
        const slots: { startTime: Date; endTime: Date }[] = []
        for (let i = 0; i < timelineItems.length - 1; i++) {
            const currentEnd = timelineItems[i].endTime
            const nextStart = timelineItems[i + 1].startTime
            const gapMinutes = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60)

            // Show gap if 30 minutes or more
            if (gapMinutes >= 30) {
                slots.push({ startTime: currentEnd, endTime: nextStart })
            }
        }
        return slots
    }, [timelineItems])

    // Find current time slot index for indicator
    const currentTimeSlotIndex = useMemo(() => {
        for (let i = 0; i < timelineItems.length; i++) {
            if (currentTime >= timelineItems[i].startTime && currentTime < timelineItems[i].endTime) {
                return i
            }
        }
        // Check if current time is in a gap
        for (let i = 0; i < timelineItems.length - 1; i++) {
            if (currentTime >= timelineItems[i].endTime && currentTime < timelineItems[i + 1].startTime) {
                return i + 0.5 // Between items
            }
        }
        return -1 // Not in timeline
    }, [timelineItems, currentTime])

    return (
        <>
            {/* Active Timer Banner */}
            {timer.runningTask && (
                <div className="mx-4 mt-3 p-3 rounded-xl bg-primary/5 border border-primary/20 dark:bg-primary/10 dark:border-primary/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                            <span className="text-sm font-medium truncate">{timer.runningTask.title}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-base font-mono font-bold text-primary tabular-nums">
                                {formatTime(timer.currentElapsedSeconds)}
                            </span>
                            <button
                                onClick={() => timer.pauseTimer()}
                                aria-label="タイマーを一時停止"
                                className="p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 active:bg-primary/20 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                            >
                                <Pause className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => timer.completeTimer()}
                                aria-label="タスクを完了"
                                className="p-1.5 rounded-full bg-green-500/10 hover:bg-green-500/20 active:bg-green-500/20 text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                            >
                                <Check className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* All-day Events */}
            {allDayEvents.length > 0 && (
                <div className="px-4 mt-3">
                    {allDayEvents.map(event => {
                        const isEventCompleted = completedEventIds.has(event.google_event_id)
                        return (
                            <div
                                key={event.id}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border mb-1.5",
                                    isEventCompleted
                                        ? "bg-muted/30 border-border opacity-50"
                                        : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                                )}
                            >
                                <button
                                    onClick={() => onToggleEventCompletion(event.google_event_id, event.calendar_id)}
                                    className="flex-shrink-0 focus:outline-none"
                                >
                                    {isEventCompleted ? (
                                        <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                    ) : (
                                        <Square className="w-3.5 h-3.5 text-blue-400" />
                                    )}
                                </button>
                                <span className={cn(
                                    "text-xs font-medium truncate",
                                    isEventCompleted
                                        ? "line-through text-muted-foreground"
                                        : "text-blue-700 dark:text-blue-300"
                                )}>
                                    {event.title}
                                </span>
                                <span className="text-[10px] text-blue-500 dark:text-blue-400 flex-shrink-0">終日</span>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Timeline */}
            <div className="px-4 mt-3">
                <div className="flex items-center gap-2 mb-2">
                    <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        スケジュール
                    </span>
                </div>

                {timelineItems.length === 0 && !eventsLoading && (
                    <div className="py-8 text-center">
                        <CalendarIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">今日のスケジュールはありません</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">マップビューからタスクをスケジュールできます</p>
                    </div>
                )}

                {eventsLoading && timelineItems.length === 0 && (
                    <div className="py-6 text-center text-muted-foreground text-sm">
                        読み込み中...
                    </div>
                )}

                <div className="space-y-2">
                    {timelineItems.map((item, index) => (
                        <div key={`${item.source}-${item.id}`}>
                            <TimelineCard
                                item={item}
                                currentTime={currentTime}
                                timer={timer}
                                completedEventIds={completedEventIds}
                                onToggleEventCompletion={onToggleEventCompletion}
                                onToggleTask={onToggleTask}
                                onTap={onItemTap ? () => onItemTap(item) : undefined}
                                projectNameMap={projectNameMap}
                            />
                            {/* Free time slot after this item */}
                            {freeTimeSlots.find(slot =>
                                slot.startTime.getTime() === item.endTime.getTime()
                            ) && (
                                <FreeTimeSlot
                                    slot={freeTimeSlots.find(slot =>
                                        slot.startTime.getTime() === item.endTime.getTime()
                                    )!}
                                    currentTime={currentTime}
                                />
                            )}
                            {/* Current time indicator (if in gap) */}
                            {currentTimeSlotIndex === index + 0.5 && (
                                <CurrentTimeIndicator />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </>
    )
}

// --- Timeline Card ---

function TimelineCard({
    item,
    currentTime,
    timer,
    completedEventIds,
    onToggleEventCompletion,
    onToggleTask,
    onTap,
    projectNameMap,
}: {
    item: TimeBlock
    currentTime: Date
    timer: ReturnType<typeof useTimer>
    completedEventIds: Set<string>
    onToggleEventCompletion: (googleEventId: string, calendarId: string) => void
    onToggleTask: (taskId: string) => void
    onTap?: () => void
    projectNameMap?: Map<string, string>
}) {
    const startStr = format(item.startTime, 'HH:mm')
    const endStr = format(item.endTime, 'HH:mm')
    const isNow = currentTime >= item.startTime && currentTime < item.endTime
    const isPast = currentTime >= item.endTime

    if (item.source === 'google_event') {
        const event = item.originalEvent!
        const isEventCompleted = completedEventIds.has(item.googleEventId!)
        return (
            <div
                onClick={onTap}
                className={cn(
                "relative flex gap-3 p-3 rounded-xl border transition-colors",
                onTap ? "cursor-pointer active:opacity-80" : "",
                isEventCompleted
                    ? "border-border opacity-50"
                    : isNow
                        ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/30"
                        : "border-border"
            )}>
                {isNow && !isEventCompleted && (
                    <>
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-blue-400 animate-pulse" />
                        <span className="absolute -top-2 left-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-500 text-white rounded-full">Now</span>
                    </>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleEventCompletion(item.googleEventId!, item.calendarId!) }}
                    className="flex-shrink-0 self-center focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
                >
                    {isEventCompleted ? (
                        <CheckSquare className="w-5 h-5 text-primary" />
                    ) : (
                        <Square className="w-5 h-5 text-blue-400" />
                    )}
                </button>
                <div className="flex-shrink-0 w-12 pt-0.5">
                    <div className="text-xs font-semibold">{startStr}</div>
                    <div className="text-[10px] text-muted-foreground">{endStr}</div>
                </div>
                <div className="w-0.5 rounded-full bg-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className={cn(
                        "text-sm font-medium truncate",
                        isEventCompleted && "line-through text-muted-foreground"
                    )}>
                        {item.title}
                    </div>
                    {event.location && (
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            📍 {event.location}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // Task card
    const task = item.originalTask!
    const isRunning = item.isTimerRunning
    const isDone = item.isCompleted
    const projectName = item.projectId ? projectNameMap?.get(item.projectId) : undefined

    return (
        <div
            onClick={onTap}
            className={cn(
            "relative flex gap-3 p-3 rounded-xl border transition-colors",
            onTap ? "cursor-pointer active:opacity-80" : "",
            isDone
                ? "border-border opacity-50"
                : isRunning
                    ? "border-primary/60 bg-primary/10 dark:border-primary/50 dark:bg-primary/10"
                    : isNow
                        ? "border-green-300 bg-green-50/50 dark:border-green-700 dark:bg-green-950/30"
                        : "border-border"
        )}>
            {isNow && !isRunning && !isDone && (
                <>
                    <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-green-400 animate-pulse" />
                    <span className="absolute -top-2 left-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-500 text-white rounded-full">Now</span>
                </>
            )}
            <button
                onClick={(e) => { e.stopPropagation(); onToggleTask(item.id) }}
                className="flex-shrink-0 self-center focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
            >
                {isDone ? (
                    <CheckSquare className="w-5 h-5 text-primary" />
                ) : (
                    <Square className="w-5 h-5 text-green-500" />
                )}
            </button>
            <div className="flex-shrink-0 w-12 pt-0.5">
                <div className="text-xs font-semibold">{startStr}</div>
                <div className="text-[10px] text-muted-foreground">{endStr}</div>
            </div>
            <div className="w-0.5 rounded-full bg-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className={cn(
                    "text-sm font-medium truncate",
                    isDone && "line-through text-muted-foreground"
                )}>
                    {item.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                    {(item.estimatedTime ?? 0) > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                            ⏱ {item.estimatedTime}分
                        </span>
                    )}
                    {projectName && (
                        <span className="text-[9px] text-muted-foreground bg-muted/60 px-1 py-0.5 rounded truncate max-w-24">
                            {projectName}
                        </span>
                    )}
                </div>
                {isRunning && (
                    <div className="text-xs font-mono text-primary mt-0.5 tabular-nums">
                        {formatTime(timer.currentElapsedSeconds)}
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 flex items-center">
                {isRunning ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); timer.pauseTimer() }}
                        aria-label="タイマーを一時停止"
                        className="p-2.5 rounded-full bg-primary/10 hover:bg-primary/20 active:bg-primary/20 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                        <Pause className="w-5 h-5" />
                    </button>
                ) : (
                    <button
                        onClick={(e) => { e.stopPropagation(); timer.startTimer(task) }}
                        aria-label={`${item.title}のタイマーを開始`}
                        className="p-2.5 rounded-full hover:bg-muted active:bg-muted text-muted-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                        <Play className="w-5 h-5" />
                    </button>
                )}
            </div>
        </div>
    )
}

// --- Free Time Slot ---

function FreeTimeSlot({
    slot,
    currentTime,
}: {
    slot: { startTime: Date; endTime: Date }
    currentTime: Date
}) {
    const startStr = format(slot.startTime, 'HH:mm')
    const endStr = format(slot.endTime, 'HH:mm')
    const durationMinutes = Math.round((slot.endTime.getTime() - slot.startTime.getTime()) / (1000 * 60))
    const isNow = currentTime >= slot.startTime && currentTime < slot.endTime

    return (
        <div className={cn(
            "my-2 py-2 px-3 rounded-lg border-2 border-dashed transition-colors",
            isNow
                ? "border-orange-300 bg-orange-50/30 dark:border-orange-700/50 dark:bg-orange-950/20"
                : "border-muted-foreground/20 bg-muted/10"
        )}>
            <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className={cn(
                        "font-medium",
                        isNow ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"
                    )}>
                        空き時間
                    </span>
                </div>
                <span className="text-muted-foreground">
                    {startStr} - {endStr} ({durationMinutes}分)
                </span>
            </div>
        </div>
    )
}

// --- Current Time Indicator ---

function CurrentTimeIndicator() {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 60000)
        return () => clearInterval(interval)
    }, [])

    const timeStr = format(now, 'HH:mm')

    return (
        <div className="relative my-3">
            <div className="absolute left-0 right-0 flex items-center">
                <div className="flex-shrink-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {timeStr}
                </div>
                <div className="flex-1 h-0.5 bg-red-500 ml-2" />
            </div>
        </div>
    )
}
