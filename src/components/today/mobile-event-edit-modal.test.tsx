import { fireEvent, render, screen } from '@testing-library/react'
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
  test('右上の完了で保存し、未設定のGoogle予定通知は15分前を既定にする', async () => {
    const onClose = vi.fn()
    const onSaveEvent = vi.fn(() => Promise.resolve())

    render(
      <MobileEventEditModal
        target={calendarEventBlock()}
        isOpen
        onClose={onClose}
        onSaveTask={vi.fn()}
        onSaveEvent={onSaveEvent}
        onDeleteEvent={vi.fn()}
        availableCalendars={[{ id: 'calendar-1', name: 'Main' }]}
      />,
    )

    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完了' }))

    expect(onSaveEvent).toHaveBeenCalledWith('event-cache-1', expect.objectContaining({
      reminders: [15],
    }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
