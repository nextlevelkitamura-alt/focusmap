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

/**
 * Detects 2-finger horizontal trackpad swipes for date navigation.
 * - Horizontal swipe (deltaX dominant): triggers date navigation
 * - One continuous horizontal wheel gesture triggers at most once
 * - Vertical scroll (deltaY dominant): ignored (allows timeline scrolling)
 * - Ctrl+scroll (pinch zoom): ignored
 */
export function useTrackpadNavigation({
    containerRef,
    onNavigateLeft,
    onNavigateRight,
    threshold = 80,
    debounceMs = 160,
    gestureIdleMs = 160,
    enabled = true,
}: UseTrackpadNavigationOptions) {
    const accumulatedDeltaX = useRef(0)
    const lastTriggerTime = useRef(Number.NEGATIVE_INFINITY)
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

            // Skip tiny movements
            if (absX < 3) return

            // Reset only after horizontal momentum has fully stopped. While a
            // gesture is active, never allow a second date navigation.
            if (resetTimer.current) clearTimeout(resetTimer.current)
            resetTimer.current = setTimeout(() => {
                accumulatedDeltaX.current = 0
                hasTriggeredInGesture.current = false
            }, gestureIdleMs)

            if (hasTriggeredInGesture.current) return

            // Check debounce
            const now = Date.now()
            if (now - lastTriggerTime.current < debounceMs) return

            // Accumulate horizontal delta
            accumulatedDeltaX.current += e.deltaX

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

        container.addEventListener('wheel', handleWheel, { passive: true })

        return () => {
            container.removeEventListener('wheel', handleWheel)
            if (resetTimer.current) clearTimeout(resetTimer.current)
        }
    }, [containerRef, onNavigateLeft, onNavigateRight, threshold, debounceMs, gestureIdleMs, enabled])
}
