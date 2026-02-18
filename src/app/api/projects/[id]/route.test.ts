import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- Supabase mock ---
const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockEq2 = vi.fn(() => ({ select: mockSelect }))
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }))
const mockUpdate = vi.fn(() => ({ eq: mockEq1 }))

const mockDeleteEq2 = vi.fn()
const mockDeleteEq1 = vi.fn(() => ({ eq: mockDeleteEq2 }))
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq1 }))

const mockGetUser = vi.fn()

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) => ({
    update: mockUpdate,
    delete: mockDelete,
  })),
}

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// --- テスト対象 ---
import { PATCH, DELETE } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

function createRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/projects/proj-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createDeleteRequest(): Request {
  return new Request('http://localhost/api/projects/proj-1', {
    method: 'DELETE',
  })
}

const mockParams = Promise.resolve({ id: 'proj-1' })

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================
// PATCH /api/projects/:id
// ===========================
describe('PATCH /api/projects/:id', () => {
  describe('正常系', () => {
    test('title を更新できる', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSingle.mockResolvedValue({
        data: { id: 'proj-1', title: 'Updated Title' },
        error: null,
      })

      const req = createRequest({ title: 'Updated Title' })
      const res = await PATCH(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.title).toBe('Updated Title')

      // update に正しいデータが渡されたか
      expect(mockUpdate).toHaveBeenCalledWith({ title: 'Updated Title' })
      // eq チェーン: .eq("id", "proj-1").eq("user_id", "user-1")
      expect(mockEq1).toHaveBeenCalledWith('id', 'proj-1')
      expect(mockEq2).toHaveBeenCalledWith('user_id', 'user-1')
    })
  })

  describe('異常系', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const req = createRequest({ title: 'Test' })
      const res = await PATCH(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBe('Unauthorized')
    })

    test('DB エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      })

      const req = createRequest({ title: 'Test' })
      const res = await PATCH(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Update failed')
    })
  })
})

// ===========================
// DELETE /api/projects/:id
// ===========================
describe('DELETE /api/projects/:id', () => {
  describe('正常系', () => {
    test('プロジェクトを削除できる', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockDeleteEq2.mockResolvedValue({ error: null })

      const req = createDeleteRequest()
      const res = await DELETE(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)

      // eq チェーン: .eq("id", "proj-1").eq("user_id", "user-1")
      expect(mockDeleteEq1).toHaveBeenCalledWith('id', 'proj-1')
      expect(mockDeleteEq2).toHaveBeenCalledWith('user_id', 'user-1')
    })
  })

  describe('異常系', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const req = createDeleteRequest()
      const res = await DELETE(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBe('Unauthorized')
    })

    test('DB エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockDeleteEq2.mockResolvedValue({
        error: { message: 'Delete failed' },
      })

      const req = createDeleteRequest()
      const res = await DELETE(req, { params: mockParams })
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Delete failed')
    })
  })
})
