import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  getSelectResult,
  getUpsertResult,
  getDeleteResult,
  setSelectResult,
  setUpsertResult,
  setDeleteResult,
} = vi.hoisted(() => {
  let _selectResult: { data: unknown; error: unknown } = { data: [], error: null }
  let _upsertResult: { data: unknown; error: unknown } = { data: null, error: null }
  let _deleteResult: { error: unknown } = { error: null }

  return {
    mockGetUser: vi.fn(),
    getSelectResult: () => _selectResult,
    getUpsertResult: () => _upsertResult,
    getDeleteResult: () => _deleteResult,
    setSelectResult: (v: typeof _selectResult) => { _selectResult = v },
    setUpsertResult: (v: typeof _upsertResult) => { _upsertResult = v },
    setDeleteResult: (v: typeof _deleteResult) => { _deleteResult = v },
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve(getSelectResult()),
          }),
        }),
        upsert: () => ({
          select: () => ({
            single: () => Promise.resolve(getUpsertResult()),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve(getDeleteResult()),
            }),
          }),
        }),
      }),
    })
  ),
}))

// --- テスト対象 ---
import { GET, POST, DELETE } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const baseCompletion = {
  id: 'comp-1',
  user_id: 'user-1',
  google_event_id: 'gevt-abc',
  calendar_id: 'cal@gmail.com',
  completed_date: '2026-02-19',
  created_at: '2026-02-19T00:00:00Z',
}

function makeRequest(method: string, options: { body?: Record<string, unknown>; url?: string } = {}): Request {
  const url = options.url ?? 'http://localhost/api/event-completions'
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

function getReq(params = '') {
  return makeRequest('GET', { url: `http://localhost/api/event-completions${params}` })
}
function postReq(body: Record<string, unknown>) { return makeRequest('POST', { body }) }
function deleteReq(body: Record<string, unknown>) { return makeRequest('DELETE', { body }) }

beforeEach(() => {
  vi.clearAllMocks()
  setSelectResult({ data: [], error: null })
  setUpsertResult({ data: { ...baseCompletion }, error: null })
  setDeleteResult({ error: null })
})

// ============================================================
// GET /api/event-completions
// ============================================================
describe('GET /api/event-completions', () => {
  describe('正常系', () => {
    test('今日の完了一覧を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: [baseCompletion], error: null })

      const res = await GET(getReq('?date=2026-02-19'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.completions).toHaveLength(1)
      expect(json.completions[0].google_event_id).toBe('gevt-abc')
    })

    test('completions が空のとき空配列を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: [], error: null })

      const res = await GET(getReq('?date=2026-02-19'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.completions).toEqual([])
    })

    test('date パラメータなしでもデフォルト今日で動作する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: [], error: null })

      const res = await GET(getReq())
      expect(res.status).toBe(200)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await GET(getReq('?date=2026-02-19'))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('DBエラー', () => {
    test('クエリエラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: null, error: { message: 'Query failed' } })

      const res = await GET(getReq('?date=2026-02-19'))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('QUERY_ERROR')
    })
  })
})

// ============================================================
// POST /api/event-completions
// ============================================================
describe('POST /api/event-completions', () => {
  const validBody = {
    google_event_id: 'gevt-abc',
    calendar_id: 'cal@gmail.com',
    completed_date: '2026-02-19',
  }

  describe('正常系', () => {
    test('completion を upsert して返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.completion.google_event_id).toBe('gevt-abc')
    })

    test('completed_date 省略時も動作する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({
        google_event_id: 'gevt-abc',
        calendar_id: 'cal@gmail.com',
      }))

      expect(res.status).toBe(200)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await POST(postReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('バリデーションエラー', () => {
    test('google_event_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ calendar_id: 'cal@gmail.com' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('BAD_REQUEST')
    })

    test('calendar_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ google_event_id: 'gevt-abc' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('BAD_REQUEST')
    })
  })

  describe('DBエラー', () => {
    test('upsert エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setUpsertResult({ data: null, error: { message: 'Insert failed' } })

      const res = await POST(postReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('INSERT_ERROR')
    })
  })
})

// ============================================================
// DELETE /api/event-completions
// ============================================================
describe('DELETE /api/event-completions', () => {
  const validBody = {
    google_event_id: 'gevt-abc',
    completed_date: '2026-02-19',
  }

  describe('正常系', () => {
    test('完了を削除して success を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(deleteReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
    })

    test('completed_date 省略時も動作する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(deleteReq({ google_event_id: 'gevt-abc' }))
      expect(res.status).toBe(200)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await DELETE(deleteReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('バリデーションエラー', () => {
    test('google_event_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(deleteReq({ completed_date: '2026-02-19' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('BAD_REQUEST')
    })
  })

  describe('DBエラー', () => {
    test('削除エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setDeleteResult({ error: { message: 'Delete failed' } })

      const res = await DELETE(deleteReq(validBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('DELETE_ERROR')
    })
  })
})
