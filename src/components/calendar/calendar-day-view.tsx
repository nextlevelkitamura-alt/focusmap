import { useState, useRef, useEffect, useMemo, useCallback, RefObject } from "react"
import { calculateEventLayout } from "@/lib/calendar-layout"
import { HOUR_HEIGHT, DAY_TOTAL_HEIGHT, DEFAULT_SCROLL_HOUR, HOURS, MIN_GRID_WIDTH_DAY, QUARTER_HOURS } from "@/lib/calendar-constants"
import { useCalendarDragDropDay } from "@/hooks/useCalendarDragDrop"
import { useScrollSync } from "@/hooks/useScrollSync"
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation"
import { CalendarEvent } from "@/types/calendar"
import { CalendarEventCard } from "./calendar-event-card"
import { isSameDay, addDays, format } from "date-fns"
import { cn } from "@/lib/utils"

// マウスドラッグ状態
interface DragState {
    eventId: string
    event: CalendarEvent
    duration: number
    startY: number
    startTop: number
    isNew: boolean // true: 新規ドラッグ, false: 既存イベントの移動
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
    gridRef
}: CalendarDayViewProps) {
    const [currentTime, setCurrentTime] = useState(new Date())
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

    const isToday = isSameDay(currentDate, new Date())
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

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const scrollTop = calendarGridRef.current?.scrollTop || 0
        const y = e.clientY - rect.top + scrollTop

        const duration = new Date(event.end_time).getTime() - new Date(event.start_time).getTime()

        // 現在のイベントのtop位置を取得
        const startTime = new Date(event.start_time)
        const startMinutes = startTime.getHours() * 60 + startTime.getMinutes()
        const currentTop = (startMinutes / (24 * 60)) * totalHeight

        setDragState({
            eventId: event.id,
            event,
            duration,
            startY: y,
            startTop: currentTop,
            isNew: false
        })

        // グローバルマウスイベントを設定
        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!calendarGridRef.current || !dragState) return

            const gridRect = calendarGridRef.current.getBoundingClientRect()
            const currentScrollTop = calendarGridRef.current.scrollTop
            const mouseY = moveEvent.clientY - gridRect.top + currentScrollTop

            // 移動量を計算
            const deltaY = mouseY - dragState.startY
            const newTop = dragState.startTop + deltaY

            // 新しい時間を計算
            const totalMinutes = (newTop / totalHeight) * 24 * 60
            const snappedMinutes = snapTo15Min(totalMinutes)
            const snappedHour = Math.floor(snappedMinutes / 60)
            const snappedMin = snappedMinutes % 60

            // 新しい開始・終了時刻
            const newStartTime = new Date(currentDate)
            newStartTime.setHours(snappedHour, snappedMin, 0, 0)
            const newEndTime = new Date(newStartTime.getTime() + dragState.duration)

            // プレビュー位置を更新（スナップ後）
            const snappedTop = (snappedMinutes / (24 * 60)) * totalHeight

            setPreviewPosition({
                top: snappedTop,
                newStartTime,
                newEndTime
            })
        }

        const handleMouseUp = async (upEvent: MouseEvent) => {
            // イベントリスナーを削除
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (previewPosition && onEventTimeChange) {
                // 時間変更を適用
                await onEventTimeChange(dragState!.eventId, previewPosition.newStartTime, previewPosition.newEndTime)
            }

            // ドラッグ状態をクリア
            setDragState(null)
            setPreviewPosition(null)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [currentDate, totalHeight, hourHeight, onEventTimeChange])

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
            handleDrop(e, { currentDate })
        }
    }, [handleDrop, currentDate, dragState])

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
                    style={{ height: totalHeight, minWidth: MIN_GRID_WIDTH_DAY }}
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
                    {dragState && previewPosition && (
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
                                    height: getEventHeight(dragState.duration),
                                    left: 0,
                                    right: 0
                                }}
                            >
                                {/* 時間ラベル */}
                                <div className="absolute top-0 right-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md shadow-md font-medium -translate-y-1/2">
                                    {format(previewPosition.newStartTime, 'HH:mm')}
                                    {' - '}
                                    {format(previewPosition.newEndTime, 'HH:mm')}
                                </div>
                            </div>

                            {/* イベントプレビュー */}
                            <div
                                className="absolute pointer-events-none shadow-lg"
                                style={{
                                    top: previewPosition.top,
                                    height: getEventHeight(dragState.duration),
                                    left: '4px',
                                    right: '4px',
                                    zIndex: 30,
                                    padding: '1px 1px 1px 2px'
                                }}
                            >
                                <CalendarEventCard
                                    event={dragState.event}
                                    isDraggable={false}
                                    className="h-full text-xs"
                                    eventHeight={getEventHeight(dragState.duration)}
                                />
                            </div>
                        </>
                    )}

                    {/* Events */}
                    {dayEvents.map(event => {
                        const layout = eventLayouts[event.id]
                        if (!layout) return null

                        // ドラッグ中のイベントは半透明に
                        const isDragging = dragState?.eventId === event.id
                        const eventHeightPx = (layout.height / 100) * totalHeight

                        return (
                            <div
                                key={event.id}
                                className={cn(
                                    "absolute pointer-events-auto",
                                    isDragging ? "opacity-30" : "transition-all duration-300"
                                )}
                                style={{
                                    top: `${layout.top}%`,
                                    height: `${layout.height}%`,
                                    left: `${layout.left}%`,
                                    width: `${layout.width}%`,
                                    zIndex: 20,
                                    padding: '1px 1px 1px 2px' // Google Calendar風のマージン
                                }}
                                onMouseDown={(e) => handleMouseDown(e, event)}
                            >
                                <CalendarEventCard
                                    event={event}
                                    onEdit={onEventEdit}
                                    onDelete={onEventDelete}
                                    isDraggable={false} // マウスイベントを使用
                                    className={cn("h-full shadow-sm text-xs", isDragging && "cursor-grabbing")}
                                    eventHeight={eventHeightPx}
                                />
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
