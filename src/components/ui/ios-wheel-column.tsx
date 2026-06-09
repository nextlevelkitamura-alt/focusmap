"use client"

import {
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { cn } from "@/lib/utils"

const IOS_WHEEL_ITEM_HEIGHT = 44
const IOS_WHEEL_OFFSETS = [-3, -2, -1, 0, 1, 2, 3]

type WheelDragState = {
  baseVirtualIndex: number
  startY: number
  lastY: number
  lastAt: number
  velocity: number
  moved: boolean
}

type IosWheelColumnProps = {
  label: string
  values: readonly number[]
  value: number
  onPreview: (value: number) => void
  onCommit: (value: number) => void
  formatValue?: (value: number) => string
  dataColumn?: string
  idPrefix?: string
}

function moduloIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

function nearestWheelIndex(currentVirtualIndex: number, targetIndex: number, length: number) {
  if (length <= 0) return 0
  const base = Math.round((currentVirtualIndex - targetIndex) / length) * length + targetIndex
  const previous = base - length
  const next = base + length
  return [previous, base, next].reduce((nearest, candidate) => (
    Math.abs(candidate - currentVirtualIndex) < Math.abs(nearest - currentVirtualIndex) ? candidate : nearest
  ), base)
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function defaultFormatValue(value: number) {
  return String(value).padStart(2, "0")
}

export function IosWheelColumn({
  label,
  values,
  value,
  onPreview,
  onCommit,
  formatValue = defaultFormatValue,
  dataColumn,
  idPrefix = label,
}: IosWheelColumnProps) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.max(0, values.indexOf(value))
  const [virtualIndex, setVirtualIndex] = useState(selectedIndex)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettling, setIsSettling] = useState(false)
  const virtualIndexRef = useRef(virtualIndex)
  const previewIndexRef = useRef(selectedIndex)
  const dragRef = useRef<WheelDragState | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const ignoreClickUntilRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const columnKey = dataColumn ?? label

  const clearSettleTimer = useCallback(() => {
    if (!settleTimerRef.current) return
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
  }, [])

  const updateVirtualIndex = useCallback((nextVirtualIndex: number) => {
    if (values.length === 0) return

    virtualIndexRef.current = nextVirtualIndex
    setVirtualIndex(nextVirtualIndex)

    const nextIndex = moduloIndex(Math.round(nextVirtualIndex), values.length)
    if (previewIndexRef.current === nextIndex) return
    previewIndexRef.current = nextIndex
    onPreview(values[nextIndex])
  }, [onPreview, values])

  const settleToIndex = useCallback((absoluteIndex: number, commit: boolean) => {
    if (values.length === 0) return

    const nextIndex = moduloIndex(absoluteIndex, values.length)
    previewIndexRef.current = nextIndex
    virtualIndexRef.current = absoluteIndex
    setVirtualIndex(absoluteIndex)
    onPreview(values[nextIndex])
    if (commit) onCommit(values[nextIndex])

    setIsSettling(true)
    clearSettleTimer()
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      setIsSettling(false)
    }, 190)
  }, [clearSettleTimer, onCommit, onPreview, values])

  const finishDrag = useCallback(() => {
    const drag = dragRef.current
    if (!drag || values.length === 0) return

    dragRef.current = null
    activePointerIdRef.current = null
    setIsDragging(false)

    if (!drag.moved) return

    const projectedItems = clampNumber((drag.velocity * 180) / IOS_WHEEL_ITEM_HEIGHT, -7, 7)
    const targetIndex = Math.round(virtualIndexRef.current + projectedItems)

    ignoreClickUntilRef.current = Date.now() + 160
    settleToIndex(targetIndex, true)
  }, [settleToIndex, values.length])

  const startDrag = useCallback((clientY: number) => {
    clearSettleTimer()
    setIsDragging(true)
    setIsSettling(false)
    dragRef.current = {
      baseVirtualIndex: virtualIndexRef.current,
      startY: clientY,
      lastY: clientY,
      lastAt: performance.now(),
      velocity: 0,
      moved: false,
    }
  }, [clearSettleTimer])

  const moveDrag = useCallback((clientY: number) => {
    const drag = dragRef.current
    if (!drag) return

    const totalDelta = drag.startY - clientY
    const now = performance.now()
    const dt = Math.max(8, now - drag.lastAt)
    const stepDelta = drag.lastY - clientY

    drag.velocity = stepDelta / dt
    drag.lastY = clientY
    drag.lastAt = now
    if (Math.abs(totalDelta) >= 2) drag.moved = true

    updateVirtualIndex(drag.baseVirtualIndex + totalDelta / IOS_WHEEL_ITEM_HEIGHT)
  }, [updateVirtualIndex])

  const handleOptionClick = useCallback((absoluteIndex: number) => {
    if (Date.now() < ignoreClickUntilRef.current) return
    const targetIndex = nearestWheelIndex(virtualIndexRef.current, moduloIndex(absoluteIndex, values.length), values.length)
    settleToIndex(targetIndex, true)
  }, [settleToIndex, values.length])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (values.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    clearSettleTimer()
    setIsDragging(false)
    setIsSettling(false)
    dragRef.current = null
    activePointerIdRef.current = null

    const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (primaryDelta === 0) return
    const step = primaryDelta > 0 ? 1 : -1
    settleToIndex(Math.round(virtualIndexRef.current) + step, true)
  }, [clearSettleTimer, settleToIndex, values.length])

  useEffect(() => {
    previewIndexRef.current = selectedIndex
    if (dragRef.current) return
    const nextVirtualIndex = nearestWheelIndex(virtualIndexRef.current, selectedIndex, values.length)
    virtualIndexRef.current = nextVirtualIndex
    setVirtualIndex(nextVirtualIndex)
  }, [selectedIndex, values.length])

  useEffect(() => {
    const node = wheelRef.current
    if (!node) return

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      event.stopPropagation()
      startDrag(touch.clientY)
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !dragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      moveDrag(touch.clientY)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.moved) event.preventDefault()
      event.stopPropagation()
      finishDrag()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      if (event.pointerType === "mouse" && event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      activePointerIdRef.current = event.pointerId
      node.setPointerCapture?.(event.pointerId)
      startDrag(event.clientY)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId || !dragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      moveDrag(event.clientY)
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId || !dragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      node.releasePointerCapture?.(event.pointerId)
      finishDrag()
    }

    node.addEventListener("touchstart", handleTouchStart, { passive: false })
    node.addEventListener("touchmove", handleTouchMove, { passive: false })
    node.addEventListener("touchend", handleTouchEnd, { passive: false })
    node.addEventListener("touchcancel", handleTouchEnd, { passive: false })
    node.addEventListener("pointerdown", handlePointerDown)
    node.addEventListener("pointermove", handlePointerMove)
    node.addEventListener("pointerup", handlePointerEnd)
    node.addEventListener("pointercancel", handlePointerEnd)

    return () => {
      node.removeEventListener("touchstart", handleTouchStart)
      node.removeEventListener("touchmove", handleTouchMove)
      node.removeEventListener("touchend", handleTouchEnd)
      node.removeEventListener("touchcancel", handleTouchEnd)
      node.removeEventListener("pointerdown", handlePointerDown)
      node.removeEventListener("pointermove", handlePointerMove)
      node.removeEventListener("pointerup", handlePointerEnd)
      node.removeEventListener("pointercancel", handlePointerEnd)
    }
  }, [finishDrag, moveDrag, startDrag])

  useEffect(() => {
    return () => clearSettleTimer()
  }, [clearSettleTimer])

  const roundedVirtualIndex = Math.round(virtualIndex)
  const currentIndex = moduloIndex(roundedVirtualIndex, values.length)

  return (
    <div
      ref={wheelRef}
      className="relative h-full min-w-0 touch-none select-none overflow-hidden [touch-action:none]"
      data-wheel-column={columnKey}
      data-time-wheel-column={columnKey}
      onWheel={handleWheel}
      aria-label={label}
      role="listbox"
      aria-activedescendant={`${idPrefix}-${values[currentIndex]}`}
    >
      {IOS_WHEEL_OFFSETS.map(offset => {
        const absoluteIndex = roundedVirtualIndex + offset
        const optionIndex = moduloIndex(absoluteIndex, values.length)
        const optionValue = values[optionIndex]
        const relativeOffset = absoluteIndex - virtualIndex
        const distance = Math.abs(relativeOffset)
        const isCurrent = optionIndex === currentIndex
        const opacity = distance > 2.85 ? 0.08 : Math.max(0.18, 1 - distance * 0.34)
        const scale = 1 - Math.min(distance * 0.075, 0.22)
        const y = relativeOffset * IOS_WHEEL_ITEM_HEIGHT

        return (
          <button
            key={`${idPrefix}-${absoluteIndex}`}
            id={`${idPrefix}-${optionValue}`}
            type="button"
            role="option"
            aria-selected={isCurrent}
            data-wheel-option={columnKey}
            data-time-wheel-option={columnKey}
            data-wheel-value={optionValue}
            data-time-wheel-value={optionValue}
            onClick={() => handleOptionClick(absoluteIndex)}
            className={cn(
              "absolute inset-x-1 top-1/2 flex h-11 -translate-y-1/2 items-center justify-center rounded-xl text-[22px] font-semibold leading-none tabular-nums tracking-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
              isCurrent ? "text-neutral-50" : "text-neutral-500",
            )}
            style={{
              opacity,
              transform: `translate3d(0, ${y}px, 0) translateY(-50%) scale(${scale})`,
              transition: isDragging ? "none" : isSettling ? "transform 190ms cubic-bezier(.2,.85,.2,1), opacity 190ms ease" : "color 120ms ease",
            }}
          >
            {formatValue(optionValue)}
          </button>
        )
      })}
    </div>
  )
}
