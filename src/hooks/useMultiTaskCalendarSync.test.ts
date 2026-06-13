import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMultiTaskCalendarSync } from './useMultiTaskCalendarSync'
import type { Task } from '@/types/database'

// --- fetch モック ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// --- helpers ---

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    user_id: 'user-1',
    project_id: 'proj-1',
    parent_task_id: null,
    title: 'Test Task',
    description: null,
    status: 'active',
    priority: null,
    estimated_time: null,
    actual_time: null,
    scheduled_at: null,
    due_date: null,
    calendar_id: null,
    google_event_id: null,
    sort_order: 0,
    is_group: false,
    is_habit: false,
    habit_frequency: null,
    habit_icon: null,
    habit_start_date: null,
    habit_end_date: null,
    is_timer_running: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** 3フィールドが揃った完全なタスク */
function createCompleteTask(overrides: Partial<Task> = {}): Task {
  return createTask({
    scheduled_at: '2026-02-19T14:00:00Z',
    estimated_time: 60,
    calendar_id: 'cal@gmail.com',
    ...overrides,
  })
}

function mockSyncSuccess(googleEventId = 'gevt-123', calendarId?: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true, googleEventId, ...(calendarId ? { calendarId } : {}) }),
  })
}

function mockSyncError(message = 'Sync failed') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: () => Promise.resolve({ error: message }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

// ============================================================
// 初回レンダリング: API を呼ばない
// ============================================================
describe('useMultiTaskCalendarSync - 初回レンダリング', () => {
  test('初回レンダリングでは API を呼ばない（記録のみ）', async () => {
    const tasks = [createCompleteTask()]

    renderHook(() =>
      useMultiTaskCalendarSync({ tasks, onRefreshCalendar: vi.fn() })
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('is_group タスクは常にスキップ', async () => {
    // 初回レンダリング
    const tasks = [createCompleteTask({ id: 'group-1', is_group: true })]
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar: vi.fn() }),
      { initialProps: { t: tasks } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    // 2回目: フィールド変更（is_group なのでスキップされる）
    const updatedTasks = [
      createCompleteTask({
        id: 'group-1',
        is_group: true,
        title: 'Changed Title',
      }),
    ]

    await act(async () => {
      rerender({ t: updatedTasks })
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('フックは null を返す', () => {
    const { result } = renderHook(() =>
      useMultiTaskCalendarSync({ tasks: [], onRefreshCalendar: vi.fn() })
    )
    expect(result.current).toBeNull()
  })
})

// ============================================================
// 新規同期: POST
// ============================================================
describe('useMultiTaskCalendarSync - 新規同期 (POST)', () => {
  test('3フィールドが揃ったとき POST を呼ぶ', async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    // 初回: フィールドなし
    const initialTask = createTask({ id: 'task-1' })
    const { rerender } = renderHook(
      ({ t }) =>
        useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar, onUpdateTask }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(mockFetch).not.toHaveBeenCalled()

    // 2回目: 3フィールドが揃う → POST
    mockSyncSuccess('gevt-new')
    const completeTask = createCompleteTask({ id: 'task-1' })

    await act(async () => {
      rerender({ t: [completeTask] })
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/calendar/sync-task',
      expect.objectContaining({ method: 'POST' })
    )

    // google_event_id が保存される
    expect(onUpdateTask).toHaveBeenCalledWith('task-1', {
      google_event_id: 'gevt-new',
      calendar_id: 'cal@gmail.com',
    })

    // カレンダー更新
    expect(onRefreshCalendar).toHaveBeenCalled()
  })

  test('google_event_id が既にある場合は POST しない（PATCHルートへ）', async () => {
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    // 初回: 3フィールド揃い + google_event_id あり
    const initialTask = createCompleteTask({
      id: 'task-1',
      google_event_id: 'gevt-existing',
    })
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(mockFetch).not.toHaveBeenCalled()

    // 2回目: タイトル変更（フィールドは変わらない → PATCH の条件に該当しない）
    const sameTask = createCompleteTask({
      id: 'task-1',
      google_event_id: 'gevt-existing',
      title: 'New Title',
    })

    await act(async () => {
      rerender({ t: [sameTask] })
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // scheduled_at / estimated_time / calendar_id が同一 → API 呼ばれない
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('外部同期済みの予定情報が一括反映された場合はPOST/PATCHしない', async () => {
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)

    const initialTask = createTask({ id: 'task-direct-sync' })
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar, onUpdateTask }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const syncedTask = createCompleteTask({
      id: 'task-direct-sync',
      google_event_id: 'gevt-created-by-panel',
    })

    await act(async () => {
      rerender({ t: [syncedTask] })
      await new Promise(resolve => setTimeout(resolve, 80))
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(onUpdateTask).not.toHaveBeenCalled()
    expect(onRefreshCalendar).not.toHaveBeenCalled()
  })
})

// ============================================================
// 更新: PATCH
// ============================================================
describe('useMultiTaskCalendarSync - 更新 (PATCH)', () => {
  test('scheduled_at が変更されると PATCH を呼ぶ', async () => {
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    // 初回: google_event_id あり
    const initialTask = createCompleteTask({
      id: 'task-scheduled',
      google_event_id: 'gevt-1',
    })
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    // 2回目: scheduled_at 変更
    mockSyncSuccess('gevt-1')
    const updatedTask = createCompleteTask({
      id: 'task-scheduled',
      google_event_id: 'gevt-1',
      scheduled_at: '2026-02-20T10:00:00Z', // 変更
    })

    await act(async () => {
      rerender({ t: [updatedTask] })
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/calendar/sync-task',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  test('estimated_time が変更されると PATCH を呼ぶ', async () => {
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    const initialTask = createCompleteTask({
      id: 'task-estimated',
      google_event_id: 'gevt-1',
    })
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    mockSyncSuccess('gevt-1')
    const updatedTask = createCompleteTask({
      id: 'task-estimated',
      google_event_id: 'gevt-1',
      estimated_time: 90, // 変更
    })

    await act(async () => {
      rerender({ t: [updatedTask] })
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/calendar/sync-task',
      expect.objectContaining({ method: 'PATCH' })
    )
  })
})

// ============================================================
// カレンダー変更: PATCH
// ============================================================
describe('useMultiTaskCalendarSync - カレンダー変更 (PATCH)', () => {
  test('calendar_id が変更されると旧カレンダーID付きで PATCH を呼ぶ', async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    const initialTask = createCompleteTask({
      id: 'task-calendar',
      google_event_id: 'gevt-old',
      calendar_id: 'old@gmail.com',
    })
    const { rerender } = renderHook(
      ({ t }) =>
        useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar, onUpdateTask }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    mockSyncSuccess('gevt-new')

    // calendar_id を変更
    const updatedTask = createCompleteTask({
      id: 'task-calendar',
      google_event_id: 'gevt-old',
      calendar_id: 'new@gmail.com', // 変更
    })

    await act(async () => {
      rerender({ t: [updatedTask] })
      await new Promise(resolve => setTimeout(resolve, 150))
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      taskId: 'task-calendar',
      calendar_id: 'new@gmail.com',
      source_calendar_id: 'old@gmail.com',
      google_event_id: 'gevt-old',
    })

    // 新しい google_event_id が保存される
    expect(onUpdateTask).toHaveBeenCalledWith('task-calendar', {
      google_event_id: 'gevt-new',
      calendar_id: 'new@gmail.com',
    })
  })

  test('API が返した実カレンダーIDを保存する', async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    const initialTask = createCompleteTask({
      id: 'task-resolved',
      google_event_id: 'gevt-old',
      calendar_id: 'old@gmail.com',
    })
    const { rerender } = renderHook(
      ({ t }) =>
        useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar, onUpdateTask }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    mockSyncSuccess('gevt-new', 'resolved@gmail.com')

    const updatedTask = createCompleteTask({
      id: 'task-resolved',
      google_event_id: 'gevt-old',
      calendar_id: 'new@gmail.com',
    })

    await act(async () => {
      rerender({ t: [updatedTask] })
      await new Promise(resolve => setTimeout(resolve, 150))
    })

    expect(onUpdateTask).toHaveBeenCalledWith('task-resolved', {
      google_event_id: 'gevt-new',
      calendar_id: 'resolved@gmail.com',
    })
  })
})

// ============================================================
// 削除: DELETE
// ============================================================
describe('useMultiTaskCalendarSync - 削除 (DELETE)', () => {
  test('calendar_id が解除されると DELETE を呼ぶ', async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    const initialTask = createCompleteTask({
      id: 'task-1',
      google_event_id: 'gevt-1',
    })
    const { rerender } = renderHook(
      ({ t }) =>
        useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar, onUpdateTask }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })

    // calendar_id を解除（null）
    const taskWithoutCalendar = createCompleteTask({
      id: 'task-1',
      google_event_id: 'gevt-1',
      calendar_id: null, // 解除
    })

    await act(async () => {
      rerender({ t: [taskWithoutCalendar] })
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/calendar/sync-task',
      expect.objectContaining({ method: 'DELETE' })
    )

    // google_event_id がクリアされる
    expect(onUpdateTask).toHaveBeenCalledWith('task-1', { google_event_id: null })
  })
})

// ============================================================
// エラーハンドリング
// ============================================================
describe('useMultiTaskCalendarSync - エラーハンドリング', () => {
  test('API エラーでも例外はスローしない（silent failure）', async () => {
    const onRefreshCalendar = vi.fn().mockResolvedValue(undefined)

    const initialTask = createTask({ id: 'task-error' })
    const { rerender } = renderHook(
      ({ t }) => useMultiTaskCalendarSync({ tasks: t, onRefreshCalendar }),
      { initialProps: { t: [initialTask] } }
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    mockSyncError('Internal Server Error')

    const completeTask = createCompleteTask({ id: 'task-error' })

    // act() が正常に完了すれば silent failure が確認できる
    await act(async () => {
      rerender({ t: [completeTask] })
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // fetch は呼ばれた（エラー応答だが例外はスローされていない）
    expect(mockFetch).toHaveBeenCalled()
  })
})
