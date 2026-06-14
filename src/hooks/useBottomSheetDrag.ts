"use client"

import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from "react"

type BottomSheetDragOptions = {
  enabled: boolean
  onDismiss: () => void
}

type DragState = {
  active: boolean
  tracking: boolean
  startX: number
  startY: number
  lastY: number
  lastTime: number
  velocityY: number
  translateY: number
  scrollElement: HTMLElement | null
  startScrollTop: number
}

const DRAG_HANDLE_SELECTOR = '[data-sheet-drag-handle="true"]'
const DRAG_IGNORE_SELECTOR = [
  "button",
  "input",
  "textarea",
  "select",
  "a[href]",
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-sheet-drag-ignore="true"]',
].join(", ")

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function isIgnoredDragTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest(DRAG_HANDLE_SELECTOR)) return false
  return Boolean(target.closest(DRAG_IGNORE_SELECTOR))
}

function isScrollableElement(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  const canScrollByStyle = /(auto|scroll|overlay)/.test(style.overflowY)
  return canScrollByStyle && element.scrollHeight > element.clientHeight + 1
}

function findScrollableAncestor(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof HTMLElement)) return null
  let element: HTMLElement | null = target
  while (element && element !== root.parentElement) {
    if (isScrollableElement(element)) return element
    if (element === root) break
    element = element.parentElement
  }
  return null
}

function dampDragDistance(distance: number) {
  if (typeof window === "undefined") return distance
  const softLimit = Math.max(220, window.innerHeight * 0.32)
  if (distance <= softLimit) return distance
  return softLimit + (distance - softLimit) * 0.34
}

function getDismissDistance(element: HTMLElement) {
  const height = element.getBoundingClientRect().height || 560
  return Math.min(180, Math.max(108, height * 0.22))
}

function clearDragStyles(element: HTMLElement) {
  element.style.removeProperty("transition")
  element.style.removeProperty("transform")
  element.style.removeProperty("will-change")
  element.removeAttribute("data-sheet-dragging")
}

export function useBottomSheetDrag<T extends HTMLElement>({
  enabled,
  onDismiss,
}: BottomSheetDragOptions) {
  const elementRef = useRef<T | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const cleanupTimerRef = useRef<number | null>(null)
  const stateRef = useRef<DragState>({
    active: false,
    tracking: false,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0,
    translateY: 0,
    scrollElement: null,
    startScrollTop: 0,
  })

  const clearTimers = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (cleanupTimerRef.current != null) {
      window.clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const setDragElement = useCallback((node: T | null) => {
    elementRef.current = node
  }, [])

  const resetTracking = useCallback(() => {
    stateRef.current = {
      active: false,
      tracking: false,
      startX: 0,
      startY: 0,
      lastY: 0,
      lastTime: 0,
      velocityY: 0,
      translateY: 0,
      scrollElement: null,
      startScrollTop: 0,
    }
  }, [])

  const springBack = useCallback(() => {
    const element = elementRef.current
    if (!element) return
    clearTimers()
    const duration = prefersReducedMotion() ? 1 : 320
    element.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.98, 0.22, 1.08)`
    element.style.transform = "translate3d(0, 0, 0)"
    cleanupTimerRef.current = window.setTimeout(() => {
      clearDragStyles(element)
      cleanupTimerRef.current = null
    }, duration + 40)
  }, [clearTimers])

  const finishDrag = useCallback(() => {
    const element = elementRef.current
    if (!element) {
      resetTracking()
      return
    }

    const state = stateRef.current
    const shouldDismiss = (
      state.translateY >= getDismissDistance(element)
      || (state.velocityY > 0.72 && state.translateY > 34)
    )

    if (shouldDismiss) {
      clearTimers()
      const duration = prefersReducedMotion() ? 1 : 170
      element.style.transition = `transform ${duration}ms cubic-bezier(0.32, 0.72, 0, 1)`
      element.style.transform = "translate3d(0, calc(100% + 24px), 0)"
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        onDismiss()
      }, Math.max(1, duration - 30))
    } else {
      springBack()
    }

    resetTracking()
  }, [clearTimers, onDismiss, resetTracking, springBack])

  const cancelDrag = useCallback(() => {
    if (stateRef.current.active) {
      springBack()
    }
    resetTracking()
  }, [resetTracking, springBack])

  const startDrag = useCallback((event: ReactTouchEvent<T>) => {
    if (!enabled || event.touches.length !== 1 || isIgnoredDragTarget(event.target)) {
      resetTracking()
      return
    }

    const element = elementRef.current ?? event.currentTarget
    const touch = event.touches[0]
    const scrollElement = findScrollableAncestor(event.target, element)
    stateRef.current = {
      active: false,
      tracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastY: touch.clientY,
      lastTime: performance.now(),
      velocityY: 0,
      translateY: 0,
      scrollElement,
      startScrollTop: scrollElement?.scrollTop ?? 0,
    }
  }, [enabled, resetTracking])

  const moveDrag = useCallback((event: ReactTouchEvent<T>) => {
    const state = stateRef.current
    if (!enabled || !state.tracking || event.touches.length !== 1) return

    const touch = event.touches[0]
    const deltaY = touch.clientY - state.startY
    const deltaX = touch.clientX - state.startX

    if (!state.active) {
      if (Math.abs(deltaY) < 7) return
      if (
        deltaY <= 0
        || Math.abs(deltaX) > Math.abs(deltaY) * 1.15
        || state.startScrollTop > 1
        || (state.scrollElement?.scrollTop ?? 0) > 1
      ) {
        resetTracking()
        return
      }

      const element = elementRef.current
      if (element) {
        element.style.transition = "none"
        element.style.willChange = "transform"
        element.setAttribute("data-sheet-dragging", "true")
      }
      state.active = true
    }

    if (!state.active) return

    event.preventDefault()
    const now = performance.now()
    const frameDelta = touch.clientY - state.lastY
    const elapsed = Math.max(1, now - state.lastTime)
    state.velocityY = state.velocityY * 0.62 + (frameDelta / elapsed) * 0.38
    state.lastY = touch.clientY
    state.lastTime = now
    state.translateY = Math.max(0, dampDragDistance(deltaY))

    const element = elementRef.current
    if (element) {
      element.style.transform = `translate3d(0, ${state.translateY}px, 0)`
    }
  }, [enabled, resetTracking])

  const endDrag = useCallback(() => {
    if (!enabled || !stateRef.current.tracking) return
    if (stateRef.current.active) {
      finishDrag()
      return
    }
    resetTracking()
  }, [enabled, finishDrag, resetTracking])

  return {
    setDragElement,
    onTouchStart: startDrag,
    onTouchMove: moveDrag,
    onTouchEnd: endDrag,
    onTouchCancel: cancelDrag,
  }
}
