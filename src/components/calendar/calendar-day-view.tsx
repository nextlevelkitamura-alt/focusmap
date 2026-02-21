import { useState, useRef, useEffect, useMemo, useCallback, RefObject } from "react"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DAY_TOTAL_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS, MIN_GRID_WIDTH_DAY, QUARTER_HOURS } from "@/lib/calendar-constants"
import { useCalendarDragDropDay } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { CalendarEvent } from "@/types/calendar"
import { Task } from "@/types/database"
import { CalendarEventCard } from "./calendar-event-card"
import { isSameDay, addDays, format } from "date-fns"
import { cn } from "@/lib/utils"

interface TimerInfo {
    runningTaskId: string | null
    currentElapsedSeconds: number
    startTimer: (task: Task) => Promise<boolean>
    pauseTimer: () => Promise<void>
}

// マウスドラッグ状態
interface DragState {
    eventId: string
    event: CalendarEvent
    duration: number
    startY: number
    startTop: number
    isNew: boolean // true: 新規ドラッグ, false: 既存イベントの移動
    originalHeightPercent: number // 元のレイアウト高さ（%）を保持
}

interface CalendarDayViewProps {
    currentDate: Date
    onTaskDrop?: (taskId: string, dateTime: Date) => void
    onEventTimeChange?: (eventId: string, newStartTime: Date, newEndTime: Date) => void
    events?: CalendarEvent[]
    onEventEdit?: (eventId: string) => void
    onEventDelete?: (eventId: string) => void
    onDateChange?: (date: Date) => void // スワイプナビゲーション用
    hourHeight?: number // ズーム機能用
    gridRef?: RefObject<HTMLDivElement | null> // ズーム機能用
    taskMap?: Map<string, Task>
    onToggleTask?: (taskId: string) => void
    timer?: TimerInfo
}

export function CalendarDayView({
    currentDate,
    onTaskDrop,
    onEventTimeChange,
    events = [],
    onEventEdit,
    onEventDelete,
    onDateChange,
    hourHeight = HOUR_HEIGHT,
    gridRef,
    taskMap,
    onToggleTask,
    timer
}: CalendarDayViewProps) {
    const [currentTime, setCurrentTime] = useState(() => {
        // SSR-safe: midnight as initial value, updated in useEffect
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const [isMounted, setIsMounted] = useState(false)
    useEffect(() => { setCurrentTime(new Date()); setIsMounted(true) }, [])
    const calendarGridRef = gridRef || useRef<HTMLDivElement>(null) // 外部refを優先、なければ内部ref
    const timeLabelsRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null) // スワイプ検出用

    // マウスドラッグ用のステート
    const [dragState, setDragState] = useState<DragState | null>(null)
    const [previewPosition, setPreviewPosition] = useState<{
        top: number
        newStartTime: Date
        newEndTime: Date
    } | null>(null)

    // 楽観的UI更新用のステート
    const [optimisticMoves, setOptimisticMoves] = useState<Record<string, {
        topPercent: number
        heightPercent: number
        startTime: Date
        endTime: Date
    }>>({})
    const [savingEventIds, setSavingEventIds] = useState<Set<string>>(new Set())

    // events が更新されたら楽観的UIをクリア（refetch完了 = 保存完了）
    useEffect(() => {
        setSavingEventIds(prev => prev.size > 0 ? new Set() : prev)
        setOptimisticMoves(prev => Object.keys(prev).length > 0 ? {} : prev)
    }, [events])

    // スワイプナビゲーション
    const { swipeDirection } = useSwipeNavigation({
        containerRef,
        onSwipeLeft: () => onDateChange?.(addDays(currentDate, 1)), // 次の日
        onSwipeRight: () => onDateChange?.(addDays(currentDate, -1)), // 前の日
        threshold: 50
    })

    const { handleScrollA: handleGridScroll } = useScrollSync(calendarGridRef, timeLabelsRef)
    const { dragOverHour, handleDragOver, handleDragLeave, handleDrop } = useCalendarDragDropDay({
        gridRef: calendarGridRef,
        onTaskDrop,
        hourHeight // Pass to hook
    })

    // Update current time (every minute)
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000)
        return () => clearInterval(timer)
    }, [])

    // Initial scroll to default hour - use updated hourHeight
    useEffect(() => {
        if (calendarGridRef.current) {
            calendarGridRef.current.scrollTop = DEFAULT_SCROLL_HOUR * hourHeight
            if (timeLabelsRef.current) {
                timeLabelsRef.current.scrollTop = DEFAULT_SCROLL_HOUR * hourHeight
            }
        }
    }, [hourHeight]) // Re-run if height changes

    // Filter events for this day
    const dayEvents = useMemo(() => {
        return events.filter(event => isSameDay(new Date(event.start_time), currentDate))
    }, [events, currentDate])

    const eventLayouts = useMemo(() => calculateEventLayout(dayEvents), [dayEvents])

    const isToday = isMounted && isSameDay(currentDate, currentTime)
    const currentTimePosition = ((currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60)) * 100

    const totalHeight = hourHeight * 24

    // 15分単位にスナップする関数
    const snapTo15Min = (minutes: number) => {
        return Math.floor(minutes / 15) * 15
    }

    // イベント高さを計算
    const getEventHeight = (duration: number) => {
        const durationMinutes = duration / (1000 * 60)
        return (durationMinutes / (24 * 60)) * totalHeight
    }

    // マウスドラッグ開始
    const handleMouseDown = useCallback((e: React.MouseEvent, event: CalendarEvent) => {
        // 左クリックのみ
        if (e.button !== 0) return

        e.stopPropagation()
        e.preventDefault()

        const gridRect = calendarGridRef.current?.getBoundingClientRect()
        if (!gridRect) return
        const scrollTop = calendarGridRef.current?.scrollTop || 0
        const y = e.clientY - gridRect.top + scrollTop

        const duration = new Date(event.end_time).getTime() - new Date(event.start_time).getTime()

        // 現在のイベントのtop位置を取得
        const startTime = new Date(event.start_time)
        const startMinutes = startTime.getHours() * 60 + startTime.getMinutes()
        const currentTop = (startMinutes / (24 * 60)) * totalHeight

        // 元のレイアウト高さを取得（最小高さ込みの正しい値）
        const layout = eventLayouts[event.id]
        const originalHeightPercent = layout?.height ?? Math.max((duration / (1000 * 60) / (24 * 60)) * 100, 1.5)

        // ローカル変数にドラッグ情報を保持（クロージャーで使用）
        const localDragState = {
            eventId: event.id,
            event,
            duration,
            startY: y,
            startTop: currentTop,
            isNew: false,
            originalHeightPercent
        }

        setDragState(localDragState)

        // 最新のpreviewPositionを保持するローカル変数
        let latestPreview: { top: number; newStartTime: Date; newEndTime: Date } | null = null
        const MIN_DRAG_DISTANCE = 5 // px: これ以上動かないとドラッグと判定しない
        const startClientY = e.clientY

        // グローバルマウスイベントを設定
        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!calendarGridRef.current) return

            // 最小移動距離に達していなければドラッグ開始しない
            if (Math.abs(moveEvent.clientY - startClientY) < MIN_DRAG_DISTANCE) return

            const gridRect = calendarGridRef.current.getBoundingClientRect()
            const currentScrollTop = calendarGridRef.current.scrollTop
            const mouseY = moveEvent.clientY - gridRect.top + currentScrollTop

            // 移動量を計算
            const deltaY = mouseY - localDragState.startY
            const newTop = localDragState.startTop + deltaY

            // 新しい時間を計算
            const totalMinutes = (newTop / totalHeight) * 24 * 60
            const snappedMinutes = snapTo15Min(Math.max(0, Math.min(totalMinutes, 24 * 60 - 1)))
            const snappedHour = Math.floor(snappedMinutes / 60)
            const snappedMin = snappedMinutes % 60

            // 新しい開始・終了時刻
            const newStartTime = new Date(currentDate)
            newStartTime.setHours(snappedHour, snappedMin, 0, 0)
            const newEndTime = new Date(newStartTime.getTime() + localDragState.duration)

            // プレビュー位置を更新（スナップ後）
            const snappedTop = (snappedMinutes / (24 * 60)) * totalHeight

            latestPreview = { top: snappedTop, newStartTime, newEndTime }
            setPreviewPosition(latestPreview)
        }

        const handleMouseUp = () => {
            // イベントリスナーを削除
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            const didDrag = latestPreview !== null

            if (didDrag && onEventTimeChange) {
                // 楽観的UI更新: すぐに新しい位置に表示（高さは元のレイアウトを保持）
                const newTopPercent = (latestPreview.top / totalHeight) * 100

                setOptimisticMoves(prev => ({
                    ...prev,
                    [localDragState.eventId]: {
                        topPercent: newTopPercent,
                        heightPercent: localDragState.originalHeightPercent,
                        startTime: latestPreview.newStartTime,
                        endTime: latestPreview.newEndTime
                    }
                }))
                setSavingEventIds(prev => new Set(prev).add(localDragState.eventId))

                // 時間変更をAPI経由で適用（awaitしない = UIをブロックしない）
                onEventTimeChange(localDragState.eventId, latestPreview.newStartTime, latestPreview.newEndTime)
            }

            // ドラッグ状態をクリア
            setDragState(null)
            setPreviewPosition(null)

            // ドラッグ有無に関わらずCalendarEventCardのonClickと二重発火を防ぐ
            const suppressClick = (e: MouseEvent) => {
                e.stopImmediatePropagation()
                e.preventDefault()
            }
            window.addEventListener('click', suppressClick, { capture: true, once: true })

            if (didDrag) {
                // ドラッグ完了 → 時間変更のみ（onEventTimeChangeで処理済み）
            } else {
                // ドラッグなし = クリック → イベント編集を開く
                onEventEdit?.(localDragState.eventId)
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [currentDate, totalHeight, hourHeight, onEventTimeChange, onEventEdit, eventLayouts])

    // HTML5ドラッグ&ドロップ（タスク用）はそのまま維持
    const onDragOver = useCallback((e: React.DragEvent) => {
        // カレンダーイベントドラッグ中はタスク用ハイライトを表示しない
        if (!dragState) {
            handleDragOver(e, { currentDate })
        }
    }, [handleDragOver, currentDate, dragState])

    const onDragLeave = useCallback((e: React.DragEvent) => {
        if (!dragState) {
            e.preventDefault()
            handleDragLeave()
        }
    }, [handleDragLeave, dragState])

    const onDrop = useCallback((e: React.DragEvent) => {
        if (!dragState) {
            // Check if it's an event drag or task drag
            const eventDataStr = e.dataTransfer.getData('application/json')
            const taskId = e.dataTransfer.getData('text/plain')

            if (eventDataStr) {
                // Event drag - calculate new time
                try {
                    const eventData = JSON.parse(eventDataStr)
                    if (eventData.type === 'calendar-event') {
                        e.preventDefault()
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const scrollTop = calendarGridRef.current?.scrollTop || 0
                        const y = e.clientY - rect.top

                        const hourIndex = Math.floor((y + scrollTop) / hourHeight)
                        const minuteIndex = Math.round(((y + scrollTop) % hourHeight) / hourHeight * 4) // 0, 1, 2, 3
                        const minutes = minuteIndex * 15

                        if (hourIndex >= 0 && hourIndex < 24) {
                            const newStartTime = new Date(currentDate)
                            newStartTime.setHours(hourIndex, minutes, 0, 0)

                            const duration = eventData.duration || 3600000
                            const newEndTime = new Date(newStartTime.getTime() + duration)

                            onEventTimeChange?.(eventData.eventId, newStartTime, newEndTime)
                        }
                    }
                } catch (error) {
                    console.error('Failed to parse event data:', error)
                }
            } else if (taskId) {
                // Task drag - use existing logic
                handleDrop(e, { currentDate })
            }
        }
    }, [handleDrop, currentDate, dragState, hourHeight, onEventTimeChange, calendarGridRef])

    return (
        <div
            ref={containerRef}
            className={cn(
                "flex flex-1 h-full overflow-hidden bg-background/50 transition-transform duration-200",
                swipeDirection === 'left' && "translate-x-[-4px]",
                swipeDirection === 'right' && "translate-x-[4px]"
            )}
        >
            {/* Time Labels */}
            <div
                ref={timeLabelsRef}
                className="w-14 flex-shrink-0 bg-background/80 border-r border-border/10 overflow-hidden relative"
            >
                <div className="relative" style={{ height: totalHeight }}>
                    {HOURS.map((hour) => (
                        <div key={hour} className="absolute w-full flex justify-end pr-3 text-[11px] font-medium text-muted-foreground/80" style={{ top: hour * hourHeight - 8 }}>
                            {hour !== 0 && `${hour}:00`}
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Grid */}
            <div
                ref={calendarGridRef}
                className="flex-1 overflow-y-auto relative"
                onScroll={handleGridScroll}
            >
                <div
                    className="relative"
                    style={{ height: totalHeight }}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                >
                    {/* Grid Lines */}
                    {HOURS.map((hour) => (
                        <div key={`grid-${hour}`} className="absolute w-full border-t border-border/30" style={{ top: hour * hourHeight }} />
                    ))}

                    {/* Current Time Indicator */}
                    {isToday && (
                        <div
                            className="absolute z-30 w-full flex items-center pointer-events-none"
                            style={{ top: `${currentTimePosition}%` }}
                        >
                            <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500 z-40 ring-2 ring-red-500/20 left-[-6px] shadow-lg shadow-red-500/30" />
                            <div className="h-[1.5px] bg-red-500 w-full opacity-70 shadow-sm" />
                        </div>
                    )}

                    {/* Drag Highlight (タスク用 - イベントドラッグ中は非表示) */}
                    {dragOverHour !== null && !dragState && (
                        <div
                            className="absolute w-full bg-primary/5 z-10 pointer-events-none transition-all border-l-2 border-primary/30"
                            style={{ top: dragOverHour * hourHeight, height: hourHeight }}
                        >
                            <div className="bg-primary text-primary-foreground text-xs px-2.5 py-1 inline-block m-2 rounded-md shadow-md font-medium">
                                {dragOverHour}:00
                            </div>
                        </div>
                    )}

                    {/* ドラッグプレビュー */}
                    {dragState && previewPosition && (() => {
                        // 元のレイアウト高さを使用（最小高さ込み）
                        const previewHeightPx = (dragState.originalHeightPercent / 100) * totalHeight

                        return (
                            <>
                                {/* 15分グリッド線 */}
                                {HOURS.map((hour) => (
                                    QUARTER_HOURS.filter(min => min !== 0).map((min) => (
                                        <div
                                            key={`15min-${hour}-${min}`}
                                            className="absolute w-full border-t border-primary/30 pointer-events-none"
                                            style={{
                                                top: (hour * hourHeight) + (min / 60) * hourHeight
                                            }}
                                        />
                                    ))
                                ))}

                                {/* スナップ位置ハイライト */}
                                <div
                                    className="absolute w-full bg-primary/10 z-25 pointer-events-none border-l-4 border-primary/50"
                                    style={{
                                        top: previewPosition.top,
                                        height: previewHeightPx,
                                        left: 0,
                                        right: 0
                                    }}
                                >
                                    {/* 時間ラベル（左上） */}
                                    <div className="absolute top-1 left-2 text-primary text-[11px] font-semibold opacity-80">
                                        {format(previewPosition.newStartTime, 'HH:mm')}
                                    </div>
                                </div>

                                {/* イベントプレビュー（新しい時間を反映） */}
                                <div
                                    className="absolute pointer-events-none shadow-lg"
                                    style={{
                                        top: previewPosition.top,
                                        height: previewHeightPx,
                                        left: '4px',
                                        right: '4px',
                                        zIndex: 30,
                                        padding: '1px 1px 1px 2px'
                                    }}
                                >
                                    <CalendarEventCard
                                        event={{
                                            ...dragState.event,
                                            start_time: previewPosition.newStartTime.toISOString(),
                                            end_time: previewPosition.newEndTime.toISOString()
                                        }}
                                        isDraggable={false}
                                        className="h-full shadow-sm"
                                        eventHeight={previewHeightPx}
                                    />
                                </div>
                            </>
                        )
                    })()}

                    {/* Events */}
                    {dayEvents.map(event => {
                        const layout = eventLayouts[event.id]
                        if (!layout) return null

                        // ドラッグ中のイベントは半透明に
                        const isDragging = dragState?.eventId === event.id
                        const isSaving = savingEventIds.has(event.id)
                        const optimistic = optimisticMoves[event.id]

                        // 楽観的位置があればそれを使用、なければレイアウト通り
                        const topPercent = optimistic ? optimistic.topPercent : layout.top
                        const heightPercent = optimistic ? optimistic.heightPercent : layout.height
                        const eventHeightPx = (heightPercent / 100) * totalHeight

                        // 楽観的に更新された時間を反映したイベント
                        const displayEvent = optimistic ? {
                            ...event,
                            start_time: optimistic.startTime.toISOString(),
                            end_time: optimistic.endTime.toISOString()
                        } : event

                        return (
                            <div
                                key={event.id}
                                className={cn(
                                    "absolute pointer-events-auto",
                                    isDragging ? "opacity-30" : "transition-all duration-200"
                                )}
                                style={{
                                    top: `${topPercent}%`,
                                    height: `${heightPercent}%`,
                                    left: `${layout.left}%`,
                                    width: `${layout.width}%`,
                                    zIndex: 20,
                                    padding: '1px 1px 1px 2px' // Google Calendar風のマージン
                                }}
                                onMouseDown={(e) => handleMouseDown(e, event)}
                            >
                                <CalendarEventCard
                                    event={displayEvent}
                                    onEdit={onEventEdit}
                                    onDelete={onEventDelete}
                                    isDraggable={false}
                                    className={cn("h-full shadow-sm text-xs", isDragging && "cursor-grabbing")}
                                    eventHeight={eventHeightPx}
                                    isSaving={isSaving}
                                    linkedTask={event.task_id ? taskMap?.get(event.task_id) : undefined}
                                    onToggleTask={onToggleTask}
                                    onStartTimer={timer ? (task) => timer.startTimer(task) : undefined}
                                    onPauseTimer={timer ? () => timer.pauseTimer() : undefined}
                                    isTimerRunning={!!event.task_id && timer?.runningTaskId === event.task_id}
                                    timerElapsedSeconds={event.task_id && timer?.runningTaskId === event.task_id ? timer.currentElapsedSeconds : undefined}
                                />
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
