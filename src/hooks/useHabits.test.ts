import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHabits } from './useHabits'
import type { Task, HabitCompletion } from '@/types/database'

// --- fetch モック ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// --- helpers ---

function createHabitTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'habit-1',
    user_id: 'user-1',
    project_id: 'proj-1',
    parent_task_id: null,
    title: 'Morning Exercise',
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
    is_habit: true,
    habit_frequency: 'mon,tue,wed,thu,fri',
    habit_icon: null,
    habit_start_date: null,
    habit_end_date: null,
    is_timer_running: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function createCompletion(
  habitId: string,
  date: string,
  overrides: Partial<HabitCompletion> = {}
): HabitCompletion {
  return {
    id: `comp-${date}`,
    habit_id: habitId,
    user_id: 'user-1',
    completed_date: date,
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
    ...overrides,
  }
}

type HabitApiResponse = {
  habit: Task
  completions?: HabitCompletion[]
  child_tasks?: Task[]
}

function mockHabitsSuccess(habits: HabitApiResponse[] = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        habits: habits.map(h => ({
          ...h.habit,
          completions: h.completions ?? [],
          child_tasks: h.child_tasks ?? [],
        })),
      }),
  })
}

function mockHabitsError(message = 'Fetch failed') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: false, error: { message } }),
  })
}

function mockApiSuccess() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  // Date のみフェイクにして setTimeout/Promise は実タイマーのまま
  // 固定日付: 2026-02-19 (木曜日 = 'thu')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-19T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// fetchHabits
// ============================================================
describe('useHabits - fetchHabits', () => {
  test('マウント時に習慣一覧を取得する', async () => {
    const habit = createHabitTask()
    mockHabitsSuccess([{ habit }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toMatch(/^\/api\/habits\?from=.*&to=.*/)
    expect(result.current.habits).toHaveLength(1)
    expect(result.current.habits[0].habit.title).toBe('Morning Exercise')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  test('APIエラー時は error ステートをセットする', async () => {
    mockHabitsError('Failed to fetch habits')

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.error).toBe('Failed to fetch habits')
    expect(result.current.habits).toHaveLength(0)
    expect(result.current.isLoading).toBe(false)
  })

  test('fetch 例外時は error ステートをセットする', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'))

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.error).toBe('Failed to fetch habits')
    expect(result.current.isLoading).toBe(false)
  })

  test('completions から isCompletedToday を正しく算出する', async () => {
    const habit = createHabitTask()
    // 今日（2026-02-19）の completion を持つ
    const completions = [createCompletion('habit-1', '2026-02-19')]
    mockHabitsSuccess([{ habit, completions }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].isCompletedToday).toBe(true)
  })

  test('今日の completion がない場合 isCompletedToday は false', async () => {
    const habit = createHabitTask()
    const completions = [createCompletion('habit-1', '2026-02-18')] // 昨日のみ
    mockHabitsSuccess([{ habit, completions }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].isCompletedToday).toBe(false)
  })
})

// ============================================================
// calculateStreak（fetchHabits 経由で間接テスト）
// ============================================================
describe('useHabits - streak calculation', () => {
  test('連続 3 日の completion でストリーク 3 を返す', async () => {
    const habit = createHabitTask({ habit_frequency: null }) // 毎日
    const completions = [
      createCompletion('habit-1', '2026-02-19'), // 今日
      createCompletion('habit-1', '2026-02-18'), // 昨日
      createCompletion('habit-1', '2026-02-17'), // 一昨日
    ]
    mockHabitsSuccess([{ habit, completions }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].streak).toBe(3)
  })

  test('途中で途切れた場合はストリークが 1 になる', async () => {
    const habit = createHabitTask({ habit_frequency: null }) // 毎日
    const completions = [
      createCompletion('habit-1', '2026-02-19'), // 今日
      // 2026-02-18 は欠席
      createCompletion('habit-1', '2026-02-17'),
    ]
    mockHabitsSuccess([{ habit, completions }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // 今日は継続中なのでカウント、昨日が抜けているのでそこで停止 → 1
    expect(result.current.habits[0].streak).toBe(1)
  })

  test('completions が空の場合はストリーク 0', async () => {
    const habit = createHabitTask({ habit_frequency: null })
    mockHabitsSuccess([{ habit, completions: [] }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].streak).toBe(0)
  })
})

// ============================================================
// todayHabits / otherHabits（isTodayHabit フィルター）
// ============================================================
describe('useHabits - todayHabits / otherHabits', () => {
  test('今日の曜日（thu）に一致する習慣は todayHabits に含まれる', async () => {
    // habit_frequency に 'thu' を含む → 今日 (木曜) の習慣
    const todayHabit = createHabitTask({
      id: 'habit-today',
      title: 'Thu Habit',
      habit_frequency: 'thu',
    })
    // habit_frequency に 'mon' のみ → 今日は対象外
    const otherHabit = createHabitTask({
      id: 'habit-other',
      title: 'Mon Habit',
      habit_frequency: 'mon',
    })
    mockHabitsSuccess([{ habit: todayHabit }, { habit: otherHabit }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.todayHabits).toHaveLength(1)
    expect(result.current.todayHabits[0].habit.title).toBe('Thu Habit')
    expect(result.current.otherHabits).toHaveLength(1)
    expect(result.current.otherHabits[0].habit.title).toBe('Mon Habit')
  })

  test('habit_frequency が null（毎日）の場合は常に todayHabits に含まれる', async () => {
    const habit = createHabitTask({ habit_frequency: null })
    mockHabitsSuccess([{ habit }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.todayHabits).toHaveLength(1)
    expect(result.current.otherHabits).toHaveLength(0)
  })
})

// ============================================================
// toggleCompletion
// ============================================================
describe('useHabits - toggleCompletion', () => {
  test('未完了 → POST で完了に切り替える', async () => {
    const habit = createHabitTask({ id: 'habit-1' })
    mockHabitsSuccess([{ habit, completions: [] }])
    mockApiSuccess()

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].isCompletedToday).toBe(false)

    await act(async () => {
      await result.current.toggleCompletion('habit-1')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/habits/completions',
      expect.objectContaining({ method: 'POST' })
    )
    // 楽観的更新で isCompletedToday が true に
    expect(result.current.habits[0].isCompletedToday).toBe(true)
  })

  test('完了済み → DELETE で未完了に切り替える', async () => {
    const habit = createHabitTask({ id: 'habit-1' })
    const completions = [createCompletion('habit-1', '2026-02-19')]
    mockHabitsSuccess([{ habit, completions }])
    mockApiSuccess()

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits[0].isCompletedToday).toBe(true)

    await act(async () => {
      await result.current.toggleCompletion('habit-1')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/habits/completions',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(result.current.habits[0].isCompletedToday).toBe(false)
  })

  test('存在しない habitId は何もしない', async () => {
    const habit = createHabitTask()
    mockHabitsSuccess([{ habit }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    const callCountBefore = mockFetch.mock.calls.length

    await act(async () => {
      await result.current.toggleCompletion('non-existent-id')
    })

    // 追加の fetch が発生しないこと
    expect(mockFetch.mock.calls.length).toBe(callCountBefore)
  })
})

// ============================================================
// removeHabit
// ============================================================
describe('useHabits - removeHabit', () => {
  test('習慣を削除すると状態から消える', async () => {
    const habit1 = createHabitTask({ id: 'habit-1', title: 'Habit A' })
    const habit2 = createHabitTask({ id: 'habit-2', title: 'Habit B' })
    mockHabitsSuccess([{ habit: habit1 }, { habit: habit2 }])
    mockApiSuccess()

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.habits).toHaveLength(2)

    await act(async () => {
      await result.current.removeHabit('habit-1')
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/habit-1',
      expect.objectContaining({ method: 'DELETE' })
    )
    // 楽観的更新で即座に消える
    expect(result.current.habits).toHaveLength(1)
    expect(result.current.habits[0].habit.title).toBe('Habit B')
  })
})

// ============================================================
// updateChildTaskStatus
// ============================================================
describe('useHabits - updateChildTaskStatus', () => {
  test('子タスクのステータスを更新する（APIなし）', async () => {
    const parentHabit = createHabitTask({ id: 'habit-1' })
    const childTask = createHabitTask({ id: 'child-1', parent_task_id: 'habit-1', status: 'pending' })
    mockHabitsSuccess([{ habit: parentHabit, child_tasks: [childTask] }])

    const { result } = renderHook(() => useHabits())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    const callCountBefore = mockFetch.mock.calls.length

    act(() => {
      result.current.updateChildTaskStatus('habit-1', 'child-1', 'done')
    })

    // API を呼ばず、状態のみ更新
    expect(mockFetch.mock.calls.length).toBe(callCountBefore)
    const childInState = result.current.habits[0].childTasks.find(c => c.id === 'child-1')
    expect(childInState?.status).toBe('done')
  })
})
