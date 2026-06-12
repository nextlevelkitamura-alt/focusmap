"use client"

import {
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
} from "react"

type WheelScrollBehavior = "auto" | "smooth"

interface UseMomentumWheelOptions<T> {
  values: readonly T[]
  getIndex: (container: HTMLDivElement) => number
  scrollToIndex: (container: HTMLDivElement, index: number, behavior: WheelScrollBehavior) => void
  onPreview?: (value: T, index: number) => void
  onChange: (value: T, index: number) => void
  scrollEndDelay?: number
}

type DragState = {
  pointerId: number
  startY: number
  startScrollTop: number
  lastY: number
  lastAt: number
  velocity: number
  moved: boolean
}

type TouchDragState = Omit<DragState, "pointerId">

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}

export function useMomentumWheel<T>(options: UseMomentumWheelOptions<T>) {
  const optionsRef = useRef(options)

  const dragRef = useRef<DragState | null>(null)
  const touchDragRef = useRef<TouchDragState | null>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<number | null>(null)
  const isMomentumActiveRef = useRef(false)
  const ignoreNextClickRef = useRef(false)
  const lastPreviewIndexRef = useRef<number | null>(null)
  const hasUserInteractedRef = useRef(false)

  const stopMomentum = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    isMomentumActiveRef.current = false
  }, [])

  const clearScrollTimer = useCallback(() => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }
  }, [])

  const clearDragIdleTimer = useCallback(() => {
    if (dragIdleTimerRef.current) {
      window.clearTimeout(dragIdleTimerRef.current)
      dragIdleTimerRef.current = null
    }
  }, [])

  const commitNearest = useCallback((container: HTMLDivElement, behavior: WheelScrollBehavior = "smooth") => {
    const current = optionsRef.current
    if (current.values.length === 0) return

    const index = clampIndex(current.getIndex(container), current.values.length)
    lastPreviewIndexRef.current = index
    current.onPreview?.(current.values[index], index)
    current.scrollToIndex(container, index, behavior)
    current.onChange(current.values[index], index)
    hasUserInteractedRef.current = false
  }, [])

  const previewNearest = useCallback((container: HTMLDivElement) => {
    const current = optionsRef.current
    if (current.values.length === 0 || !current.onPreview) return

    const index = clampIndex(current.getIndex(container), current.values.length)
    if (lastPreviewIndexRef.current === index) return

    lastPreviewIndexRef.current = index
    current.onPreview(current.values[index], index)
  }, [])

  const scheduleCommit = useCallback((container: HTMLDivElement) => {
    if (dragRef.current || touchDragRef.current || isMomentumActiveRef.current) return
    clearScrollTimer()
    scrollTimerRef.current = window.setTimeout(() => {
      scrollTimerRef.current = null
      commitNearest(container)
    }, optionsRef.current.scrollEndDelay ?? 140)
  }, [clearScrollTimer, commitNearest])

  const startMomentum = useCallback((container: HTMLDivElement, initialVelocity: number) => {
    stopMomentum()

    if (container.scrollHeight <= container.clientHeight || Math.abs(initialVelocity) < 0.035) {
      commitNearest(container)
      return
    }

    isMomentumActiveRef.current = true
    let velocity = Math.max(-0.95, Math.min(0.95, initialVelocity))
    let previousAt = performance.now()

    const step = (now: number) => {
      const dt = Math.min(32, now - previousAt)
      previousAt = now

      const before = container.scrollTop
      container.scrollTop = before + velocity * dt
      const after = container.scrollTop
      if (after === before) {
        velocity = 0
      } else {
        previewNearest(container)
        velocity *= Math.exp(-dt / 220)
      }

      if (Math.abs(velocity) < 0.014) {
        frameRef.current = null
        isMomentumActiveRef.current = false
        commitNearest(container)
        return
      }

      frameRef.current = window.requestAnimationFrame(step)
    }

    frameRef.current = window.requestAnimationFrame(step)
  }, [commitNearest, previewNearest, stopMomentum])

  const finishTouchDrag = useCallback((container: HTMLDivElement) => {
    const drag = touchDragRef.current
    if (!drag) return

    touchDragRef.current = null
    clearDragIdleTimer()

    if (!drag.moved) {
      scheduleCommit(container)
      return
    }

    ignoreNextClickRef.current = true
    startMomentum(container, drag.velocity)
    window.setTimeout(() => {
      ignoreNextClickRef.current = false
    }, 80)
  }, [clearDragIdleTimer, scheduleCommit, startMomentum])

  const finishDrag = useCallback((container: HTMLDivElement, pointerId?: number) => {
    const drag = dragRef.current
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return

    dragRef.current = null
    clearDragIdleTimer()

    if (!drag.moved) return

    ignoreNextClickRef.current = true
    startMomentum(container, drag.velocity)
    window.setTimeout(() => {
      ignoreNextClickRef.current = false
    }, 80)
  }, [clearDragIdleTimer, startMomentum])

  const onScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (!hasUserInteractedRef.current) return
    previewNearest(event.currentTarget)
    scheduleCommit(event.currentTarget)
  }, [previewNearest, scheduleCommit])

  const beginNativeScroll = useCallback((container: HTMLDivElement) => {
    hasUserInteractedRef.current = true
    stopMomentum()
    clearScrollTimer()
    clearDragIdleTimer()
    previewNearest(container)
  }, [clearDragIdleTimer, clearScrollTimer, previewNearest, stopMomentum])

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation()
    beginNativeScroll(event.currentTarget)
  }, [beginNativeScroll])

  const onTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (dragRef.current) return

    const touch = event.touches[0]
    if (!touch) {
      beginNativeScroll(event.currentTarget)
      return
    }

    beginNativeScroll(event.currentTarget)
    touchDragRef.current = {
      startY: touch.clientY,
      startScrollTop: event.currentTarget.scrollTop,
      lastY: touch.clientY,
      lastAt: performance.now(),
      velocity: 0,
      moved: false,
    }
  }, [beginNativeScroll])

  const onTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (dragRef.current) return

    hasUserInteractedRef.current = true
    const drag = touchDragRef.current
    const touch = event.touches[0]
    if (!drag || !touch) {
      previewNearest(event.currentTarget)
      return
    }

    const totalDelta = drag.startY - touch.clientY
    if (Math.abs(totalDelta) < 2) return

    event.preventDefault()

    const now = performance.now()
    const dt = Math.max(8, now - drag.lastAt)
    const stepDelta = drag.lastY - touch.clientY
    drag.velocity = stepDelta / dt
    drag.lastY = touch.clientY
    drag.lastAt = now
    drag.moved = true
    ignoreNextClickRef.current = true

    const container = event.currentTarget
    container.scrollTop = drag.startScrollTop + totalDelta
    previewNearest(container)

    clearDragIdleTimer()
  }, [clearDragIdleTimer, previewNearest])

  const onTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (dragRef.current) return
    if (touchDragRef.current) {
      if (touchDragRef.current.moved) event.preventDefault()
      finishTouchDrag(event.currentTarget)
      return
    }
    if (!hasUserInteractedRef.current) return
    scheduleCommit(event.currentTarget)
  }, [finishTouchDrag, scheduleCommit])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.pointerType === "mouse" && event.button !== 0) return

    stopMomentum()
    clearScrollTimer()
    clearDragIdleTimer()
    hasUserInteractedRef.current = true
    touchDragRef.current = null
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: event.currentTarget.scrollTop,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocity: 0,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [clearDragIdleTimer, clearScrollTimer, stopMomentum])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const totalDelta = drag.startY - event.clientY
    if (Math.abs(totalDelta) < 2) return

    event.preventDefault()
    event.stopPropagation()

    const now = performance.now()
    const dt = Math.max(8, now - drag.lastAt)
    const stepDelta = drag.lastY - event.clientY
    drag.velocity = stepDelta / dt
    drag.lastY = event.clientY
    drag.lastAt = now
    drag.moved = true
    ignoreNextClickRef.current = true

    const container = event.currentTarget
    container.scrollTop = drag.startScrollTop + totalDelta
    previewNearest(container)

    clearDragIdleTimer()
  }, [clearDragIdleTimer, previewNearest])

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.stopPropagation()
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (drag.moved) {
      event.preventDefault()
    }

    finishDrag(event.currentTarget, event.pointerId)
  }, [finishDrag])

  const selectIndex = useCallback((container: HTMLDivElement | null, index: number) => {
    if (!container) return
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false
      return
    }
    stopMomentum()
    clearScrollTimer()
    clearDragIdleTimer()
    hasUserInteractedRef.current = true

    const current = optionsRef.current
    const clampedIndex = clampIndex(index, current.values.length)
    lastPreviewIndexRef.current = clampedIndex
    current.onPreview?.(current.values[clampedIndex], clampedIndex)
    current.scrollToIndex(container, clampedIndex, "smooth")
    current.onChange(current.values[clampedIndex], clampedIndex)
    hasUserInteractedRef.current = false
  }, [clearDragIdleTimer, clearScrollTimer, stopMomentum])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    return () => {
      stopMomentum()
      clearScrollTimer()
      clearDragIdleTimer()
    }
  }, [clearDragIdleTimer, clearScrollTimer, stopMomentum])

  return {
    onScroll,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    selectIndex,
    commitNearest,
  }
}
