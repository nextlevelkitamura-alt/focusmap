import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RefObject } from 'react'
import { useTrackpadNavigation } from './useTrackpadNavigation'

function wheel(target: HTMLElement, deltaX: number, deltaY = 0) {
  target.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, bubbles: true }))
}

describe('useTrackpadNavigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('fires at most once during one continuous horizontal gesture', () => {
    const element = document.createElement('div')
    const containerRef = { current: element } as RefObject<HTMLDivElement | null>
    const onNavigateLeft = vi.fn()
    const onNavigateRight = vi.fn()

    renderHook(() =>
      useTrackpadNavigation({
        containerRef,
        onNavigateLeft,
        onNavigateRight,
        threshold: 50,
        debounceMs: 0,
        gestureIdleMs: 240,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      wheel(element, 90, 3)
      vi.advanceTimersByTime(120)
      wheel(element, 90, 3)
      vi.advanceTimersByTime(239)
      wheel(element, 90, 3)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(240)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
  })

  test('allows the next horizontal gesture shortly after the previous one ends', () => {
    const element = document.createElement('div')
    const containerRef = { current: element } as RefObject<HTMLDivElement | null>
    const onNavigateLeft = vi.fn()
    const onNavigateRight = vi.fn()

    renderHook(() =>
      useTrackpadNavigation({
        containerRef,
        onNavigateLeft,
        onNavigateRight,
        threshold: 50,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(159)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(160)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('does not treat vertical scrolling as date navigation', () => {
    const element = document.createElement('div')
    const containerRef = { current: element } as RefObject<HTMLDivElement | null>
    const onNavigateLeft = vi.fn()
    const onNavigateRight = vi.fn()

    renderHook(() =>
      useTrackpadNavigation({
        containerRef,
        onNavigateLeft,
        onNavigateRight,
        threshold: 50,
        debounceMs: 0,
      })
    )

    act(() => {
      wheel(element, 80, 120)
      wheel(element, -90, 140)
    })

    expect(onNavigateLeft).not.toHaveBeenCalled()
    expect(onNavigateRight).not.toHaveBeenCalled()
  })
})
