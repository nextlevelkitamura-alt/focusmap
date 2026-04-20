"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { useTouchDrag, DragItem } from "@/hooks/useTouchDrag"
import { useClickOutside } from "@/hooks/useClickOutside"
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
const GUTTER_WIDTH = 40 // px: 右端の余白エリア（予定が重なっていてもドラッグ追加可能）
const QUICK_CREATE_MINUTES = 15
const QUICK_CREATE_DEFAULT_MINUTES = 30
const TOUCH_LONG_PRESS_MS = 260
const TOUCH_MOVE_CANCEL_PX = 10

// --- Types ---

interface TodayTimelineCalendarProps {
    timelineItems: TimeBlock[]
    allDayEvents: CalendarEvent[]
    eventsLoading: boolean
    currentTime: Date
    onToggleTask: (taskId: string) => void
    onToggleEvent?: (eventId: string) => void
    onItemTap?: (item: TimeBlock) => void
    onDragDrop?: (item: DragItem, newStartTime: Date, newEndTime: Date) => void
    childTasksMap?: Map<string, Task[]>
    onCreateSubTask?: (parentTaskId: string, title: string) => void
    onDeleteSubTask?: (taskId: string) => void
    projectNameMap?: Map<string, string>
    initialScrollTop?: number
    onScrollPositionChange?: (scrollTop: number) => void
    onQuickCreateTask?: (data: {
        title: string
        project_id: string | null
        scheduled_at: string | null
        estimated_time: number
        reminders: number[]
        calendar_id: string | null
        priority: number
    }) => Promise<void>
    defaultQuickCreateCalendarId?: string | null
    draftPreview?: {
        title?: string
        startTime: Date
        endTime: Date
        color?: string
    } | null
    onQuickCreateRangeSelect?: (payload: { scheduledAt: Date; estimatedTime: number }) => void
    selectedDate?: Date
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

function snapDown(minutes: number): number {
    return Math.floor(minutes / QUICK_CREATE_MINUTES) * QUICK_CREATE_MINUTES
}

function snapUp(minutes: number): number {
    return Math.ceil(minutes / QUICK_CREATE_MINUTES) * QUICK_CREATE_MINUTES
}

// --- Main Component ---
export function TodayTimelineCalendar({
    timelineItems,
    allDayEvents,
    eventsLoading,
    currentTime,
    onToggleTask,
    onToggleEvent,
    onItemTap,
    onDragDrop,
    childTasksMap,
    onCreateSubTask,
    onDeleteSubTask,
    projectNameMap,
    initialScrollTop,
    onScrollPositionChange,
    onQuickCreateTask,
    defaultQuickCreateCalendarId = null,
    draftPreview,
    onQuickCreateRangeSelect,
    selectedDate,
}: TodayTimelineCalendarProps) {
    const timer = useTimer()
    const gridRef = useRef<HTMLDivElement>(null)
    const lastTouchYRef = useRef<number | null>(null)
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
    const expandedTaskRef = useRef<HTMLDivElement>(null)
    useClickOutside(
        expandedTaskRef,
        () => setExpandedTaskId(null),
        expandedTaskId !== null
    )
    const [selectionState, setSelectionState] = useState<{
        pointerId: number
        anchorY: number
        currentY: number
        active: boolean
        pointerType: string
    } | null>(null)
    const [quickDraft, setQuickDraft] = useState<{
        startTime: Date
        endTime: Date
        title: string
    } | null>(null)
    const [desktopDragState, setDesktopDragState] = useState<{
        item: DragItem
        previewTop: number
        previewStartTime: Date
        previewEndTime: Date
    } | null>(null)
    const [isQuickCreating, setIsQuickCreating] = useState(false)
    const [suppressItemTapUntil, setSuppressItemTapUntil] = useState<number | null>(null)
    const quickInputRef = useRef<HTMLInputElement>(null)
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const tapSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const captureTargetRef = useRef<HTMLDivElement | null>(null)
    const pendingTouchRef = useRef<{
        pointerId: number
        clientY: number
        gridY: number
    } | null>(null)
    const desktopDragContextRef = useRef<{
        item: DragItem
        startClientY: number
        initialOffsetInItem: number
        hasMoved: boolean
    } | null>(null)
    const desktopDragPreviewRef = useRef<{
        item: DragItem
        previewTop: number
        previewStartTime: Date
        previewEndTime: Date
    } | null>(null)

    // Touch drag & drop
    const handleDrop = useCallback((item: DragItem, newStart: Date, newEnd: Date) => {
        onDragDrop?.(item, newStart, newEnd)
    }, [onDragDrop])

    const { dragState, createItemTouchHandlers } = useTouchDrag({
        gridRef,
        onDrop: handleDrop,
        enabled: !!onDragDrop,
    })

    const updateDesktopDragPreview = useCallback((dragItem: DragItem, clientY: number, initialOffsetInItem: number) => {
        const grid = gridRef.current
        if (!grid) return null

        const rect = grid.getBoundingClientRect()
        const scrollTop = grid.scrollTop
        const yInGrid = clientY - rect.top + scrollTop - initialOffsetInItem
        const rawMinutes = (clamp(yInGrid, 0, TOTAL_HEIGHT) / TOTAL_HEIGHT) * 24 * 60
        const snappedMinutes = Math.round(rawMinutes / QUICK_CREATE_MINUTES) * QUICK_CREATE_MINUTES
        const clampedMinutes = clamp(snappedMinutes, 0, 24 * 60 - dragItem.durationMinutes)

        const nextStart = new Date(dragItem.startTime)
        nextStart.setHours(0, 0, 0, 0)
        nextStart.setMinutes(clampedMinutes)
        const nextEnd = new Date(nextStart.getTime() + dragItem.durationMinutes * 60 * 1000)
        const previewTop = (clampedMinutes / (24 * 60)) * TOTAL_HEIGHT

        const preview = {
            item: dragItem,
            previewTop,
            previewStartTime: nextStart,
            previewEndTime: nextEnd,
        }

        desktopDragPreviewRef.current = preview
        setDesktopDragState(preview)
        return preview
    }, [])

    const handleDesktopItemMouseDown = useCallback((e: React.MouseEvent, item: DragItem, itemTop: number) => {
        if (!onDragDrop || e.button !== 0) return

        const target = e.target as HTMLElement
        if (target.closest('button, input, textarea, select, a, [role="button"]')) return

        const grid = gridRef.current
        if (!grid) return

        const rect = grid.getBoundingClientRect()
        const scrollTop = grid.scrollTop
        const pointerYInGrid = e.clientY - rect.top + scrollTop
        const initialOffsetInItem = pointerYInGrid - itemTop

        desktopDragContextRef.current = {
            item,
            startClientY: e.clientY,
            initialOffsetInItem,
            hasMoved: false,
        }

        const onMouseMove = (moveEvent: MouseEvent) => {
            const ctx = desktopDragContextRef.current
            if (!ctx) return

            if (!ctx.hasMoved && Math.abs(moveEvent.clientY - ctx.startClientY) < 3) return
            if (!ctx.hasMoved) {
                ctx.hasMoved = true
                if (document.body) document.body.style.userSelect = 'none'
            }

            updateDesktopDragPreview(ctx.item, moveEvent.clientY, ctx.initialOffsetInItem)
        }

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            if (document.body) document.body.style.userSelect = ''

            const ctx = desktopDragContextRef.current
            const preview = desktopDragPreviewRef.current
            if (ctx?.hasMoved && preview) {
                const originalMinutes = preview.item.startTime.getHours() * 60 + preview.item.startTime.getMinutes()
                const newMinutes = preview.previewStartTime.getHours() * 60 + preview.previewStartTime.getMinutes()
                if (newMinutes !== originalMinutes) {
                    onDragDrop(preview.item, preview.previewStartTime, preview.previewEndTime)
                }
            }

            desktopDragContextRef.current = null
            desktopDragPreviewRef.current = null
            setDesktopDragState(null)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }, [onDragDrop, updateDesktopDragPreview])

    useEffect(() => {
        return () => {
            if (document.body) document.body.style.userSelect = ''
        }
    }, [])

    // Scroll to saved position (or default hour) on mount
    useEffect(() => {
        const scrollTo = initialScrollTop ?? DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
        if (gridRef.current) {
            gridRef.current.scrollTop = scrollTo
        }
    }, [initialScrollTop])

    // Prevent scroll chaining to the page on iOS/Android when reaching timeline edges.
    useEffect(() => {
        const grid = gridRef.current
        if (!grid) return

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return
            lastTouchYRef.current = e.touches[0].clientY
        }

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 1) return
            const touchY = e.touches[0].clientY
            const prevTouchY = lastTouchYRef.current
            lastTouchYRef.current = touchY
            if (prevTouchY === null) return

            const deltaY = touchY - prevTouchY
            const atTop = grid.scrollTop <= 0
            const atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1

            if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
                e.preventDefault()
            }
        }

        const clearTouch = () => {
            lastTouchYRef.current = null
        }

        grid.addEventListener("touchstart", handleTouchStart, { passive: true })
        grid.addEventListener("touchmove", handleTouchMove, { passive: false })
        grid.addEventListener("touchend", clearTouch)
        grid.addEventListener("touchcancel", clearTouch)

        return () => {
            grid.removeEventListener("touchstart", handleTouchStart)
            grid.removeEventListener("touchmove", handleTouchMove)
            grid.removeEventListener("touchend", clearTouch)
            grid.removeEventListener("touchcancel", clearTouch)
        }
    }, [])

    // Notify parent about current scroll position (for restoring position after date switch)
    const handleGridScroll = useCallback(() => {
        if (!gridRef.current) return
        onScrollPositionChange?.(gridRef.current.scrollTop)
    }, [onScrollPositionChange])

    useEffect(() => {
        if (!quickDraft || !quickInputRef.current) return
        quickInputRef.current.focus()
        quickInputRef.current.select()
    }, [quickDraft])

    // Current time position
    const currentTimeTop = useMemo(() => getTopPx(currentTime), [currentTime])
    // 表示中の日付が「今日」かどうかを判定（赤線を当日のみ表示するため）
    const isToday = useMemo(() => {
        const displayDate = selectedDate ?? currentTime
        const d = new Date(displayDate)
        d.setHours(0, 0, 0, 0)
        const today = new Date(currentTime)
        today.setHours(0, 0, 0, 0)
        return d.getTime() === today.getTime()
    }, [currentTime, selectedDate])

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

    const clearTouchPending = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        pendingTouchRef.current = null
    }, [])

    useEffect(() => {
        return () => clearTouchPending()
    }, [clearTouchPending])

    useEffect(() => {
        return () => {
            if (tapSuppressTimerRef.current) {
                clearTimeout(tapSuppressTimerRef.current)
                tapSuppressTimerRef.current = null
            }
        }
    }, [])

    const toGridY = useCallback((clientY: number) => {
        const grid = gridRef.current
        if (!grid) return 0
        const rect = grid.getBoundingClientRect()
        return clamp(clientY - rect.top + grid.scrollTop, 0, TOTAL_HEIGHT)
    }, [])

    const baseDate = selectedDate ?? currentTime

    const toDateFromGridY = useCallback((gridY: number) => {
        const totalMinutes = (clamp(gridY, 0, TOTAL_HEIGHT) / TOTAL_HEIGHT) * 24 * 60
        const snappedMinutes = snapDown(totalMinutes)
        const d = new Date(baseDate)
        d.setHours(0, 0, 0, 0)
        d.setMinutes(clamp(snappedMinutes, 0, 24 * 60 - QUICK_CREATE_MINUTES))
        return d
    }, [baseDate])

    const buildRangeFromSelection = useCallback((startY: number, endY: number) => {
        const startMinutes = (Math.min(startY, endY) / TOTAL_HEIGHT) * 24 * 60
        const endMinutes = (Math.max(startY, endY) / TOTAL_HEIGHT) * 24 * 60
        const snappedStart = clamp(snapDown(startMinutes), 0, 24 * 60 - QUICK_CREATE_MINUTES)
        const snappedEnd = clamp(
            Math.max(snapUp(endMinutes), snappedStart + QUICK_CREATE_MINUTES),
            QUICK_CREATE_MINUTES,
            24 * 60
        )

        const start = new Date(baseDate)
        start.setHours(0, 0, 0, 0)
        start.setMinutes(snappedStart)

        const end = new Date(baseDate)
        end.setHours(0, 0, 0, 0)
        end.setMinutes(snappedEnd)

        return { start, end }
    }, [baseDate])

    const finalizeQuickSelection = useCallback((state: NonNullable<typeof selectionState>) => {
        const movedPx = Math.abs(state.currentY - state.anchorY)
        if (movedPx < 4) {
            const start = toDateFromGridY(state.anchorY)
            const durationMinutes = QUICK_CREATE_DEFAULT_MINUTES
            if (onQuickCreateRangeSelect) {
                onQuickCreateRangeSelect({ scheduledAt: start, estimatedTime: durationMinutes })
                return
            }
            const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
            setQuickDraft({ startTime: start, endTime: end, title: '' })
            return
        }
        const { start, end } = buildRangeFromSelection(state.anchorY, state.currentY)
        const durationMinutes = Math.max(
            QUICK_CREATE_MINUTES,
            Math.round((end.getTime() - start.getTime()) / 60000)
        )
        if (onQuickCreateRangeSelect) {
            onQuickCreateRangeSelect({ scheduledAt: start, estimatedTime: durationMinutes })
            return
        }
        setQuickDraft({ startTime: start, endTime: end, title: '' })
    }, [buildRangeFromSelection, toDateFromGridY, onQuickCreateRangeSelect])

    const submitQuickDraft = useCallback(async () => {
        if (!quickDraft || !onQuickCreateTask || isQuickCreating) return
        const title = quickDraft.title.trim()
        if (!title) return

        const durationMinutes = Math.max(
            QUICK_CREATE_MINUTES,
            Math.round((quickDraft.endTime.getTime() - quickDraft.startTime.getTime()) / 60000)
        )

        setIsQuickCreating(true)
        try {
            await onQuickCreateTask({
                title,
                project_id: null,
                scheduled_at: quickDraft.startTime.toISOString(),
                estimated_time: durationMinutes,
                reminders: [],
                calendar_id: defaultQuickCreateCalendarId,
                priority: 3,
            })
            setQuickDraft(null)
        } finally {
            setIsQuickCreating(false)
        }
    }, [quickDraft, onQuickCreateTask, isQuickCreating, defaultQuickCreateCalendarId])

    const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!onQuickCreateTask || dragState.isDragging) return
        if (quickDraft) return
        if (e.pointerType === 'mouse' && e.button !== 0) return

        const target = e.target as HTMLElement
        if (target.closest('[data-time-item="true"]')) return
        if (target.closest('[data-no-quick-create="true"]')) return

        const gridY = toGridY(e.clientY)
        const captureTarget = e.currentTarget
        const pointerId = e.pointerId
        const pointerType = e.pointerType

        if (pointerType === 'touch') {
            pendingTouchRef.current = { pointerId, clientY: e.clientY, gridY }
            longPressTimerRef.current = setTimeout(() => {
                const pending = pendingTouchRef.current
                if (!pending || pending.pointerId !== pointerId) return
                setSelectionState({
                    pointerId,
                    anchorY: pending.gridY,
                    currentY: pending.gridY,
                    active: true,
                    pointerType,
                })
                captureTargetRef.current = captureTarget
                captureTarget.setPointerCapture(pointerId)
                clearTouchPending()
            }, TOUCH_LONG_PRESS_MS)
            return
        }

        setSelectionState({
            pointerId: e.pointerId,
            anchorY: gridY,
            currentY: gridY,
            active: true,
            pointerType: e.pointerType,
        })
        captureTargetRef.current = captureTarget
        captureTarget.setPointerCapture(pointerId)
        e.preventDefault()
    }, [onQuickCreateTask, dragState.isDragging, quickDraft, toGridY, clearTouchPending])

    const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (pendingTouchRef.current && pendingTouchRef.current.pointerId === e.pointerId) {
            if (Math.abs(e.clientY - pendingTouchRef.current.clientY) > TOUCH_MOVE_CANCEL_PX) {
                clearTouchPending()
            }
        }

        setSelectionState(prev => {
            if (!prev || prev.pointerId !== e.pointerId || !prev.active) return prev
            return { ...prev, currentY: toGridY(e.clientY) }
        })
    }, [clearTouchPending, toGridY])

    const handleGridPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (pendingTouchRef.current?.pointerId === e.pointerId) {
            clearTouchPending()
            return
        }

        let finalizedQuickSelection = false
        setSelectionState(prev => {
            if (!prev || prev.pointerId !== e.pointerId || !prev.active) return prev
            finalizeQuickSelection(prev)
            finalizedQuickSelection = true
            return null
        })

        if (!finalizedQuickSelection) return

        const captureTarget = captureTargetRef.current
        if (captureTarget?.hasPointerCapture(e.pointerId)) {
            captureTarget.releasePointerCapture(e.pointerId)
        }
        captureTargetRef.current = null

        setSuppressItemTapUntil(Date.now() + 260)
        if (tapSuppressTimerRef.current) clearTimeout(tapSuppressTimerRef.current)
        tapSuppressTimerRef.current = setTimeout(() => {
            setSuppressItemTapUntil(null)
            tapSuppressTimerRef.current = null
        }, 280)
        e.preventDefault()
        e.stopPropagation()
    }, [clearTouchPending, finalizeQuickSelection])

    const handleGridClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (suppressItemTapUntil && Date.now() < suppressItemTapUntil) {
            e.preventDefault()
            e.stopPropagation()
        }
    }, [suppressItemTapUntil])

    const handleGridPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (pendingTouchRef.current?.pointerId === e.pointerId) {
            clearTouchPending()
        }
        setSelectionState(prev => (prev?.pointerId === e.pointerId ? null : prev))
        const captureTarget = captureTargetRef.current
        if (captureTarget?.hasPointerCapture(e.pointerId)) {
            captureTarget.releasePointerCapture(e.pointerId)
        }
        captureTargetRef.current = null
    }, [clearTouchPending])

    const quickSelectionPreview = useMemo(() => {
        if (!selectionState?.active) return null
        const { start, end } = buildRangeFromSelection(selectionState.anchorY, selectionState.currentY)
        return {
            top: getTopPx(start),
            height: getHeightPx(start, end),
        }
    }, [selectionState, buildRangeFromSelection])

    const quickDraftLayout = useMemo(() => {
        if (!quickDraft) return null
        const durationMinutes = Math.max(
            QUICK_CREATE_MINUTES,
            Math.round((quickDraft.endTime.getTime() - quickDraft.startTime.getTime()) / 60000)
        )
        return {
            top: getTopPx(quickDraft.startTime),
            height: getHeightPx(quickDraft.startTime, quickDraft.endTime),
            timeLabel: `${format(quickDraft.startTime, 'HH:mm')} - ${format(quickDraft.endTime, 'HH:mm')}`,
            durationLabel: `${durationMinutes}分`,
        }
    }, [quickDraft])

    const draftPreviewLayout = useMemo(() => {
        if (!draftPreview) return null

        const dayStart = new Date(currentTime)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)

        const rawStart = new Date(draftPreview.startTime)
        const rawEnd = new Date(draftPreview.endTime)

        if (rawEnd <= dayStart || rawStart >= dayEnd) return null

        const start = rawStart < dayStart ? dayStart : rawStart
        const end = rawEnd > dayEnd ? dayEnd : rawEnd
        const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
        const color = draftPreview.color || '#F97316'
        const rgb = hexToRgb(color)

        return {
            title: draftPreview.title || '新しい予定',
            top: getTopPx(start),
            height: getHeightPx(start, end),
            timeLabel: `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`,
            durationLabel: `${durationMinutes}分`,
            color,
            bgColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)` : undefined,
            borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)` : color,
        }
    }, [draftPreview, currentTime])

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

            {/* Calendar Day Grid */}
            <div
                ref={gridRef}
                className={cn(
                    "flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y",
                    (dragState.isDragging || !!desktopDragState) && "select-none"
                )}
                onScroll={handleGridScroll}
            >
                <div className="flex min-w-0" style={{ height: TOTAL_HEIGHT }}>
                    {/* Time Labels (same scroll container as grid to avoid sync lag) */}
                    <div className="w-12 flex-shrink-0 relative bg-background/90 pointer-events-none select-none" aria-hidden="true">
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

                    {/* Main Grid */}
                    <div
                        className="relative flex-1 min-w-0"
                        style={{ height: TOTAL_HEIGHT }}
                        onPointerDown={handleGridPointerDown}
                        onPointerMove={handleGridPointerMove}
                        onPointerUp={handleGridPointerUp}
                        onPointerCancel={handleGridPointerCancel}
                        onClickCapture={handleGridClickCapture}
                    >
                        {/* Gutter: 右端の余白エリア（予定が重なっていてもここからドラッグで追加可能） */}
                        <div
                            className="absolute top-0 bottom-0 border-l border-border/10 pointer-events-none"
                            style={{ right: 0, width: GUTTER_WIDTH }}
                            aria-hidden="true"
                        />
                        {/* Hour Grid Lines */}
                        {HOURS.map((hour) => (
                            <div
                                key={`grid-${hour}`}
                                className="absolute w-full border-t border-border/20 pointer-events-none"
                                style={{ top: hour * HOUR_HEIGHT }}
                            />
                        ))}

                        {/* Half-hour dashed lines */}
                        {HOURS.map((hour) => (
                            <div
                                key={`half-${hour}`}
                                className="absolute w-full border-t border-border/10 border-dashed pointer-events-none"
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

                        {/* Quick-create selection preview */}
                        {quickSelectionPreview && (
                            <div
                                className="absolute left-[14px] rounded-md border border-primary/40 bg-primary/12 pointer-events-none z-[15]"
                                style={{ top: quickSelectionPreview.top, height: quickSelectionPreview.height, right: GUTTER_WIDTH + 2 }}
                            />
                        )}

                        {/* Draft preview from side form */}
                        {draftPreviewLayout && (
                            <div
                                className="absolute left-[14px] rounded-md border-l-[3px] border border-dashed pointer-events-none z-[16] px-2 py-1"
                                style={{
                                    top: draftPreviewLayout.top,
                                    height: draftPreviewLayout.height,
                                    right: GUTTER_WIDTH + 2,
                                    borderColor: draftPreviewLayout.borderColor,
                                    borderLeftColor: draftPreviewLayout.color,
                                    backgroundColor: draftPreviewLayout.bgColor,
                                }}
                            >
                                <div className="text-[11px] font-medium truncate" style={{ color: draftPreviewLayout.color }}>
                                    {draftPreviewLayout.title}
                                </div>
                                {draftPreviewLayout.height > 34 && (
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                        {draftPreviewLayout.timeLabel} ({draftPreviewLayout.durationLabel})
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Quick-create draft input */}
                        {quickDraftLayout && quickDraft && (
                            <div
                                className="absolute left-[14px] rounded-md border border-primary/50 bg-background/95 shadow-sm z-40 px-2 py-1"
                                style={{ top: quickDraftLayout.top, height: quickDraftLayout.height, right: GUTTER_WIDTH + 2 }}
                                data-no-quick-create="true"
                            >
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <div className="text-[10px] text-primary/80 font-medium">
                                        {quickDraftLayout.timeLabel} ({quickDraftLayout.durationLabel})
                                    </div>
                                    <button
                                        type="button"
                                        className="text-[10px] text-muted-foreground hover:text-foreground"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => setQuickDraft(null)}
                                        data-no-quick-create="true"
                                    >
                                        キャンセル
                                    </button>
                                </div>
                                <input
                                    ref={quickInputRef}
                                    value={quickDraft.title}
                                    onChange={(e) => setQuickDraft(prev => prev ? { ...prev, title: e.target.value } : prev)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            submitQuickDraft()
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault()
                                            setQuickDraft(null)
                                        }
                                    }}
                                    onBlur={() => {
                                        if (quickDraft.title.trim()) submitQuickDraft()
                                    }}
                                    placeholder="予定名を入力..."
                                    disabled={isQuickCreating}
                                    className="w-full h-6 bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground"
                                />
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
                                    ref={isExpanded ? expandedTaskRef : undefined}
                                    className={cn(
                                        "absolute select-none",
                                        isDragTarget ? "touch-none" : "touch-pan-y",
                                        (isDragTarget || desktopDragState?.item.id === id) && "invisible",
                                        isExpanded ? "z-30" : "z-20"
                                    )}
                                    data-time-item="true"
                                    style={{
                                        top: item.top,
                                        height: item.height,
                                        left: `calc((100% - ${GUTTER_WIDTH}px) * ${leftPercent / 100} + 2px)`,
                                        width: `calc((100% - ${GUTTER_WIDTH}px) * ${widthPercent / 100} - 4px)`,
                                    }}
                                    onMouseDown={(e) => handleDesktopItemMouseDown(e, dragItem, item.top)}
                                    {...touchHandlers}
                                >
                                    {isEvent ? (
                                        <EventBlock
                                            event={item.originalEvent!}
                                            currentTime={currentTime}
                                            height={item.height}
                                            isCompleted={item.isCompleted}
                                            onToggle={onToggleEvent ? () => onToggleEvent(item.id) : undefined}
                                            onTap={!dragState.isDragging && !suppressItemTapUntil && !quickDraft && onItemTap ? () => onItemTap(item) : undefined}
                                        />
                                    ) : (
                                        <>
                                            <TaskBlock
                                                task={item.originalTask!}
                                                currentTime={currentTime}
                                                startTime={item.startTime}
                                                endTime={item.endTime}
                                                height={item.height}
                                                totalColumns={item.totalColumns}
                                                timer={timer}
                                                onToggle={onToggleTask}
                                                onTap={!dragState.isDragging && !suppressItemTapUntil && !quickDraft && onItemTap ? () => onItemTap(item) : undefined}
                                                childTaskCount={taskChildTasks?.length ?? 0}
                                                childDoneCount={taskChildTasks?.filter(t => t.status === 'done').length ?? 0}
                                                isExpanded={isExpanded}
                                                onToggleExpand={onCreateSubTask ? () => setExpandedTaskId(prev => prev === id ? null : id) : undefined}
                                                projectName={item.projectId ? projectNameMap?.get(item.projectId) : undefined}
                                                accentColor={item.googleEventId ? item.color : undefined}
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

                        {desktopDragState && (
                            <DragPreview
                                dragState={{
                                    previewTop: desktopDragState.previewTop,
                                    previewStartTime: desktopDragState.previewStartTime,
                                    previewEndTime: desktopDragState.previewEndTime,
                                }}
                                item={desktopDragState.item}
                            />
                        )}

                        {/* Loading indicator — skeleton blocks */}
                        {eventsLoading && timelineItems.length === 0 && (
                            <div className="absolute inset-0 pointer-events-none">
                                {[{ top: 120, h: 56 }, { top: 224, h: 84 }, { top: 364, h: 56 }, { top: 476, h: 112 }].map((s, i) => (
                                    <div
                                        key={i}
                                        className="absolute left-[14px] rounded-md bg-muted/40 animate-pulse"
                                        style={{ top: s.top, height: s.h, right: GUTTER_WIDTH + 2, animationDelay: `${i * 0.12}s` }}
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
    isCompleted,
    onToggle,
    onTap,
}: {
    event: CalendarEvent
    currentTime: Date
    height: number
    isCompleted?: boolean
    onToggle?: () => void
    onTap?: () => void
}) {
    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)
    const isNow = currentTime >= startTime && currentTime < endTime
    const isCompact = height < 40
    const eventTitleLines = height >= 150 ? 5 : height >= 110 ? 4 : height >= 80 ? 3 : height >= 60 ? 2 : 1
    const isDone = !!isCompleted

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
                isNow && "ring-1",
                isDone && "opacity-50"
            )}
            style={{
                borderLeftColor: eventHex,
                backgroundColor: isNow ? bgNowRgba : bgRgba,
                ...(isNow ? { boxShadow: `0 0 0 1px ${eventHex}60` } : {}),
            }}
        >
            {isCompact ? (
                <div className="flex items-center gap-1.5 h-full">
                    {onToggle && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggle() }}
                            aria-label={isDone ? `${event.title}を未完了に戻す` : `${event.title}を完了にする`}
                            className="no-tap-highlight flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/80 rounded"
                        >
                            {isDone ? (
                                <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                                <Square className="w-4 h-4" style={{ color: eventHex }} />
                            )}
                        </button>
                    )}
                    <span className={cn(
                        "text-[11px] font-medium truncate",
                        isDone ? "line-through text-muted-foreground" : "text-foreground"
                    )}>
                        {event.title}
                    </span>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-1.5">
                        {onToggle && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggle() }}
                                aria-label={isDone ? `${event.title}を未完了に戻す` : `${event.title}を完了にする`}
                                className="no-tap-highlight flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/80 rounded"
                            >
                                {isDone ? (
                                    <CheckSquare className="w-4.5 h-4.5 text-primary" />
                                ) : (
                                    <Square className="w-4.5 h-4.5" style={{ color: eventHex }} />
                                )}
                            </button>
                        )}
                        <span
                            className={cn(
                                "text-[11px] font-medium leading-tight break-words",
                                isDone ? "line-through text-muted-foreground" : "text-foreground",
                                eventTitleLines === 1
                                    ? "truncate"
                                    : "[display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden whitespace-normal"
                            )}
                            style={eventTitleLines > 1 ? { WebkitLineClamp: eventTitleLines } : undefined}
                        >
                            {event.title}
                        </span>
                    </div>
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
    totalColumns,
    timer,
    onToggle,
    onTap,
    childTaskCount = 0,
    childDoneCount = 0,
    isExpanded = false,
    onToggleExpand,
    projectName,
    accentColor,
}: {
    task: Task
    currentTime: Date
    startTime: Date
    endTime: Date
    height: number
    totalColumns: number
    timer: ReturnType<typeof useTimer>
    onToggle: (taskId: string) => void
    onTap?: () => void
    childTaskCount?: number
    childDoneCount?: number
    isExpanded?: boolean
    onToggleExpand?: () => void
    projectName?: string
    accentColor?: string
}) {
    const isNow = currentTime >= startTime && currentTime < endTime
    const isRunning = timer.runningTaskId === task.id
    const isDone = task.status === 'done'
    const isCompact = height < 36 || (totalColumns >= 2 && height < 52)
    const isTallCard = height >= 56
    const titleLines = height >= 160 ? 6 : height >= 128 ? 5 : height >= 96 ? 4 : height >= 72 ? 3 : height >= 56 ? 2 : 1

    // Google由来タスクはカレンダー色、通常タスクは既存オレンジ
    const TASK_HEX = accentColor || '#F97316'
    const fallbackRgb = { r: 249, g: 115, b: 22 }
    const TASK_RGB = hexToRgb(TASK_HEX) || fallbackRgb
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
                        className="no-tap-highlight flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/80 rounded"
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
                                className="no-tap-highlight flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/80 rounded"
                            >
                                {isDone ? (
                                    <CheckSquare className="w-4.5 h-4.5 text-primary" />
                                ) : (
                                    <Square className="w-4.5 h-4.5" style={{ color: TASK_HEX }} />
                                )}
                            </button>
                            <span
                                className={cn(
                                    "text-[11px] font-medium leading-tight break-words",
                                    titleLines === 1
                                        ? "truncate"
                                        : "[display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden whitespace-normal",
                                    isDone ? "line-through text-muted-foreground" : "text-foreground"
                                )}
                                style={titleLines > 1 ? { WebkitLineClamp: titleLines } : undefined}
                            >
                                {task.title}
                            </span>
                        </div>
                    </div>
                    <div className={cn(
                        "mt-0.5 flex gap-1",
                        isTallCard ? "items-start justify-between" : "items-center justify-end"
                    )}>
                        <div className="min-w-0 flex-1">
                            {projectName && (
                                <div className="mb-1">
                                    <span className="text-[9px] text-muted-foreground bg-muted/60 px-1 py-0.5 rounded inline-block max-w-full truncate">
                                        {projectName}
                                    </span>
                                </div>
                            )}
                            {isRunning && (
                                <div className="text-[11px] font-mono text-primary tabular-nums">
                                    {formatTime(timer.currentElapsedSeconds)}
                                </div>
                            )}
                        </div>
                        <div className={cn(
                            "flex-shrink-0 flex",
                            isTallCard ? "flex-col items-end gap-1" : "items-center gap-1"
                        )}>
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
            className="absolute z-40 left-[2px] pointer-events-none"
            style={{
                top: dragState.previewTop,
                height: Math.max(heightPx, HOUR_HEIGHT * 0.4),
                right: GUTTER_WIDTH + 2,
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
