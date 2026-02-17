"use client"

import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import {
    Play, Pause, Check, Square, CheckSquare, Clock,
    Calendar as CalendarIcon, ChevronDown, ChevronUp
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useMemo } from "react"

// --- Types ---

type TimelineItem =
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }

interface TodayTimelineCardsProps {
    timelineItems: TimelineItem[]
    unscheduledTasks: Task[]
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
}

export function TodayTimelineCards({
    timelineItems,
    unscheduledTasks,
    allDayEvents,
    eventsLoading,
    currentTime,
    onToggleTask,
}: TodayTimelineCardsProps) {
    const timer = useTimer()
    const [showAllUnscheduled, setShowAllUnscheduled] = useState(false)
    const displayedUnscheduled = showAllUnscheduled ? unscheduledTasks : unscheduledTasks.slice(0, 5)

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
                    {allDayEvents.map(event => (
                        <div
                            key={event.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 mb-1.5"
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate">
                                {event.title}
                            </span>
                            <span className="text-[10px] text-blue-500 dark:text-blue-400 flex-shrink-0">終日</span>
                        </div>
                    ))}
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
                        <div key={item.type === 'event' ? `e-${item.data.id}` : `t-${(item.data as Task).id}`}>
                            <TimelineCard
                                item={item}
                                currentTime={currentTime}
                                timer={timer}
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

            {/* Unscheduled Tasks */}
            {unscheduledTasks.length > 0 && (
                <div className="px-4 mt-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            未スケジュール
                        </span>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                            {unscheduledTasks.length}
                        </span>
                    </div>
                    <div className="space-y-0.5">
                        {displayedUnscheduled.map(task => (
                            <div
                                key={task.id}
                                className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/50 active:bg-muted/50 group"
                            >
                                <button
                                    onClick={() => onToggleTask(task.id)}
                                    aria-label={task.status === 'done' ? `${task.title}を未完了に戻す` : `${task.title}を完了にする`}
                                    className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded transition-transform active:scale-95"
                                >
                                    {task.status === 'done' ? (
                                        <CheckSquare className="w-4 h-4 text-primary transition-all" />
                                    ) : (
                                        <Square className="w-4 h-4 text-muted-foreground transition-all" />
                                    )}
                                </button>
                                <span className={cn(
                                    "text-sm flex-1 truncate",
                                    task.status === 'done' && "line-through text-muted-foreground"
                                )}>
                                    {task.title}
                                </span>
                                {task.estimated_time > 0 && (
                                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                        {task.estimated_time}分
                                    </span>
                                )}
                                {timer.runningTaskId !== task.id && (
                                    <button
                                        onClick={() => timer.startTimer(task)}
                                        aria-label={`${task.title}のタイマーを開始`}
                                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2 md:p-1 rounded hover:bg-muted active:bg-muted text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:opacity-100 transition-opacity duration-200"
                                    >
                                        <Play className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    {unscheduledTasks.length > 5 && (
                        <button
                            onClick={() => setShowAllUnscheduled(prev => !prev)}
                            aria-label={showAllUnscheduled ? '未スケジュールタスクを折りたたむ' : `他 ${unscheduledTasks.length - 5}件を表示`}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors"
                        >
                            {showAllUnscheduled ? (
                                <><ChevronUp className="w-3 h-3 transition-transform" />折りたたむ</>
                            ) : (
                                <><ChevronDown className="w-3 h-3 transition-transform" />他 {unscheduledTasks.length - 5}件を表示</>
                            )}
                        </button>
                    )}
                </div>
            )}
        </>
    )
}

// --- Timeline Card ---

function TimelineCard({
    item,
    currentTime,
    timer,
}: {
    item: TimelineItem
    currentTime: Date
    timer: ReturnType<typeof useTimer>
}) {
    const startStr = item.startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const endStr = item.endTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const isNow = currentTime >= item.startTime && currentTime < item.endTime
    const isPast = currentTime >= item.endTime

    if (item.type === 'event') {
        const event = item.data as CalendarEvent
        return (
            <div className={cn(
                "relative flex gap-3 p-3 rounded-xl border transition-colors",
                isNow ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/30" : "border-border",
                isPast && "opacity-50"
            )}>
                {isNow && (
                    <>
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-blue-400 animate-pulse" />
                        <span className="absolute -top-2 left-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-500 text-white rounded-full">Now</span>
                    </>
                )}
                <div className="flex-shrink-0 w-12 pt-0.5">
                    <div className="text-xs font-semibold">{startStr}</div>
                    <div className="text-[10px] text-muted-foreground">{endStr}</div>
                </div>
                <div className="w-0.5 rounded-full bg-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{event.title}</div>
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
    const task = item.data as Task
    const isRunning = timer.runningTaskId === task.id

    return (
        <div className={cn(
            "relative flex gap-3 p-3 rounded-xl border transition-colors",
            isRunning
                ? "border-primary/60 bg-primary/10 dark:border-primary/50 dark:bg-primary/10"
                : isNow
                    ? "border-green-300 bg-green-50/50 dark:border-green-700 dark:bg-green-950/30"
                    : "border-border",
            isPast && !isRunning && "opacity-50"
        )}>
            {isNow && !isRunning && (
                <>
                    <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-green-400 animate-pulse" />
                    <span className="absolute -top-2 left-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-500 text-white rounded-full">Now</span>
                </>
            )}
            <div className="flex-shrink-0 w-12 pt-0.5">
                <div className="text-xs font-semibold">{startStr}</div>
                <div className="text-[10px] text-muted-foreground">{endStr}</div>
            </div>
            <div className="w-0.5 rounded-full bg-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{task.title}</div>
                {task.estimated_time > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                        ⏱ {task.estimated_time}分
                    </div>
                )}
                {isRunning && (
                    <div className="text-xs font-mono text-primary mt-0.5 tabular-nums">
                        {formatTime(timer.currentElapsedSeconds)}
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 flex items-center">
                {isRunning ? (
                    <button
                        onClick={() => timer.pauseTimer()}
                        aria-label="タイマーを一時停止"
                        className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 active:bg-primary/20 text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                        <Pause className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        onClick={() => timer.startTimer(task)}
                        aria-label={`${task.title}のタイマーを開始`}
                        className="p-2 rounded-full hover:bg-muted active:bg-muted text-muted-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                        <Play className="w-4 h-4" />
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
    const startStr = slot.startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    const endStr = slot.endTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
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
    const now = new Date()
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

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
