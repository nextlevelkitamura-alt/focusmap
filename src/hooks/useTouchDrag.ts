"use client"

import { useRef, useCallback, useEffect, useState } from "react"

// --- Constants ---
const LONG_PRESS_MS = 350
const SNAP_MINUTES = 15
const AUTO_SCROLL_ZONE = 56 // px from edge
const AUTO_SCROLL_MAX_SPEED = 2 // px per frame
const HOUR_HEIGHT = 56 // must match calendar grid
const TOTAL_HEIGHT = HOUR_HEIGHT * 24

// --- Types ---

export interface DragItem {
    type: 'task' | 'event'
    id: string
    startTime: Date
    endTime: Date
    durationMinutes: number
}

export interface DragState {
    isDragging: boolean
    dragItem: DragItem | null
    /** Current snapped start time during drag */
    previewStartTime: Date | null
    /** Current snapped end time during drag */
    previewEndTime: Date | null
    /** Y position of drag ghost (top in px relative to grid) */
    previewTop: number
}

interface UseTouchDragOptions {
    /** Ref to the scrollable grid container */
    gridRef: React.RefObject<HTMLDivElement | null>
    /** Called when drag completes with new times */
    onDrop: (item: DragItem, newStartTime: Date, newEndTime: Date) => void
    /** Whether drag is enabled */
    enabled?: boolean
}

// --- Helpers ---

function snapToQuarter(minutes: number): number {
    return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

function minutesToTop(minutes: number): number {
    return (minutes / (24 * 60)) * TOTAL_HEIGHT
}

function topToMinutes(top: number): number {
    return (top / TOTAL_HEIGHT) * 24 * 60
}

function minutesToDate(base: Date, minutes: number): Date {
    const d = new Date(base)
    d.setHours(0, 0, 0, 0)
    d.setMinutes(minutes)
    return d
}

// --- Hook ---

export function useTouchDrag({ gridRef, onDrop, enabled = true }: UseTouchDragOptions) {
    const [dragState, setDragState] = useState<DragState>({
        isDragging: false,
        dragItem: null,
        previewStartTime: null,
        previewEndTime: null,
        previewTop: 0,
    })

    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoScrollRAF = useRef<number | null>(null)
    const touchStartY = useRef(0)
    const touchStartScrollTop = useRef(0)
    const initialOffsetInItem = useRef(0)
    const dragItemRef = useRef<DragItem | null>(null)
    const isDraggingRef = useRef(false)
    const pageScrollLockedRef = useRef(false)
    const originalBodyOverflowRef = useRef('')
    const originalBodyTouchActionRef = useRef('')
    const originalBodyOverscrollBehaviorRef = useRef('')
    const originalHtmlOverscrollBehaviorRef = useRef('')
    // ドロップ情報を保持するref（setDragState内でonDropを呼ぶのを避けるため）
    const pendingDropRef = useRef<{ item: DragItem; startTime: Date; endTime: Date } | null>(null)

    // Cancel long press
    const cancelLongPress = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
        }
    }, [])

    // Stop auto-scroll
    const stopAutoScroll = useCallback(() => {
        if (autoScrollRAF.current) {
            cancelAnimationFrame(autoScrollRAF.current)
            autoScrollRAF.current = null
        }
    }, [])

    const preventPageTouchMove = useCallback((e: TouchEvent) => {
        if (!isDraggingRef.current || !e.cancelable) return
        e.preventDefault()
    }, [])

    const lockPageScroll = useCallback(() => {
        if (typeof document === 'undefined' || pageScrollLockedRef.current) return

        const { body, documentElement } = document
        originalBodyOverflowRef.current = body.style.overflow
        originalBodyTouchActionRef.current = body.style.touchAction
        originalBodyOverscrollBehaviorRef.current = body.style.overscrollBehavior
        originalHtmlOverscrollBehaviorRef.current = documentElement.style.overscrollBehavior

        body.style.overflow = 'hidden'
        body.style.touchAction = 'none'
        body.style.overscrollBehavior = 'none'
        documentElement.style.overscrollBehavior = 'none'
        document.addEventListener('touchmove', preventPageTouchMove, { passive: false, capture: true })
        pageScrollLockedRef.current = true
    }, [preventPageTouchMove])

    const unlockPageScroll = useCallback(() => {
        if (typeof document === 'undefined' || !pageScrollLockedRef.current) return

        const { body, documentElement } = document
        body.style.overflow = originalBodyOverflowRef.current
        body.style.touchAction = originalBodyTouchActionRef.current
        body.style.overscrollBehavior = originalBodyOverscrollBehaviorRef.current
        documentElement.style.overscrollBehavior = originalHtmlOverscrollBehaviorRef.current
        document.removeEventListener('touchmove', preventPageTouchMove, { capture: true })
        pageScrollLockedRef.current = false
    }, [preventPageTouchMove])

    const lockDragScroll = useCallback(() => {
        if (gridRef.current) {
            gridRef.current.style.overflow = 'hidden'
            gridRef.current.style.touchAction = 'none'
        }
        lockPageScroll()
    }, [gridRef, lockPageScroll])

    const restoreGridScroll = useCallback(() => {
        if (gridRef.current) {
            gridRef.current.style.overflow = ''
            gridRef.current.style.touchAction = ''
        }
        unlockPageScroll()
    }, [gridRef, unlockPageScroll])

    // Calculate preview position from touch
    const updatePreview = useCallback((touchClientY: number) => {
        const grid = gridRef.current
        const item = dragItemRef.current
        if (!grid || !item) return

        const rect = grid.getBoundingClientRect()
        const scrollTop = grid.scrollTop
        // Position within the full grid (accounting for scroll)
        const gridY = touchClientY - rect.top + scrollTop - initialOffsetInItem.current

        // Convert to minutes and snap
        const rawMinutes = topToMinutes(Math.max(0, gridY))
        const snappedMinutes = snapToQuarter(rawMinutes)
        const clampedMinutes = Math.max(0, Math.min(24 * 60 - item.durationMinutes, snappedMinutes))

        const previewTop = minutesToTop(clampedMinutes)
        const baseDate = item.startTime
        const newStart = minutesToDate(baseDate, clampedMinutes)
        const newEnd = minutesToDate(baseDate, clampedMinutes + item.durationMinutes)

        setDragState(prev => ({
            ...prev,
            previewStartTime: newStart,
            previewEndTime: newEnd,
            previewTop,
        }))
    }, [gridRef])

    // Auto-scroll logic
    const runAutoScroll = useCallback((touchClientY: number) => {
        const grid = gridRef.current
        if (!grid) return

        const rect = grid.getBoundingClientRect()
        const relativeY = touchClientY - rect.top
        const gridHeight = rect.height

        let scrollSpeed = 0

        if (relativeY < AUTO_SCROLL_ZONE) {
            const ratio = Math.max(0, Math.min(1, 1 - relativeY / AUTO_SCROLL_ZONE))
            scrollSpeed = -AUTO_SCROLL_MAX_SPEED * ratio
        } else if (relativeY > gridHeight - AUTO_SCROLL_ZONE) {
            const ratio = Math.max(0, Math.min(1, (relativeY - (gridHeight - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE))
            scrollSpeed = AUTO_SCROLL_MAX_SPEED * ratio
        }

        if (scrollSpeed !== 0) {
            const scroll = () => {
                if (!isDraggingRef.current || !grid) return
                const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight)
                const nextScrollTop = Math.max(0, Math.min(maxScrollTop, grid.scrollTop + scrollSpeed))
                if (nextScrollTop === grid.scrollTop) {
                    autoScrollRAF.current = null
                    return
                }
                grid.scrollTop = nextScrollTop
                updatePreview(touchClientY)
                autoScrollRAF.current = requestAnimationFrame(scroll)
            }
            stopAutoScroll()
            autoScrollRAF.current = requestAnimationFrame(scroll)
        } else {
            stopAutoScroll()
        }
    }, [gridRef, stopAutoScroll, updatePreview])

    // Start drag for a specific item
    const startDragForItem = useCallback((
        item: DragItem,
        touchClientY: number,
        itemTopInGrid: number,
    ) => {
        if (!enabled) return

        const grid = gridRef.current
        if (!grid) return

        const rect = grid.getBoundingClientRect()
        const scrollTop = grid.scrollTop
        const touchInGrid = touchClientY - rect.top + scrollTop

        // How far down within the item the touch started
        initialOffsetInItem.current = touchInGrid - itemTopInGrid

        dragItemRef.current = item
        isDraggingRef.current = true
        lockDragScroll()

        setDragState({
            isDragging: true,
            dragItem: item,
            previewStartTime: item.startTime,
            previewEndTime: item.endTime,
            previewTop: itemTopInGrid,
        })
    }, [enabled, gridRef, lockDragScroll])

    // Touch handlers to attach to individual items
    const createItemTouchHandlers = useCallback((
        item: DragItem,
        itemTopInGrid: number,
    ) => {
        if (!enabled) return {}

        const onTouchStart = (e: React.TouchEvent) => {
            const touch = e.touches[0]
            touchStartY.current = touch.clientY
            touchStartScrollTop.current = gridRef.current?.scrollTop ?? 0
            const initialClientY = touch.clientY

            // Start long press timer
            longPressTimer.current = setTimeout(() => {
                // Check if finger hasn't moved much (still a long press)
                startDragForItem(item, initialClientY, itemTopInGrid)

                // Note: Vibration removed due to browser restrictions causing console warnings
                // Visual feedback (drag preview) provides sufficient user feedback
            }, LONG_PRESS_MS)
        }

        const onTouchMove = (e: React.TouchEvent) => {
            const touch = e.touches[0]

            // If not yet dragging, check if we should cancel long press
            if (!isDraggingRef.current) {
                const moveDistance = Math.abs(touch.clientY - touchStartY.current)
                if (moveDistance > 10) {
                    cancelLongPress()
                }
                return
            }

            // We're dragging - update preview.
            // Scroll prevention is handled by temporarily setting the grid overflow to hidden
            // when drag starts (instead of relying on non-passive preventDefault).
            if (e.cancelable) e.preventDefault()

            updatePreview(touch.clientY)
            runAutoScroll(touch.clientY)
        }

        const completeDrag = () => {
            cancelLongPress()
            stopAutoScroll()

            // Restore scroll FIRST (always execute, even if errors occur below)
            restoreGridScroll()

            if (isDraggingRef.current && dragItemRef.current) {
                // Complete the drag
                const item = dragItemRef.current

                // setDragState 内で onDrop を呼ばず、情報を保存して非同期に呼び出す
                // これにより「レンダリング中に別のコンポーネントを更新」するエラーを回避
                setDragState(prev => {
                    if (prev.previewStartTime && prev.previewEndTime) {
                        // Only trigger drop if time actually changed
                        const originalMinutes = item.startTime.getHours() * 60 + item.startTime.getMinutes()
                        const newMinutes = prev.previewStartTime.getHours() * 60 + prev.previewStartTime.getMinutes()

                        if (originalMinutes !== newMinutes) {
                            // onDrop を直接呼ばず、refに保存
                            pendingDropRef.current = {
                                item,
                                startTime: prev.previewStartTime,
                                endTime: prev.previewEndTime
                            }
                        }
                    }
                    return {
                        isDragging: false,
                        dragItem: null,
                        previewStartTime: null,
                        previewEndTime: null,
                        previewTop: 0,
                    }
                })

                // setDragState の処理が完了してから onDrop を呼び出す
                setTimeout(() => {
                    if (pendingDropRef.current) {
                        const { item: dropItem, startTime, endTime } = pendingDropRef.current
                        onDrop(dropItem, startTime, endTime)
                        pendingDropRef.current = null
                    }
                }, 0)
            }

            isDraggingRef.current = false
            dragItemRef.current = null
        }

        const onTouchEnd = () => {
            completeDrag()
        }

        const onTouchCancel = () => {
            completeDrag()
        }

        return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
    }, [enabled, gridRef, startDragForItem, cancelLongPress, updatePreview, runAutoScroll, stopAutoScroll, onDrop, restoreGridScroll])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelLongPress()
            stopAutoScroll()
            restoreGridScroll()
        }
    }, [cancelLongPress, stopAutoScroll, restoreGridScroll])

    return {
        dragState,
        createItemTouchHandlers,
    }
}
