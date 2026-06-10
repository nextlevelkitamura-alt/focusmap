import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { TodayTimelineCalendar } from './today-timeline-calendar'
import { MINDMAP_NODE_DRAG_EVENT, type MindMapNodeCalendarDragPayload } from '@/lib/calendar-constants'
import type { Task } from '@/types/database'
import type { TimeBlock } from '@/lib/time-block'

vi.mock('@/contexts/TimerContext', () => ({
  useTimer: () => ({
    runningTaskId: null,
    runningTask: null,
    currentElapsedSeconds: 0,
    startTimer: vi.fn(),
    pauseTimer: vi.fn(),
    completeTimer: vi.fn(),
    interruptTimer: vi.fn(),
    isLoading: false,
  }),
  formatTime: (seconds: number) => `${seconds}s`,
}))

const selectedDate = new Date('2026-06-10T00:00:00+09:00')

function installPointerCaptureMocks() {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => true),
  })
}

function setupScrollMetrics(element: HTMLElement, scrollTop = 240) {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1344 })
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 320 })
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 320,
    bottom: 400,
    width: 320,
    height: 400,
    toJSON: () => ({}),
  })
  element.scrollTop = scrollTop
}

function renderCalendar(props: Partial<ComponentProps<typeof TodayTimelineCalendar>> = {}) {
  const result = render(
    <TodayTimelineCalendar
      timelineItems={[]}
      allDayEvents={[]}
      eventsLoading={false}
      currentTime={new Date('2026-06-10T12:00:00+09:00')}
      onToggleTask={vi.fn()}
      onQuickCreateTask={vi.fn(async () => undefined)}
      onQuickCreateRangeSelect={vi.fn()}
      selectedDate={selectedDate}
      {...props}
    />,
  )
  const scroll = screen.getByTestId('today-timeline-scroll')
  setupScrollMetrics(scroll)
  const grid = result.container.querySelector('[data-focusmap-mindmap-node-calendar-target="true"]')
  if (!(grid instanceof HTMLElement)) throw new Error('calendar grid not found')
  return { ...result, scroll, grid }
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function taskBlock(): TimeBlock {
  const task = {
    id: 'task-1',
    title: '長い予定',
    status: 'todo',
    scheduled_at: '2026-06-10T10:00:00+09:00',
    estimated_time: 60,
    calendar_id: null,
    google_event_id: null,
    is_timer_running: false,
    total_elapsed_seconds: 0,
  } as Task

  return {
    id: task.id,
    source: 'task',
    title: task.title,
    startTime: new Date('2026-06-10T10:00:00+09:00'),
    endTime: new Date('2026-06-10T11:00:00+09:00'),
    color: '#F97316',
    isCompleted: false,
    isTimerRunning: false,
    originalTask: task,
  }
}

describe('TodayTimelineCalendar drag scroll control', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installPointerCaptureMocks()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      clearTimeout(id)
    })
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
    document.body.style.overscrollBehavior = ''
    document.documentElement.style.overscrollBehavior = ''
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('空き時間ドラッグ中は中央でスクロールせず、端だけゆっくり自動スクロールする', () => {
    const { scroll, grid } = renderCalendar()
    scroll.scrollTop = 200

    fireEvent.pointerDown(grid, { pointerId: 1, pointerType: 'touch', clientY: 200, button: 0 })
    advance(270)

    expect(document.body.style.overflow).toBe('hidden')
    expect(scroll.style.touchAction).toBe('none')

    fireEvent.pointerMove(grid, { pointerId: 1, pointerType: 'touch', clientY: 200 })
    advance(80)
    expect(scroll.scrollTop).toBe(200)

    fireEvent.pointerMove(grid, { pointerId: 1, pointerType: 'touch', clientY: 398 })
    advance(80)
    const afterBottomAutoScroll = scroll.scrollTop
    expect(afterBottomAutoScroll).toBeGreaterThan(200)
    expect(afterBottomAutoScroll).toBeLessThanOrEqual(944)

    fireEvent.pointerMove(grid, { pointerId: 1, pointerType: 'touch', clientY: 2 })
    advance(80)
    expect(scroll.scrollTop).toBeLessThan(afterBottomAutoScroll)

    fireEvent.pointerUp(grid, { pointerId: 1, pointerType: 'touch', clientY: 2 })

    expect(document.body.style.overflow).toBe('')
    expect(scroll.style.touchAction).toBe('')
  })

  test('マップノードD&D中もタイムライン端だけ自動スクロールし、drop後に解除する', () => {
    const onMindMapNodeDrop = vi.fn()
    const { scroll } = renderCalendar({ onMindMapNodeDrop })
    scroll.scrollTop = 300
    const payload: MindMapNodeCalendarDragPayload = {
      taskId: 'task-1',
      title: 'マップノード',
      durationMinutes: 90,
      calendarId: null,
    }

    act(() => {
      window.dispatchEvent(new CustomEvent(MINDMAP_NODE_DRAG_EVENT, {
        detail: { phase: 'move', clientX: 120, clientY: 398, payload },
      }))
    })

    expect(document.body.style.overflow).toBe('hidden')
    advance(80)
    expect(scroll.scrollTop).toBeGreaterThan(300)
    expect(scroll.scrollTop).toBeLessThanOrEqual(944)

    act(() => {
      window.dispatchEvent(new CustomEvent(MINDMAP_NODE_DRAG_EVENT, {
        detail: { phase: 'end', clientX: 120, clientY: 398, payload },
      }))
    })

    expect(onMindMapNodeDrop).toHaveBeenCalledWith(payload, expect.any(Date))
    expect(document.body.style.overflow).toBe('')
    expect(scroll.style.touchAction).toBe('')
  })

  test('既存予定/タスクのタッチD&Dは端で低速スクロールし、解除時にロックを戻す', () => {
    const onDragDrop = vi.fn()
    const { container, scroll } = renderCalendar({
      timelineItems: [taskBlock()],
      onDragDrop,
    })
    scroll.scrollTop = 300
    const item = container.querySelector('[data-time-item="true"]')
    if (!(item instanceof HTMLElement)) throw new Error('time item not found')

    fireEvent.touchStart(item, { touches: [{ clientY: 220 }] })
    advance(360)

    expect(document.body.style.overflow).toBe('hidden')
    expect(scroll.style.touchAction).toBe('none')

    fireEvent.touchMove(item, { touches: [{ clientY: 398 }] })
    advance(80)

    expect(scroll.scrollTop).toBeGreaterThan(300)
    expect(scroll.scrollTop).toBeLessThanOrEqual(944)

    fireEvent.touchEnd(item)

    expect(document.body.style.overflow).toBe('')
    expect(scroll.style.touchAction).toBe('')
  })
})
