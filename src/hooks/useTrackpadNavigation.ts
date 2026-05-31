"use client"

import { useEffect, useRef, type RefObject } from "react"

interface UseTrackpadNavigationOptions {
    containerRef: RefObject<HTMLDivElement | null>
    onNavigateLeft: () => void   // swipe left = next day/period
    onNavigateRight: () => void  // swipe right = previous day/period
    threshold?: number           // px of deltaX accumulated before triggering
    debounceMs?: number          // cooldown between triggers
    gestureIdleMs?: number       // pause length that ends one trackpad gesture
    enabled?: boolean
}

const TAIL_LOCK_DELTA_RATIO = 0.34
const TINY_TAIL_TRACK_MS = 160

/**
 * Detects 2-finger horizontal trackpad swipes for date navigation.
 * - Horizontal swipe (deltaX dominant): triggers date navigation
 * - One scroll burst advances one day/period, then accepts the next burst quickly
 * - Vertical scroll (deltaY dominant): ignored (allows timeline scrolling)
 * - Ctrl+scroll (pinch zoom): ignored
 */
export function useTrackpadNavigation({
    containerRef,
    onNavigateLeft,
    onNavigateRight,
    threshold = 48,
    debounceMs = 70,
    gestureIdleMs = 70,
    enabled = true,
}: UseTrackpadNavigationOptions) {
    const accumulatedDeltaX = useRef(0)
    const activeDirection = useRef<1 | -1 | 0>(0)
    const lastTriggerTime = useRef(Number.NEGATIVE_INFINITY)
    const lastWheelTime = useRef(Number.NEGATIVE_INFINITY)
    const hasTriggeredInGesture = useRef(false)
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!enabled) return
        const container = containerRef.current
        if (!container) return

        const handleWheel = (e: WheelEvent) => {
            // Skip ctrl+scroll (zoom gestures)
            if (e.ctrlKey || e.metaKey) return

            // Only trigger for horizontal-dominant gestures
            const absX = Math.abs(e.deltaX)
            const absY = Math.abs(e.deltaY)
            if (absX <= absY) return // vertical scroll dominant — let it scroll the timeline

            const now = Date.now()
            const direction: 1 | -1 = e.deltaX > 0 ? 1 : -1
            const gapSinceWheel = now - lastWheelTime.current
            const isDirectionChange = activeDirection.current !== 0 && activeDirection.current !== direction
            const isNewGestureAfterIdle = gapSinceWheel >= gestureIdleMs || isDirectionChange
            const cooldownElapsed = now - lastTriggerTime.current >= debounceMs
            const tailLockDelta = Math.max(16, threshold * TAIL_LOCK_DELTA_RATIO)

            const rememberWheelActivity = () => {
                lastWheelTime.current = now
                if (resetTimer.current) clearTimeout(resetTimer.current)
                resetTimer.current = setTimeout(() => {
                    accumulatedDeltaX.current = 0
                    hasTriggeredInGesture.current = false
                    activeDirection.current = 0
                }, gestureIdleMs)
            }

            // Tiny horizontal tail still belongs to the same physical scroll.
            // Track it while locked so one long scroll cannot split into days.
            if (absX < 5) {
                if (hasTriggeredInGesture.current) {
                    e.preventDefault()
                    if (now - lastTriggerTime.current <= TINY_TAIL_TRACK_MS) {
                        rememberWheelActivity()
                    }
                }
                return
            }

            e.preventDefault()

            if (isNewGestureAfterIdle) {
                accumulatedDeltaX.current = 0
                hasTriggeredInGesture.current = false
                activeDirection.current = direction
            }

            if (hasTriggeredInGesture.current) {
                const shouldExtendLock =
                    absX >= tailLockDelta ||
                    now - lastTriggerTime.current <= TINY_TAIL_TRACK_MS
                if (shouldExtendLock) rememberWheelActivity()
                return
            }

            rememberWheelActivity()

            if (!cooldownElapsed) return

            if (
                accumulatedDeltaX.current !== 0 &&
                Math.sign(accumulatedDeltaX.current) !== Math.sign(e.deltaX)
            ) {
                accumulatedDeltaX.current = 0
            }

            // Accumulate horizontal delta
            accumulatedDeltaX.current += e.deltaX
            activeDirection.current = direction

            // Check if accumulated delta exceeds threshold
            if (Math.abs(accumulatedDeltaX.current) >= threshold) {
                if (accumulatedDeltaX.current > 0) {
                    onNavigateLeft() // swipe left → next
                } else {
                    onNavigateRight() // swipe right → previous
                }
                accumulatedDeltaX.current = 0
                hasTriggeredInGesture.current = true
                lastTriggerTime.current = now
            }
        }

        container.addEventListener('wheel', handleWheel, { passive: false })

        return () => {
            container.removeEventListener('wheel', handleWheel)
            if (resetTimer.current) clearTimeout(resetTimer.current)
        }
    }, [containerRef, onNavigateLeft, onNavigateRight, threshold, debounceMs, gestureIdleMs, enabled])
}
