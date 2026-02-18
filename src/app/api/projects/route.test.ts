import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- Supabase mock ---
const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockInsert = vi.fn(() => ({ select: mockSelect }))
const mockGetUser = vi.fn()

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn(() => ({
    insert: mockInsert,
  })),
}

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// --- テスト対象 ---
import { POST } from './route'

// --- helpers ---
function createRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockUser = { id: 'user-1', email: 'test@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/projects', () => {
  // ===========================
  // 正常系
  // ===========================
  describe('正常系', () => {
    test('space_id + title でプロジェクトを作成する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSingle.mockResolvedValue({
        data: { id: 'proj-1', user_id: 'user-1', space_id: 'space-1', title: 'New Project', status: 'active', priority: 3 },
        error: null,
      })

      const req = createRequest({ space_id: 'space-1', title: 'New Project' })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.id).toBe('proj-1')
      expect(json.title).toBe('New Project')

      // insert に正しいデータが渡されたか
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        space_id: 'space-1',
        title: 'New Project',
        status: 'active',
        priority: 3,
      })
    })

    test('status, priority を明示的に指定できる', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSingle.mockResolvedValue({
        data: { id: 'proj-2', status: 'archived', priority: 1 },
        error: null,
      })

      const req = createRequest({
        space_id: 'space-1',
        title: 'Archived',
        status: 'archived',
        priority: 1,
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived', priority: 1 })
      )
    })
  })

  // ===========================
  // 異常系
  // ===========================
  describe('異常系', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const req = createRequest({ space_id: 'space-1', title: 'Test' })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBe('Unauthorized')
    })

    test('space_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const req = createRequest({ title: 'Test' })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('required')
    })

    test('title 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const req = createRequest({ space_id: 'space-1' })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('required')
    })

    test('DB エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      })

      const req = createRequest({ space_id: 'space-1', title: 'Test' })
      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Insert failed')
    })
  })
})
