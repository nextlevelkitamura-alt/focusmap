"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { CheckSquare, ChevronRight, Square, X } from "lucide-react"
import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import type { TimeBlock } from "@/lib/time-block"
import type { DragItem } from "@/hooks/useTouchDrag"
import { buildTimeBlocksForDay } from "@/lib/today-range-blocks"
import { calculateTodayTimelineLayout, type TodayTimelineLayoutPosition } from "@/lib/today-timeline-layout"
import { cn } from "@/lib/utils"

const START_HOUR = 0
const END_HOUR = 24
const DEFAULT_SCROLL_HOUR = 10
const HOUR_HEIGHT = 56
const SCROLL_LABEL_OFFSET = 12
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT
const TIME_GUTTER_WIDTH = 48
const GRID_COLUMNS = `${TIME_GUTTER_WIDTH}px repeat(3, minmax(0, 1fr))`
const CARD_LINE_HEIGHT = 12
const CARD_VERTICAL_PADDING = 8
const CARD_TEXT_SAFE_BUFFER = 10
const CHIP_TITLE_GAP = 12
const SNAP_MINUTES = 15
const POINTER_DRAG_THRESHOLD_PX = 3
const TOUCH_LONG_PRESS_MS = 260
const TOUCH_MOVE_CANCEL_PX = 10
const DRAG_AUTO_SCROLL_ZONE = 56
const DRAG_AUTO_SCROLL_MAX_SPEED = 2

interface Today3DaysCalendarProps {
  selectedDate: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
  eventsLoading: boolean
  getInitialScrollTop?: () => number | undefined
  onScrollPositionChange?: (scrollTop: number) => void
  onDateSelect?: (date: Date) => void
  onItemTap?: (item: TimeBlock) => void
  currentTime?: Date
  onToggleTask?: (taskId: string) => void
  onToggleEvent?: (eventId: string) => void
  showOverflowChips?: boolean
  onDragDrop?: (item: DragItem, newStartTime: Date, newEndTime: Date) => void
}

interface OverflowGroup {
  date: Date
  hidden: TimeBlock[]
  start: Date
  end: Date
}

type ConflictLayoutItem = TimeBlock & TodayTimelineLayoutPosition

interface DragPreviewState {
  item: DragItem
  sourceKey: string
  dayIndex: number
  previewTop: number
  previewStartTime: Date
  previewEndTime: Date
  hasMoved: boolean
}

interface PointerDragGesture {
  item: DragItem
  sourceKey: string
  pointerId: number
  pointerType: string
  captureTarget: HTMLDivElement | null
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  initialOffsetY: number
  itemTop: number
  active: boolean
  hasMoved: boolean
  longPressTimer: ReturnType<typeof setTimeout> | null
}

interface ConflictCluster {
  visible: ConflictLayoutItem[]
  hidden: TimeBlock[]
  start: Date
  end: Date
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function minutesFromDisplayDayStart(date: Date, displayDay: Date): number {
  const diffMs = date.getTime() - startOfLocalDay(displayDay).getTime()
  return Math.round(diffMs / 60000)
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function snapToQuarter(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

function minutesToTop(minutes: number): number {
  return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT
}

function minutesToDate(baseDate: Date, minutes: number): Date {
  const d = startOfLocalDay(baseDate)
  d.setMinutes(minutes)
  return d
}

function topForDate(date: Date, displayDay: Date): number {
  const min = minutesFromDisplayDayStart(date, displayDay)
  return ((clamp(min, START_HOUR * 60, END_HOUR * 60) - START_HOUR * 60) / 60) * HOUR_HEIGHT
}

function isHexColor(value?: string): value is string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "")
}

function eventStyle(color?: string): CSSProperties {
  if (!isHexColor(color)) {
    return {
      borderLeftColor: "#8fd77a",
      backgroundColor: "rgba(63, 70, 65, 0.78)",
    }
  }
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return {
    borderLeftColor: color,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.24)`,
  }
}

function itemKey(item: TimeBlock): string {
  return `${item.source}-${item.id}`
}

function clusterEndMs(items: TimeBlock[]): number {
  return Math.max(...items.map((item) => item.endTime.getTime()))
}

function buildConflictClusters(items: TimeBlock[], showOverflowChips: boolean): ConflictCluster[] {
  const sorted = [...items].sort((a, b) => {
    const start = a.startTime.getTime() - b.startTime.getTime()
    if (start !== 0) return start
    return (b.endTime.getTime() - b.startTime.getTime()) - (a.endTime.getTime() - a.startTime.getTime())
  })
  const positioned = calculateTodayTimelineLayout(sorted, {
    totalHeight: TOTAL_HEIGHT,
    minHeight: HOUR_HEIGHT * 0.4,
  })
  const positionedByKey = new Map(positioned.map((item) => [itemKey(item), item]))
  const groups: TimeBlock[][] = []
  let current: TimeBlock[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  for (const item of sorted) {
    const start = item.startTime.getTime()
    if (current.length === 0 || start < clusterEnd) {
      current.push(item)
      clusterEnd = clusterEndMs(current)
    } else {
      groups.push(current)
      current = [item]
      clusterEnd = item.endTime.getTime()
    }
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group) => {
    const assignments = group
      .map((item) => positionedByKey.get(itemKey(item)))
      .filter((item): item is ConflictLayoutItem => Boolean(item))
    const maxColumns = Math.max(...assignments.map((assignment) => assignment.totalColumns), 1)
    const visibleColumnLimit = showOverflowChips ? 2 : maxColumns

    return {
      visible: assignments
        .filter((assignment) => assignment.column < visibleColumnLimit)
        .map((assignment) => {
          if (!showOverflowChips) return assignment
          const totalColumns = Math.min(assignment.totalColumns, visibleColumnLimit)
          const columnSpan = Math.min(assignment.columnSpan, visibleColumnLimit - assignment.column)
          return { ...assignment, totalColumns, columnSpan }
        }),
      hidden: assignments
        .filter((assignment) => showOverflowChips && assignment.column >= visibleColumnLimit)
        .map((assignment) => assignment),
      start: new Date(Math.min(...group.map((item) => item.startTime.getTime()))),
      end: new Date(Math.max(...group.map((item) => item.endTime.getTime()))),
    }
  })
}

function addDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  d.setHours(0, 0, 0, 0)
  return d
}

function overlapsVisibleRange(item: TimeBlock): boolean {
  const start = minutesFromDisplayDayStart(item.startTime, item.startTime)
  const end = minutesFromDisplayDayStart(item.endTime, item.startTime)
  return end > START_HOUR * 60 && start < END_HOUR * 60
}

function eventPositionStyle(layout: ConflictLayoutItem): CSSProperties {
  const top = layout.top
  const height = layout.height

  if (layout.totalColumns <= 1) {
    return {
      top,
      height,
      left: 4,
      width: "calc(100% - 8px)",
    }
  }

  const columnWidth = 100 / layout.totalColumns
  const span = Math.max(1, layout.columnSpan ?? 1)
  return {
    top,
    height,
    left: `calc(${columnWidth * layout.column}% + 4px)`,
    width: `calc(${columnWidth * span}% - 8px)`,
  }
}

function overflowChipStyle(cluster: ConflictCluster, chipTop: number): CSSProperties {
  const anchor = cluster.visible.find((layout) => layout.column === 1) ?? cluster.visible[0]
  const anchorTop = anchor ? anchor.top : chipTop
  const anchorHeight = anchor ? anchor.height : 58
  const titleBottom = anchor
    ? anchorTop + 4 + titleLineCount(anchor) * CARD_LINE_HEIGHT + CHIP_TITLE_GAP
    : chipTop
  const top = clamp(titleBottom, anchorTop + 12, anchorTop + anchorHeight + 6)

  if (!anchor || anchor.totalColumns <= 1) {
    return {
      top,
      right: 4,
    }
  }

  return {
    top,
    left: "calc(100% - 31px)",
  }
}

function titleLineCount(item: ConflictLayoutItem): number {
  return Math.max(
    1,
    Math.min(4, Math.floor((item.height - CARD_VERTICAL_PADDING - CARD_TEXT_SAFE_BUFFER) / CARD_LINE_HEIGHT)),
  )
}

function durationMinutesForItem(item: TimeBlock): number {
  return Math.max(1, Math.round((item.endTime.getTime() - item.startTime.getTime()) / 60000))
}

export function Today3DaysCalendar({
  selectedDate,
  events,
  tasks,
  calendarColorMap,
  eventsLoading,
  getInitialScrollTop,
  onScrollPositionChange,
  onDateSelect,
  onItemTap,
  currentTime = new Date(),
  onToggleTask,
  onToggleEvent,
  showOverflowChips = true,
  onDragDrop,
}: Today3DaysCalendarProps) {
  const [overflowGroup, setOverflowGroup] = useState<OverflowGroup | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null)
  const [suppressTapUntil, setSuppressTapUntil] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const pointerGestureRef = useRef<PointerDragGesture | null>(null)
  const dragPreviewRef = useRef<DragPreviewState | null>(null)
  const autoScrollRef = useRef<{ frame: number | null; speed: number }>({ frame: null, speed: 0 })
  const cleanupPointerListenersRef = useRef<(() => void) | null>(null)
  const dragLockSnapshotRef = useRef<{
    bodyUserSelect: string
    bodyTouchAction: string
    scrollerTouchAction: string
  } | null>(null)
  const days = useMemo(() => [0, 1, 2].map((i) => addDays(selectedDate, i)), [selectedDate])
  const dayBlocks = useMemo(
    () => days.map((date) => buildTimeBlocksForDay({ date, events, tasks, calendarColorMap }).filter(overlapsVisibleRange)),
    [calendarColorMap, days, events, tasks],
  )

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current.frame != null) {
      cancelAnimationFrame(autoScrollRef.current.frame)
      autoScrollRef.current.frame = null
    }
    autoScrollRef.current.speed = 0
  }, [])

  const lockDragInteraction = useCallback(() => {
    if (typeof document === "undefined" || dragLockSnapshotRef.current) return
    dragLockSnapshotRef.current = {
      bodyUserSelect: document.body.style.userSelect,
      bodyTouchAction: document.body.style.touchAction,
      scrollerTouchAction: scrollContainerRef.current?.style.touchAction ?? "",
    }
    document.body.style.userSelect = "none"
    document.body.style.touchAction = "none"
    if (scrollContainerRef.current) scrollContainerRef.current.style.touchAction = "none"
  }, [])

  const unlockDragInteraction = useCallback(() => {
    if (typeof document === "undefined" || !dragLockSnapshotRef.current) return
    document.body.style.userSelect = dragLockSnapshotRef.current.bodyUserSelect
    document.body.style.touchAction = dragLockSnapshotRef.current.bodyTouchAction
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.touchAction = dragLockSnapshotRef.current.scrollerTouchAction
    }
    dragLockSnapshotRef.current = null
  }, [])

  const resolveDragPreview = useCallback((gesture: PointerDragGesture, clientX: number, clientY: number): DragPreviewState | null => {
    const grid = gridRef.current
    if (!grid) return null

    const rect = grid.getBoundingClientRect()
    const columnWidth = Math.max(1, (rect.width - TIME_GUTTER_WIDTH) / 3)
    const xInSchedule = clientX - rect.left - TIME_GUTTER_WIDTH
    const dayIndex = clamp(Math.floor(xInSchedule / columnWidth), 0, 2)
    const yInGrid = clientY - rect.top - gesture.initialOffsetY
    const rawMinutes = ((clamp(yInGrid, 0, TOTAL_HEIGHT) / TOTAL_HEIGHT) * 24 * 60)
    const snappedMinutes = snapToQuarter(rawMinutes)
    const clampedMinutes = clamp(snappedMinutes, START_HOUR * 60, END_HOUR * 60 - gesture.item.durationMinutes)
    const previewStartTime = minutesToDate(days[dayIndex], clampedMinutes)
    const previewEndTime = new Date(previewStartTime.getTime() + gesture.item.durationMinutes * 60 * 1000)

    return {
      item: gesture.item,
      sourceKey: gesture.sourceKey,
      dayIndex,
      previewTop: minutesToTop(clampedMinutes),
      previewStartTime,
      previewEndTime,
      hasMoved: gesture.hasMoved,
    }
  }, [days])

  const updateDragPreview = useCallback((gesture: PointerDragGesture, clientX: number, clientY: number) => {
    const next = resolveDragPreview(gesture, clientX, clientY)
    if (!next) return null
    dragPreviewRef.current = next
    setDragPreview(next)
    return next
  }, [resolveDragPreview])

  const runAutoScroll = useCallback((clientY: number) => {
    const scroller = scrollContainerRef.current
    const gesture = pointerGestureRef.current
    if (!scroller || !gesture?.active) return

    const rect = scroller.getBoundingClientRect()
    const relativeY = clientY - rect.top
    const bottomDistance = rect.bottom - clientY
    let speed = 0

    if (relativeY < DRAG_AUTO_SCROLL_ZONE) {
      const ratio = clamp(1 - relativeY / DRAG_AUTO_SCROLL_ZONE, 0, 1)
      speed = -DRAG_AUTO_SCROLL_MAX_SPEED * ratio
    } else if (bottomDistance < DRAG_AUTO_SCROLL_ZONE) {
      const ratio = clamp(1 - bottomDistance / DRAG_AUTO_SCROLL_ZONE, 0, 1)
      speed = DRAG_AUTO_SCROLL_MAX_SPEED * ratio
    }

    autoScrollRef.current.speed = speed
    if (speed === 0) {
      stopAutoScroll()
      return
    }
    if (autoScrollRef.current.frame != null) return

    const step = () => {
      const activeGesture = pointerGestureRef.current
      const activeScroller = scrollContainerRef.current
      if (!activeGesture?.active || !activeScroller || autoScrollRef.current.speed === 0) {
        autoScrollRef.current.frame = null
        return
      }
      const maxScrollTop = Math.max(0, activeScroller.scrollHeight - activeScroller.clientHeight)
      activeScroller.scrollTop = clamp(activeScroller.scrollTop + autoScrollRef.current.speed, 0, maxScrollTop)
      updateDragPreview(activeGesture, activeGesture.lastClientX, activeGesture.lastClientY)
      autoScrollRef.current.frame = requestAnimationFrame(step)
    }

    autoScrollRef.current.frame = requestAnimationFrame(step)
  }, [stopAutoScroll, updateDragPreview])

  const clearPointerGesture = useCallback(() => {
    const gesture = pointerGestureRef.current
    if (gesture?.longPressTimer) clearTimeout(gesture.longPressTimer)
    if (gesture?.captureTarget?.hasPointerCapture?.(gesture.pointerId)) {
      gesture.captureTarget.releasePointerCapture(gesture.pointerId)
    }
    pointerGestureRef.current = null
    cleanupPointerListenersRef.current?.()
    cleanupPointerListenersRef.current = null
    stopAutoScroll()
    unlockDragInteraction()
  }, [stopAutoScroll, unlockDragInteraction])

  const startPointerDrag = useCallback((gesture: PointerDragGesture) => {
    if (gesture.active) return
    if (gesture.longPressTimer) {
      clearTimeout(gesture.longPressTimer)
      gesture.longPressTimer = null
    }
    gesture.active = true
    lockDragInteraction()
    updateDragPreview(gesture, gesture.lastClientX, gesture.lastClientY)
  }, [lockDragInteraction, updateDragPreview])

  const completePointerDrag = useCallback((cancel = false) => {
    const gesture = pointerGestureRef.current
    const preview = dragPreviewRef.current
    const didMove = !!gesture?.hasMoved || !!preview?.hasMoved

    clearPointerGesture()
    dragPreviewRef.current = null
    setDragPreview(null)

    if (!cancel && gesture?.active) {
      if (preview && didMove) {
        const moved = preview.previewStartTime.getTime() !== gesture.item.startTime.getTime()
        if (moved) onDragDrop?.(gesture.item, preview.previewStartTime, preview.previewEndTime)
      }
      setSuppressTapUntil(Date.now() + 250)
    }
  }, [clearPointerGesture, onDragDrop])

  const handleItemPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    item: DragItem,
    itemTop: number,
    sourceKey: string,
  ) => {
    if (!onDragDrop || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, input, textarea, select, a, [contenteditable='true']")) return
    if (!gridRef.current) return

    completePointerDrag(true)
    if (event.pointerType === "mouse") {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
    }

    const rect = gridRef.current.getBoundingClientRect()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const gesture: PointerDragGesture = {
      item,
      sourceKey,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      captureTarget: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      initialOffsetY: event.clientY - rect.top - itemTop,
      itemTop,
      active: false,
      hasMoved: false,
      longPressTimer: null,
    }
    pointerGestureRef.current = gesture

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      gesture.longPressTimer = setTimeout(() => startPointerDrag(gesture), TOUCH_LONG_PRESS_MS)
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeGesture = pointerGestureRef.current
      if (!activeGesture || activeGesture.pointerId !== moveEvent.pointerId) return
      activeGesture.lastClientX = moveEvent.clientX
      activeGesture.lastClientY = moveEvent.clientY

      const deltaX = Math.abs(moveEvent.clientX - activeGesture.startClientX)
      const deltaY = Math.abs(moveEvent.clientY - activeGesture.startClientY)

      if (!activeGesture.active) {
        if (activeGesture.pointerType === "touch" || activeGesture.pointerType === "pen") {
          if (Math.max(deltaX, deltaY) > TOUCH_MOVE_CANCEL_PX) {
            if (activeGesture.longPressTimer) clearTimeout(activeGesture.longPressTimer)
            activeGesture.longPressTimer = null
          }
          return
        }
        if (Math.max(deltaX, deltaY) < POINTER_DRAG_THRESHOLD_PX) return
        activeGesture.hasMoved = true
        startPointerDrag(activeGesture)
      } else {
        activeGesture.hasMoved = true
      }

      if (moveEvent.cancelable) moveEvent.preventDefault()
      updateDragPreview(activeGesture, moveEvent.clientX, moveEvent.clientY)
      runAutoScroll(moveEvent.clientY)
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (pointerGestureRef.current?.pointerId !== upEvent.pointerId) return
      completePointerDrag(false)
    }

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (pointerGestureRef.current?.pointerId !== cancelEvent.pointerId) return
      completePointerDrag(true)
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false })
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerCancel)
    cleanupPointerListenersRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerCancel)
    }
  }, [completePointerDrag, onDragDrop, runAutoScroll, startPointerDrag, updateDragPreview])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        const scrollTo = getInitialScrollTop?.() ?? DEFAULT_SCROLL_HOUR * HOUR_HEIGHT - SCROLL_LABEL_OFFSET
        scrollContainerRef.current.scrollTop = Math.max(0, scrollTo)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [getInitialScrollTop])

  useEffect(() => {
    return () => completePointerDrag(true)
  }, [completePointerDrag])

  useEffect(() => {
    const cancelActiveDrag = () => completePointerDrag(true)
    const cancelWhenHidden = () => {
      if (document.visibilityState !== "visible") cancelActiveDrag()
    }
    window.addEventListener("blur", cancelActiveDrag)
    document.addEventListener("visibilitychange", cancelWhenHidden)
    return () => {
      window.removeEventListener("blur", cancelActiveDrag)
      document.removeEventListener("visibilitychange", cancelWhenHidden)
    }
  }, [completePointerDrag])

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 min-h-0 overflow-auto no-scrollbar bg-background"
      onScroll={() => {
        if (scrollContainerRef.current) {
          onScrollPositionChange?.(scrollContainerRef.current.scrollTop)
        }
      }}
    >
      <div className="sticky top-0 z-40 h-0 overflow-visible">
        <div
          className="grid h-8 border-b border-border/40 bg-background shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
        >
          <div className="border-r border-border/60 bg-background" />
          {days.map((day) => {
            const isSunday = day.getDay() === 0
            const isToday = startOfLocalDay(day).getTime() === startOfLocalDay(currentTime).getTime()
            return (
              <button
                type="button"
                key={day.toISOString()}
                onClick={() => onDateSelect?.(day)}
                className={cn(
                  "border-r border-border/60 bg-muted/15 px-1.5 text-center text-[11px] font-semibold active:bg-muted/30",
                  isToday && "bg-primary/10",
                  isToday ? "text-primary" : isSunday ? "text-red-300/90" : "text-muted-foreground",
                )}
                aria-label={`${format(day, "M/d(E)", { locale: ja })}をDayで表示`}
              >
                {format(day, "M/d(E)", { locale: ja })}
              </button>
            )
          })}
        </div>
      </div>

      {eventsLoading && dayBlocks.every((items) => items.length === 0) ? (
        <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
      ) : (
        <div ref={gridRef} className="grid" style={{ gridTemplateColumns: GRID_COLUMNS, height: TOTAL_HEIGHT }}>
          <div className="relative border-r border-border/30 bg-background/90 pointer-events-none select-none" aria-hidden="true">
            {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index).map((hour) => (
              <div
                key={hour}
                className="absolute flex w-full justify-end pr-2 text-[10px] font-medium text-muted-foreground/70"
                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT - 6 }}
              >
                {hour !== 0 && `${hour}:00`}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const clusters = buildConflictClusters(dayBlocks[dayIndex], showOverflowChips)
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "relative border-r border-border/60",
                  dayIndex > 0 && "border-l border-border/50",
                  dayIndex % 2 === 1 ? "bg-muted/[0.035]" : "bg-background"
                )}
                style={dayIndex > 0 ? { boxShadow: "inset 1px 0 rgba(255,255,255,0.06)" } : undefined}
              >
                {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
                  <div
                    key={index}
                    className="absolute left-0 right-0 border-t border-border/20"
                    style={{ top: index * HOUR_HEIGHT }}
                  />
                ))}

                {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
                  <div
                    key={`half-${index}`}
                    className="absolute left-0 right-0 border-t border-dashed border-border/10"
                    style={{ top: index * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}

                {clusters.map((cluster, clusterIndex) => {
                  const hasHidden = cluster.hidden.length > 0
                  const hiddenStart = hasHidden
                    ? new Date(Math.min(...cluster.hidden.map((item) => item.startTime.getTime())))
                    : cluster.start
                  const hiddenEnd = hasHidden
                    ? new Date(Math.max(...cluster.hidden.map((item) => item.endTime.getTime())))
                    : cluster.end
                  const clusterTop = topForDate(cluster.start, cluster.start)
                  const clusterHeight = Math.max(topForDate(cluster.end, cluster.start) - clusterTop, 30)
                  const chipTop = clamp(topForDate(hiddenStart, cluster.start), clusterTop + 3, clusterTop + Math.max(3, clusterHeight - 28))
                  return (
                    <Fragment key={`${day.toISOString()}-${clusterIndex}-${cluster.start.getTime()}`}>
                      {cluster.visible.map((layout) => {
                        const sourceKey = itemKey(layout)
                        const toggleItem = layout.originalTask && onToggleTask
                          ? () => onToggleTask(layout.originalTask!.id)
                          : layout.originalEvent && onToggleEvent && layout.originalEvent.sync_status !== "pending"
                            ? () => onToggleEvent(layout.id)
                            : undefined
                        const isDone = layout.isCompleted
                        const isNow = currentTime >= layout.startTime && currentTime < layout.endTime
                        const dragItem: DragItem = {
                          type: layout.originalEvent ? "event" : "task",
                          id: layout.id,
                          startTime: layout.startTime,
                          endTime: layout.endTime,
                          durationMinutes: durationMinutesForItem(layout),
                        }
                        const isDraggingThisItem = dragPreview?.sourceKey === sourceKey
                        return (
                          <div
                            key={sourceKey}
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              if (suppressTapUntil > Date.now()) {
                                event.preventDefault()
                                return
                              }
                              onItemTap?.(layout)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return
                              event.preventDefault()
                              onItemTap?.(layout)
                            }}
                            onPointerDown={(event) => handleItemPointerDown(event, dragItem, layout.top, sourceKey)}
                            aria-grabbed={isDraggingThisItem || undefined}
                            className={cn(
                              "absolute z-10 flex min-w-0 items-start justify-start gap-1.5 overflow-hidden rounded-md border-l-[3px] text-left align-top shadow-sm outline-none active:opacity-80",
                              "focus-visible:ring-2 focus-visible:ring-primary/80",
                              onDragDrop && "cursor-grab select-none active:cursor-grabbing",
                              isNow && "ring-1 ring-primary/50",
                              isDone && "opacity-55",
                              isDraggingThisItem && "invisible",
                            )}
                            style={{
                              ...eventStyle(layout.color),
                              ...eventPositionStyle(layout),
                              paddingLeft: 4,
                              paddingRight: 4,
                              paddingTop: 4,
                              paddingBottom: 4,
                            }}
                          >
                            {toggleItem && (
                              <button
                                type="button"
                                aria-pressed={isDone}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleItem()
                                }}
                                className="no-tap-highlight -m-2 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background/30 active:bg-background/40 focus-visible:ring-2 focus-visible:ring-primary/80"
                                aria-label={isDone ? `${layout.title}を未完了に戻す` : `${layout.title}を完了にする`}
                              >
                                {isDone ? (
                                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Square className="h-3.5 w-3.5" style={{ color: layout.color }} />
                                )}
                              </button>
                            )}
                            <span
                              className={cn(
                                "m-0 block min-w-0 flex-1 self-start overflow-hidden whitespace-normal text-left text-[10px] font-semibold leading-[12px] text-foreground",
                                isDone && "line-through text-muted-foreground"
                              )}
                              style={{
                                display: "-webkit-box",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: titleLineCount(layout),
                              }}
                            >
                              {layout.title}
                            </span>
                          </div>
                        )
                      })}
                      {hasHidden && (
                        <button
                          type="button"
                          onClick={() => setOverflowGroup({ date: day, hidden: cluster.hidden, start: hiddenStart, end: hiddenEnd })}
                          className="absolute z-20 grid h-7 w-7 place-items-center rounded-full border border-primary/45 bg-background/95 text-[10px] font-bold text-primary shadow-lg active:scale-95"
                          style={overflowChipStyle(cluster, chipTop)}
                          aria-label={`${cluster.hidden.length}件の重なっている予定を表示`}
                        >
                          +{cluster.hidden.length}
                        </button>
                      )}
                    </Fragment>
                  )
                })}
                {dragPreview?.dayIndex === dayIndex && (
                  <DragPreviewBlock preview={dragPreview} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {overflowGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/58 px-4 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="閉じる"
            onClick={() => setOverflowGroup(null)}
          />
          <div className="relative w-full max-w-[340px] rounded-2xl border border-border/70 bg-background/95 p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-primary">
                  {format(overflowGroup.date, "M/d(E)", { locale: ja })} {format(overflowGroup.start, "HH:mm")} - {format(overflowGroup.end, "HH:mm")}
                </div>
                <div className="mt-0.5 text-base font-bold">他の予定</div>
              </div>
              <button
                type="button"
                onClick={() => setOverflowGroup(null)}
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              {overflowGroup.hidden.map((item) => (
                <button
                  key={`${item.source}-${item.id}`}
                  type="button"
                  onClick={() => {
                    setOverflowGroup(null)
                    onItemTap?.(item)
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left active:bg-muted/45"
                >
                  <span className="h-10 w-1 rounded-full" style={{ backgroundColor: item.color || "#8fd77a" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-muted-foreground">
                      {format(item.startTime, "HH:mm")} - {format(item.endTime, "HH:mm")}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
                      {item.title}
                    </span>
                    {(item.originalEvent?.description || item.originalTask?.memo) && (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.originalEvent?.description || item.originalTask?.memo}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DragPreviewBlock({ preview }: { preview: DragPreviewState }) {
  const isTask = preview.item.type === "task"
  const startStr = format(preview.previewStartTime, "HH:mm")
  const endStr = format(preview.previewEndTime, "HH:mm")
  const height = Math.max((preview.item.durationMinutes / 60) * HOUR_HEIGHT, HOUR_HEIGHT * 0.4)

  return (
    <div
      className="pointer-events-none absolute left-1 right-1 z-40 overflow-hidden rounded-md border-2 border-dashed px-2 py-1 shadow-lg"
      style={{
        top: preview.previewTop,
        height,
      }}
    >
      <div
        className={cn(
          "absolute inset-0",
          isTask ? "bg-green-400/20" : "bg-sky-400/20",
        )}
      />
      <div
        className={cn(
          "absolute inset-0 rounded-[inherit] border",
          isTask ? "border-green-400/70" : "border-sky-400/70",
        )}
      />
      <div className="relative flex min-w-0 items-center gap-1.5 text-[11px] font-bold">
        <span className={isTask ? "text-green-200" : "text-sky-200"}>
          {startStr} - {endStr}
        </span>
      </div>
    </div>
  )
}
