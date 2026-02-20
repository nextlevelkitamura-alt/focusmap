import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted でモック変数を先にホイスト ---
const {
  mockGetUser,
  getSelectResult,
  getUpsertResult,
  getUpdateResult,
  setSelectResult,
  setUpsertResult,
  setUpdateResult,
  mockFrom,
} = vi.hoisted(() => {
  let _selectResult: { data: unknown[]; error: unknown } = { data: [], error: null }
  let _upsertResult: { data: unknown[]; error: unknown } = { data: [], error: null }
  let _updateResult: { error: unknown } = { error: null }

  const _mockFrom = vi.fn()

  return {
    mockGetUser: vi.fn(),
    getSelectResult: () => _selectResult,
    getUpsertResult: () => _upsertResult,
    getUpdateResult: () => _updateResult,
    setSelectResult: (v: typeof _selectResult) => { _selectResult = v },
    setUpsertResult: (v: typeof _upsertResult) => { _upsertResult = v },
    setUpdateResult: (v: typeof _updateResult) => { _updateResult = v },
    mockFrom: _mockFrom,
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}))

// --- テスト対象 ---
import { POST } from './route'

// --- Helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

function postReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/tasks/import-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request
}

function createEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    google_event_id: 'gevt-1',
    calendar_id: 'cal-1',
    title: 'Test Event',
    start_time: '2026-02-20T10:00:00Z',
    end_time: '2026-02-20T11:00:00Z',
    is_all_day: false,
    fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setSelectResult({ data: [], error: null })
  setUpsertResult({ data: [], error: null })
  setUpdateResult({ error: null })

  // Default mock: tasks テーブル操作
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => Promise.resolve(getSelectResult()),
        }),
        is: () => Promise.resolve(getSelectResult()),
      }),
    }),
    upsert: () => ({ select: () => Promise.resolve(getUpsertResult()) }),
    update: () => ({
      eq: () => ({
        in: () => Promise.resolve(getUpdateResult()),
      }),
      in: () => Promise.resolve(getUpdateResult()),
    }),
  }))
})

// ============================================================
// POST /api/tasks/import-events
// ============================================================
describe('POST /api/tasks/import-events', () => {
  test('未認証の場合は 401 を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } })

    const res = await POST(postReq({ events: [] }) as any)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  test('events が空の場合はスキップして成功を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })

    const res = await POST(postReq({ events: [] }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result).toEqual({
      inserted: 0,
      updated: 0,
      softDeleted: 0,
      skipped: 0,
    })
  })

  test('新規イベントを INSERT する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // 既存タスクなし
    setSelectResult({ data: [], error: null })
    setUpsertResult({ data: [{ id: 'task-1' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-new' })],
    }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.inserted).toBe(1)
  })

  test('既存タスクの fingerprint が一致する場合はスキップする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // 同じ fingerprint を持つ既存タスク
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        google_event_fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: '2026-02-20T08:00:00Z', // 5分以上前
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.skipped).toBe(1)
    expect(json.result.inserted).toBe(0)
    expect(json.result.updated).toBe(0)
  })

  test('既存タスクの fingerprint が異なる場合は UPDATE する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        google_event_fingerprint: 'Old Title|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: '2026-02-20T08:00:00Z',
      }],
      error: null,
    })
    setUpsertResult({ data: [{ id: 'task-existing' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.updated).toBe(1)
  })

  test('updated_at が5分以内のタスクはスキップする（ユーザー操作中保護）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // updated_at が "now" に近い → スキップ対象
    const recentTime = new Date(Date.now() - 60 * 1000).toISOString() // 1分前
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        google_event_fingerprint: 'Old Title|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: recentTime,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.skipped).toBe(1)
    expect(json.result.updated).toBe(0)
  })

  test('Google にない既存タスクをソフトデリートする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // 既存タスクあるが、送られてきた events に含まれない
    setSelectResult({
      data: [{
        id: 'task-orphan',
        google_event_id: 'gevt-deleted',
        google_event_fingerprint: 'fp',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-new' })],
    }) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.softDeleted).toBeGreaterThanOrEqual(1)
  })

  test('events フィールドがない場合は 400 を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })

    const res = await POST(postReq({}) as any)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('INVALID_REQUEST')
  })
})
