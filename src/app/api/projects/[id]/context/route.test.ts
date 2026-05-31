import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockProjectSingle = vi.fn()
const mockProjectEq2 = vi.fn(() => ({ single: mockProjectSingle }))
const mockProjectEq1 = vi.fn(() => ({ eq: mockProjectEq2 }))
const mockProjectSelect = vi.fn(() => ({ eq: mockProjectEq1 }))

const mockContextMaybeSingle = vi.fn()
const mockContextEq2 = vi.fn(() => ({ maybeSingle: mockContextMaybeSingle }))
const mockContextEq1 = vi.fn(() => ({ eq: mockContextEq2 }))
const mockContextSelect = vi.fn(() => ({ eq: mockContextEq1 }))

const mockContextInsertSingle = vi.fn()
const mockContextInsertSelect = vi.fn(() => ({ single: mockContextInsertSingle }))
const mockContextInsert = vi.fn(() => ({ select: mockContextInsertSelect }))

const mockContextUpsertSingle = vi.fn()
const mockContextUpsertSelect = vi.fn(() => ({ single: mockContextUpsertSingle }))
const mockContextUpsert = vi.fn(() => ({ select: mockContextUpsertSelect }))

const mockGetUser = vi.fn()

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) => {
    if (table === 'projects') {
      return { select: mockProjectSelect }
    }
    return {
      select: mockContextSelect,
      insert: mockContextInsert,
      upsert: mockContextUpsert,
    }
  }),
}

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { GET, PUT } from './route'

const mockUser = { id: 'user-1', email: 'test@example.com' }
const mockParams = Promise.resolve({ id: 'proj-1' })

function createPutRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/projects/proj-1/context', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/projects/:id/context', () => {
  test('既存のプロジェクト文脈を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser } })
    mockProjectSingle.mockResolvedValue({ data: { id: 'proj-1' }, error: null })
    mockContextMaybeSingle.mockResolvedValue({
      data: {
        id: 'ctx-1',
        project_id: 'proj-1',
        heading: '見出し',
        details: '詳細',
        progress: '',
        progress_status: 'not_started',
      },
      error: null,
    })

    const res = await GET(new Request('http://localhost/api/projects/proj-1/context'), { params: mockParams })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.heading).toBe('見出し')
    expect(mockContextInsert).not.toHaveBeenCalled()
  })

  test('未作成の場合は空の文脈行を作る', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser } })
    mockProjectSingle.mockResolvedValue({ data: { id: 'proj-1' }, error: null })
    mockContextMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockContextInsertSingle.mockResolvedValue({
      data: {
        id: 'ctx-1',
        project_id: 'proj-1',
        heading: '',
        details: '',
        progress: '',
        progress_status: 'not_started',
      },
      error: null,
    })

    const res = await GET(new Request('http://localhost/api/projects/proj-1/context'), { params: mockParams })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('ctx-1')
    expect(mockContextInsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      project_id: 'proj-1',
    })
  })
})

describe('PUT /api/projects/:id/context', () => {
  test('見出し・詳細・進捗を upsert する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser } })
    mockProjectSingle.mockResolvedValue({ data: { id: 'proj-1' }, error: null })
    mockContextUpsertSingle.mockResolvedValue({
      data: {
        id: 'ctx-1',
        project_id: 'proj-1',
        heading: '見出し',
        details: '詳細',
        progress: '完了済み',
        progress_status: 'done',
      },
      error: null,
    })

    const req = createPutRequest({
      heading: '  見出し  ',
      details: '  詳細  ',
      progress: '  完了済み  ',
      progress_status: 'done',
    })
    const res = await PUT(req, { params: mockParams })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.progress_status).toBe('done')
    expect(mockContextUpsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        project_id: 'proj-1',
        heading: '見出し',
        details: '詳細',
        progress: '完了済み',
        progress_status: 'done',
      },
      { onConflict: 'project_id,user_id' },
    )
  })

  test('未認証の場合は 401 を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await PUT(createPutRequest({ heading: '見出し' }), { params: mockParams })
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe('Unauthorized')
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})
