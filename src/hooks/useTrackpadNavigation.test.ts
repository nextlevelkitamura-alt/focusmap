import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RefObject } from 'react'
import { useTrackpadNavigation } from './useTrackpadNavigation'

function wheel(target: HTMLElement, deltaX: number, deltaY = 0) {
  target.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true }))
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      wheel(element, 60, 4)
      vi.advanceTimersByTime(35)
      wheel(element, 60, 4)
      vi.advanceTimersByTime(35)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(75)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(105)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
  })

  test('does not accumulate tail movement after a day navigation', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 22, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 16, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 14, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('allows another flick after the post-navigation momentum lock ends', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(25)
      wheel(element, 12, 4)
      vi.advanceTimersByTime(155)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('keeps one day during a long continuous active wheel stream', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      for (const delta of [22, 24, 26, 28, 30, 32, 34]) {
        vi.advanceTimersByTime(45)
        wheel(element, delta, 4)
      }
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('does not split one long scroll when tiny tail events appear before a strong wave', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 3, 1)
      vi.advanceTimersByTime(60)
      wheel(element, 80, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('does not treat a renewed delta inside the same wheel stream as another scroll', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 18, 4)
      vi.advanceTimersByTime(50)
      wheel(element, 80, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('does not treat a moderate momentum bump as a second scroll', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 18, 4)
      vi.advanceTimersByTime(50)
      wheel(element, 34, 4)
      vi.advanceTimersByTime(8)
      wheel(element, 34, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('does not turn sparse momentum tail bumps into several day jumps', () => {
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
        debounceMs: 60,
        gestureIdleMs: 90,
      })
    )

    act(() => {
      wheel(element, 56, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 18, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 14, 4)
      vi.advanceTimersByTime(20)
      wheel(element, 26, 4)
      vi.advanceTimersByTime(8)
      wheel(element, 26, 4)

      vi.advanceTimersByTime(20)
      wheel(element, 12, 4)
      vi.advanceTimersByTime(42)
      wheel(element, 28, 4)
      vi.advanceTimersByTime(8)
      wheel(element, 28, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('accepts the next separate scroll burst after post-navigation momentum ends', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 60, 4)
      vi.advanceTimersByTime(180)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('resets accumulated movement after the gesture goes idle', () => {
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
      wheel(element, 30, 4)
      vi.advanceTimersByTime(160)
      wheel(element, 30, 4)
    })

    expect(onNavigateLeft).not.toHaveBeenCalled()

    act(() => {
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('changes direction after a short separate gesture', () => {
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
        debounceMs: 70,
        gestureIdleMs: 75,
      })
    )

    act(() => {
      wheel(element, 70, 4)
      vi.advanceTimersByTime(80)
      wheel(element, -70, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
    expect(onNavigateRight).toHaveBeenCalledTimes(1)
  })

  test('allows the next horizontal gesture after post-navigation momentum ends', () => {
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
      vi.advanceTimersByTime(180)
      wheel(element, 60, 4)
    })

    expect(onNavigateLeft).toHaveBeenCalledTimes(2)
    expect(onNavigateRight).not.toHaveBeenCalled()
  })

  test('prevents native horizontal scroll handling when it navigates dates', () => {
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

    const event = new WheelEvent('wheel', { deltaX: 60, deltaY: 4, bubbles: true, cancelable: true })
    act(() => {
      element.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(onNavigateLeft).toHaveBeenCalledTimes(1)
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
