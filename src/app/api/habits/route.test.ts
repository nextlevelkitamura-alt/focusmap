import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  getHabitsResult,
  getChildTasksResult,
  getCompletionsResult,
  setHabitsResult,
  setChildTasksResult,
  setCompletionsResult,
} = vi.hoisted(() => {
  let _habitsResult: { data: unknown; error: unknown } = { data: [], error: null }
  let _childTasksResult: { data: unknown; error: unknown } = { data: [], error: null }
  let _completionsResult: { data: unknown; error: unknown } = { data: [], error: null }

  return {
    mockGetUser: vi.fn(),
    getHabitsResult: () => _habitsResult,
    getChildTasksResult: () => _childTasksResult,
    getCompletionsResult: () => _completionsResult,
    setHabitsResult: (v: typeof _habitsResult) => { _habitsResult = v },
    setChildTasksResult: (v: typeof _childTasksResult) => { _childTasksResult = v },
    setCompletionsResult: (v: typeof _completionsResult) => { _completionsResult = v },
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (table: string) => {
        if (table === 'tasks') {
          return {
            select: () => ({
              // habits クエリ: .eq(user_id).eq(is_habit).order()
              eq: () => ({
                eq: () => ({
                  order: () => Promise.resolve(getHabitsResult()),
                }),
              }),
              // child tasks クエリ: .in(parent_task_id).eq(user_id).eq(is_habit).order()
              in: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => Promise.resolve(getChildTasksResult()),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'habit_completions') {
          // completions クエリ: .select().eq().in().gte?().lte?()
          // 各メソッドが thenable な builder を返す
          const builder: Record<string, unknown> = {}
          const thenable = {
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(getCompletionsResult()).then(resolve, reject),
          }
          const methods = ['select', 'eq', 'in', 'gte', 'lte']
          for (const m of methods) {
            builder[m] = () => Object.assign(Object.create(thenable), builder)
          }
          return Object.assign(Object.create(thenable), builder)
        }
        return {}
      },
    })
  ),
}))

// --- テスト対象 ---
import { GET } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const baseHabit = {
  id: 'habit-1',
  user_id: 'user-1',
  title: 'Morning Exercise',
  is_habit: true,
  habit_frequency: 'mon,tue,wed,thu,fri',
}

const baseChild = {
  id: 'child-1',
  user_id: 'user-1',
  parent_task_id: 'habit-1',
  title: 'Warm up',
  is_habit: false,
}

const baseCompletion = {
  id: 'comp-1',
  habit_id: 'habit-1',
  user_id: 'user-1',
  completed_date: '2026-02-19',
}

function getReq(params = '') {
  return new Request(`http://localhost/api/habits${params}`, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  setHabitsResult({ data: [], error: null })
  setChildTasksResult({ data: [], error: null })
  setCompletionsResult({ data: [], error: null })
})

// ============================================================
// GET /api/habits
// ============================================================
describe('GET /api/habits', () => {
  describe('正常系', () => {
    test('習慣一覧を返す（completions・child_tasks なし）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: [baseHabit], error: null })

      const res = await GET(getReq('?from=2026-02-01&to=2026-02-28'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.habits).toHaveLength(1)
      expect(json.habits[0].title).toBe('Morning Exercise')
      expect(json.habits[0].child_tasks).toEqual([])
      expect(json.habits[0].completions).toEqual([])
    })

    test('child_tasks が紐付く習慣を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: [baseHabit], error: null })
      setChildTasksResult({ data: [baseChild], error: null })

      const res = await GET(getReq('?from=2026-02-01&to=2026-02-28'))
      const json = await res.json()

      expect(json.habits[0].child_tasks).toHaveLength(1)
      expect(json.habits[0].child_tasks[0].title).toBe('Warm up')
    })

    test('completions が紐付く習慣を返す（from/to あり）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: [baseHabit], error: null })
      setCompletionsResult({ data: [baseCompletion], error: null })

      const res = await GET(getReq('?from=2026-02-01&to=2026-02-28'))
      const json = await res.json()

      expect(json.habits[0].completions).toHaveLength(1)
      expect(json.habits[0].completions[0].completed_date).toBe('2026-02-19')
    })

    test('習慣が 0 件のとき空配列を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: [], error: null })

      const res = await GET(getReq())
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.habits).toEqual([])
    })

    test('from/to なしのとき completions は空配列（クエリ省略）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: [baseHabit], error: null })

      const res = await GET(getReq())
      const json = await res.json()

      // completions クエリが呼ばれないので空配列
      expect(json.habits[0].completions).toEqual([])
    })

    test('複数習慣が正しくマッピングされる', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const habit2 = { ...baseHabit, id: 'habit-2', title: 'Evening Walk' }
      const child2 = { ...baseChild, id: 'child-2', parent_task_id: 'habit-2', title: 'Stretch' }
      const comp2 = { ...baseCompletion, id: 'comp-2', habit_id: 'habit-2' }

      setHabitsResult({ data: [baseHabit, habit2], error: null })
      setChildTasksResult({ data: [baseChild, child2], error: null })
      setCompletionsResult({ data: [baseCompletion, comp2], error: null })

      const res = await GET(getReq('?from=2026-02-01&to=2026-02-28'))
      const json = await res.json()

      expect(json.habits).toHaveLength(2)
      const h1 = json.habits.find((h: { id: string }) => h.id === 'habit-1')
      const h2 = json.habits.find((h: { id: string }) => h.id === 'habit-2')

      expect(h1.child_tasks[0].title).toBe('Warm up')
      expect(h1.completions[0].completed_date).toBe('2026-02-19')
      expect(h2.child_tasks[0].title).toBe('Stretch')
      expect(h2.completions[0].habit_id).toBe('habit-2')
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await GET(getReq())
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })

    test('auth エラーオブジェクトあり → 401', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Session expired' },
      })

      const res = await GET(getReq())
      expect(res.status).toBe(401)
    })
  })

  describe('DBエラー', () => {
    test('習慣クエリエラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitsResult({ data: null, error: { message: 'DB connection failed' } })

      const res = await GET(getReq())
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('API_ERROR')
    })
  })
})
