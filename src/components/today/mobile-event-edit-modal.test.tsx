import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MobileEventEditModal } from './mobile-event-edit-modal'
import type { TimeBlock } from '@/lib/time-block'
import type { Task } from '@/types/database'

afterEach(() => {
  vi.useRealTimers()
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

function taskBlock(): TimeBlock {
  const task: Task = {
    id: 'task-1',
    user_id: 'user-1',
    project_id: 'project-1',
    parent_task_id: null,
    is_group: false,
    title: '資料を確認する',
    status: 'todo',
    stage: 'scheduled',
    priority: null,
    order_index: 0,
    scheduled_at: '2026-06-10T15:00:00+09:00',
    estimated_time: 30,
    actual_time_minutes: 12,
    google_event_id: null,
    calendar_event_id: null,
    calendar_id: 'calendar-1',
    total_elapsed_seconds: 720,
    last_started_at: null,
    is_timer_running: false,
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    source: 'manual',
    deleted_at: null,
    google_event_fingerprint: null,
    is_habit: false,
    habit_frequency: null,
    habit_icon: null,
    habit_start_date: null,
    habit_end_date: null,
    memo: '確認メモ',
    memo_images: null,
    node_width: null,
    mindmap_collapsed: false,
  }

  return {
    id: 'task-1',
    source: 'task',
    title: task.title,
    startTime: new Date('2026-06-10T15:00:00+09:00'),
    endTime: new Date('2026-06-10T15:30:00+09:00'),
    color: '#3B82F6',
    isCompleted: false,
    isTimerRunning: false,
    taskId: task.id,
    calendarId: 'calendar-1',
    projectId: 'project-1',
    estimatedTime: 30,
    totalElapsedSeconds: 720,
    originalTask: task,
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

    const deleteButton = screen.getByRole('button', { name: '予定を削除' })
    expect(deleteButton).toBeInTheDocument()
    expect(deleteButton).toHaveTextContent('削除')
    expect(screen.queryByText('タイトル')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完了' }))

    expect(onSaveEvent).toHaveBeenCalledWith('event-cache-1', expect.objectContaining({
      reminders: [15],
    }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  test('Google予定の保存に失敗したら閉じずにエラーを表示する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onClose = vi.fn()
    const onSaveEvent = vi.fn(() => Promise.reject(new Error('このカレンダーは閲覧専用のため編集できません')))

    render(
      <MobileEventEditModal
        target={calendarEventBlock()}
        isOpen
        onClose={onClose}
        onSaveTask={vi.fn()}
        onSaveEvent={onSaveEvent}
        onDeleteEvent={vi.fn()}
        availableCalendars={[
          { id: 'calendar-1', name: 'Main' },
          { id: 'calendar-2', name: 'Work' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '完了' }))

    expect(onSaveEvent).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('このカレンダーは閲覧専用のため編集できません')
    expect(onClose).not.toHaveBeenCalled()
  })

  test('削除ボタンは下部固定バーに表示し、確認後に予定削除を呼ぶ', () => {
    const onClose = vi.fn()
    const onDeleteEvent = vi.fn(() => Promise.resolve())

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

    const deleteButton = screen.getByRole('button', { name: '予定を削除' })
    expect(deleteButton.closest('[data-testid="mobile-event-delete-bar"]')).toBeInTheDocument()
    expect(deleteButton).toHaveClass('h-11')
    expect(deleteButton).toHaveTextContent('削除')

    fireEvent.click(deleteButton)
    expect(onDeleteEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    expect(onDeleteEvent).toHaveBeenCalledWith('event-cache-1', 'google-event-1', 'calendar-1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('タスク編集でも記録時間とタイマー操作を表示しない', () => {
    render(
      <MobileEventEditModal
        target={taskBlock()}
        isOpen
        onClose={vi.fn()}
        onSaveTask={vi.fn()}
        onSaveEvent={vi.fn()}
        onDeleteTask={vi.fn()}
        availableCalendars={[{ id: 'calendar-1', name: 'Main' }]}
      />,
    )

    const deleteButton = screen.getByRole('button', { name: 'タスクを削除' })

    expect(screen.queryByText('記録時間')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /開始|再生|一時停止/ })).not.toBeInTheDocument()
    expect(deleteButton).toHaveTextContent('削除')
  })

  test('本文エリアの中央から下へ引くと編集シートを閉じる', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    render(
      <MobileEventEditModal
        target={calendarEventBlock()}
        isOpen
        onClose={onClose}
        onSaveTask={vi.fn()}
        onSaveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        availableCalendars={[]}
      />,
    )

    const scroller = screen.getByTestId('mobile-event-edit-scroll')
    scroller.scrollTop = 0

    fireEvent.touchStart(scroller, {
      touches: [{ clientX: 180, clientY: 360 }],
    })
    fireEvent.touchMove(scroller, {
      touches: [{ clientX: 180, clientY: 475 }],
    })
    fireEvent.touchEnd(scroller, {
      changedTouches: [{ clientX: 180, clientY: 475 }],
    })

    vi.advanceTimersByTime(160)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('カレンダーホイールは前後の候補が見える高さで複数カレンダーを表示する', () => {
    render(
      <MobileEventEditModal
        target={calendarEventBlock()}
        isOpen
        onClose={vi.fn()}
        onSaveTask={vi.fn()}
        onSaveEvent={vi.fn()}
        onDeleteEvent={vi.fn()}
        availableCalendars={[
          { id: 'calendar-1', name: 'Main', background_color: '#039BE5' },
          { id: 'calendar-2', name: 'Work', background_color: '#33B679' },
          { id: 'calendar-3', name: 'Personal', background_color: '#D50000' },
        ]}
      />,
    )

    const listbox = screen.getByRole('listbox', { name: '追加先カレンダー' })

    expect(listbox.parentElement).toHaveStyle({ height: '154px' })
    expect(screen.getByRole('option', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Personal' })).toBeInTheDocument()
  })
})
