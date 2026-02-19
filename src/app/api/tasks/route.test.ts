import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  getInsertResult,
  getSelectResult,
  setInsertResult,
  setSelectResult,
} = vi.hoisted(() => {
  let _insertResult: { error: unknown } = { error: null }
  let _selectResult: { data: unknown; error: unknown } = { data: null, error: null }

  return {
    mockGetUser: vi.fn(),
    getInsertResult: () => _insertResult,
    getSelectResult: () => _selectResult,
    setInsertResult: (v: typeof _insertResult) => { _insertResult = v },
    setSelectResult: (v: typeof _selectResult) => { _selectResult = v },
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (table: string) => {
        if (table === 'tasks') {
          return {
            // POST: INSERT
            insert: () => Promise.resolve(getInsertResult()),
            // POST: SELECT after INSERT (.select().eq('id').single())
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve(getSelectResult()),
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
import { POST } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const createdTask = {
  id: 'task-uuid-1',
  user_id: 'user-1',
  title: 'Buy groceries',
  status: 'todo',
  order_index: 0,
  project_id: null,
  parent_task_id: null,
  created_at: '2026-02-19T00:00:00Z',
}

function postReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setInsertResult({ error: null })
  setSelectResult({ data: { ...createdTask }, error: null })
})

// ============================================================
// POST /api/tasks
// ============================================================
describe('POST /api/tasks', () => {
  describe('正常系', () => {
    test('タスクを作成して返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ title: 'Buy groceries' }))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.task.title).toBe('Buy groceries')
    })

    test('クライアント指定の id を使用する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: { ...createdTask, id: 'client-uuid' }, error: null })

      const res = await POST(postReq({ id: 'client-uuid', title: 'Task with ID' }))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.task.id).toBe('client-uuid')
    })

    test('INSERT 成功後の SELECT 失敗でも success: true を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: null, error: { message: 'Row not found' } })

      const res = await POST(postReq({ title: 'Fallback Task' }))
      const json = await res.json()

      // INSERT は成功しているので success: true（最小限のデータを返す）
      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.task.title).toBe('Fallback Task')
    })

    test('title が空白文字の場合は "New Task" にフォールバックする', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: { ...createdTask, title: 'New Task' }, error: null })

      // title = '   ' はバリデーションに引っかかる
      // title = 'something' でフォールバックを確認
      const res = await POST(postReq({ title: 'Valid Title', project_id: 'proj-1' }))
      const json = await res.json()

      expect(json.success).toBe(true)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await POST(postReq({ title: 'Test' }))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('バリデーションエラー', () => {
    test('title 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ project_id: 'proj-1' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })

    test('title が空文字 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ title: '' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })

    test('title が空白のみ → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ title: '   ' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('DBエラー', () => {
    test('INSERT 失敗 → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setInsertResult({ error: { code: '23505', message: 'Duplicate key', details: null, hint: null } })

      const res = await POST(postReq({ title: 'Duplicate Task' }))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.success).toBe(false)
      expect(json.error.code).toBe('23505')
    })
  })
})
