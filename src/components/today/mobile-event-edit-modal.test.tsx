import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MobileEventEditModal } from './mobile-event-edit-modal'
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

afterEach(() => {
  vi.restoreAllMocks()
})

function calendarEventBlock(): TimeBlock {
  return {
    id: 'event-cache-1',
    source: 'google_event',
    title: '浅野',
    startTime: new Date('2026-06-10T15:00:00+09:00'),
    endTime: new Date('2026-06-10T16:00:00+09:00'),
    color: '#039BE5',
    isCompleted: false,
    isTimerRunning: false,
    googleEventId: 'google-event-1',
    calendarId: 'calendar-1',
    originalEvent: {
      id: 'event-cache-1',
      user_id: 'user-1',
      google_event_id: 'google-event-1',
      calendar_id: 'calendar-1',
      title: '浅野',
      description: '',
      start_time: '2026-06-10T15:00:00+09:00',
      end_time: '2026-06-10T16:00:00+09:00',
      is_all_day: false,
      timezone: 'Asia/Tokyo',
      synced_at: '2026-06-10T00:00:00.000Z',
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    },
  }
}

describe('MobileEventEditModal', () => {
  test('削除ボタンは確認ダイアログなしで削除し、削除APIの完了を待たず編集画面を閉じる', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onClose = vi.fn()
    let resolveDelete: (() => void) | undefined
    const deletePromise = new Promise<void>(resolve => {
      resolveDelete = resolve
    })
    const onDeleteEvent = vi.fn(() => deletePromise)

    render(
      <MobileEventEditModal
        target={calendarEventBlock()}
        isOpen
        onClose={onClose}
        onSaveTask={vi.fn()}
        onSaveEvent={vi.fn()}
        onDeleteEvent={onDeleteEvent}
        availableCalendars={[{ id: 'calendar-1', name: 'Main' }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onDeleteEvent).toHaveBeenCalledWith('event-cache-1', 'google-event-1', 'calendar-1')
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDelete?.()
      await deletePromise
    })
  })
})
