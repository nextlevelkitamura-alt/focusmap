import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  getHabitVerifyResult,
  getUpsertResult,
  getCompletionsResult,
  getDeleteResult,
  setHabitVerifyResult,
  setUpsertResult,
  setCompletionsResult,
  setDeleteResult,
} = vi.hoisted(() => {
  let _habitVerifyResult: { data: unknown; error: unknown } = {
    data: { id: 'habit-1', is_habit: true },
    error: null,
  }
  let _upsertResult: { data: unknown; error: unknown } = { data: null, error: null }
  let _completionsResult: { data: unknown; error: unknown } = { data: [], error: null }
  let _deleteResult: { error: unknown } = { error: null }

  return {
    mockGetUser: vi.fn(),
    getHabitVerifyResult: () => _habitVerifyResult,
    getUpsertResult: () => _upsertResult,
    getCompletionsResult: () => _completionsResult,
    getDeleteResult: () => _deleteResult,
    setHabitVerifyResult: (v: typeof _habitVerifyResult) => { _habitVerifyResult = v },
    setUpsertResult: (v: typeof _upsertResult) => { _upsertResult = v },
    setCompletionsResult: (v: typeof _completionsResult) => { _completionsResult = v },
    setDeleteResult: (v: typeof _deleteResult) => { _deleteResult = v },
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (table: string) => {
        if (table === 'tasks') {
          // POST: habit 所有者確認 .select().eq().eq().single()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve(getHabitVerifyResult()),
                }),
              }),
            }),
          }
        }
        if (table === 'habit_completions') {
          // GET: thenable builder (.select().eq().eq?().gte?().lte?().order())
          const completionsThenable = {
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(getCompletionsResult()).then(resolve, reject),
          }
          const thenableBuilder: Record<string, unknown> = {}
          for (const m of ['select', 'eq', 'gte', 'lte', 'order']) {
            thenableBuilder[m] = () => Object.assign(Object.create(completionsThenable), thenableBuilder)
          }
          const completionsQuery = Object.assign(Object.create(completionsThenable), thenableBuilder)

          return {
            // GET entry point
            select: () => completionsQuery,
            // POST: upsert().select().single()
            upsert: () => ({
              select: () => ({
                single: () => Promise.resolve(getUpsertResult()),
              }),
            }),
            // DELETE: .delete().eq().eq().eq()
            delete: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => Promise.resolve(getDeleteResult()),
                }),
              }),
            }),
          }
        }
        return {}
      },
    })
  ),
}))

// --- テスト対象 ---
import { POST, GET, DELETE } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const baseCompletion = {
  id: 'comp-1',
  habit_id: 'habit-1',
  user_id: 'user-1',
  completed_date: '2026-02-19',
  updated_at: '2026-02-19T00:00:00Z',
}

function makeRequest(method: string, body?: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/habits/completions`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function getReq(params = '') {
  return new Request(`http://localhost/api/habits/completions${params}`, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  setHabitVerifyResult({ data: { id: 'habit-1', is_habit: true }, error: null })
  setUpsertResult({ data: { ...baseCompletion }, error: null })
  setCompletionsResult({ data: [], error: null })
  setDeleteResult({ error: null })
})

// ============================================================
// POST /api/habits/completions
// ============================================================
describe('POST /api/habits/completions', () => {
  const validBody = {
    habit_id: 'habit-1',
    completed_date: '2026-02-19',
  }

  describe('正常系', () => {
    test('completion を upsert して返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(makeRequest('POST', validBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.completion.habit_id).toBe('habit-1')
      expect(json.completion.completed_date).toBe('2026-02-19')
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await POST(makeRequest('POST', validBody))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('バリデーションエラー', () => {
    test('habit_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(makeRequest('POST', { completed_date: '2026-02-19' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })

    test('completed_date 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(makeRequest('POST', { habit_id: 'habit-1' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('DBエラー', () => {
    test('habit が見つからない → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitVerifyResult({ data: null, error: { message: 'Not found' } })

      const res = await POST(makeRequest('POST', validBody))
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error.code).toBe('NOT_FOUND')
    })

    test('is_habit が false のタスク → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setHabitVerifyResult({ data: { id: 'task-1', is_habit: false }, error: null })

      const res = await POST(makeRequest('POST', validBody))
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error.code).toBe('NOT_FOUND')
    })

    test('upsert エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setUpsertResult({ data: null, error: { message: 'Insert failed' } })

      const res = await POST(makeRequest('POST', validBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('API_ERROR')
    })
  })
})

// ============================================================
// GET /api/habits/completions
// ============================================================
describe('GET /api/habits/completions', () => {
  describe('正常系', () => {
    test('completion 一覧を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setCompletionsResult({ data: [baseCompletion], error: null })

      const res = await GET(getReq('?from=2026-02-01&to=2026-02-28'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.completions).toHaveLength(1)
    })

    test('結果なし → 空配列', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setCompletionsResult({ data: [], error: null })

      const res = await GET(getReq())
      const json = await res.json()

      expect(json.completions).toEqual([])
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
  })

  describe('DBエラー', () => {
    test('クエリエラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setCompletionsResult({ data: null, error: { message: 'Query failed' } })

      const res = await GET(getReq())
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('API_ERROR')
    })
  })
})

// ============================================================
// DELETE /api/habits/completions
// ============================================================
describe('DELETE /api/habits/completions', () => {
  const validBody = {
    habit_id: 'habit-1',
    completed_date: '2026-02-19',
  }

  describe('正常系', () => {
    test('completion を削除して success を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(makeRequest('DELETE', validBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await DELETE(makeRequest('DELETE', validBody))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('バリデーションエラー', () => {
    test('habit_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(makeRequest('DELETE', { completed_date: '2026-02-19' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })

    test('completed_date 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(makeRequest('DELETE', { habit_id: 'habit-1' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('DBエラー', () => {
    test('削除エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setDeleteResult({ error: { message: 'Delete failed' } })

      const res = await DELETE(makeRequest('DELETE', validBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('API_ERROR')
    })
  })
})
