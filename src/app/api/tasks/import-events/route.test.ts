import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted でモック変数を先にホイスト ---
const {
  mockGetUser,
  setSelectResult,
  setUpsertResult,
  setUpdateResult,
  getSelectQueries,
  mockUpsertSelect,
  mockFrom,
  mockUpsert,
  createSelectBuilder,
  createUpdateBuilder,
} = vi.hoisted(() => {
  type Filter =
    | { method: 'eq'; column: string; value: unknown }
    | { method: 'not'; column: string; operator: string; value: unknown }
    | { method: 'in'; column: string; value: unknown[] }
    | { method: 'is'; column: string; value: unknown }
    | { method: 'gte'; column: string; value: unknown }
    | { method: 'lt'; column: string; value: unknown }

  type SelectQuery = { table: string; columns?: string; filters: Filter[] }
  type Row = Record<string, unknown>

  let _selectResult: { data: unknown[]; error: unknown } = { data: [], error: null }
  let _upsertResult: { data: unknown[]; error: unknown } = { data: [], error: null }
  let _updateResult: { error: unknown } = { error: null }
  const _selectQueries: SelectQuery[] = []

  const _mockFrom = vi.fn()
  const _mockUpsertSelect = vi.fn(() => Promise.resolve(_upsertResult))
  const _mockUpsert = vi.fn(() => ({ select: _mockUpsertSelect }))

  const toTime = (value: unknown) => {
    if (typeof value !== 'string') return NaN
    return new Date(value).getTime()
  }

  const matchesFilter = (row: Row, filter: Filter) => {
    const value = row[filter.column]
    switch (filter.method) {
      case 'eq':
        if (filter.column === 'user_id' && value === undefined) return true
        return value === filter.value
      case 'not':
        if (filter.operator === 'is' && filter.value === null) return value != null
        return value !== filter.value
      case 'in':
        return filter.value.includes(value)
      case 'is':
        if (filter.value === null) return value == null
        return value === filter.value
      case 'gte': {
        if (value == null) return true
        const rowTime = toTime(value)
        const filterTime = toTime(filter.value)
        return Number.isNaN(rowTime) || Number.isNaN(filterTime)
          ? String(value) >= String(filter.value)
          : rowTime >= filterTime
      }
      case 'lt': {
        if (value == null) return true
        const rowTime = toTime(value)
        const filterTime = toTime(filter.value)
        return Number.isNaN(rowTime) || Number.isNaN(filterTime)
          ? String(value) < String(filter.value)
          : rowTime < filterTime
      }
    }
  }

  const resolveSelect = (query: SelectQuery) => {
    _selectQueries.push({ ...query, filters: [...query.filters] })
    if (_selectResult.error) return _selectResult
    return {
      data: (_selectResult.data as Row[]).filter(row =>
        query.filters.every(filter => matchesFilter(row, filter))
      ),
      error: null,
    }
  }

  const createSelectBuilder = (table: string, columns?: string) => {
    const query: SelectQuery = { table, columns, filters: [] }
    const builder = {
      eq: vi.fn((column: string, value: unknown) => {
        query.filters.push({ method: 'eq', column, value })
        return builder
      }),
      not: vi.fn((column: string, operator: string, value: unknown) => {
        query.filters.push({ method: 'not', column, operator, value })
        return builder
      }),
      in: vi.fn((column: string, value: unknown[]) => {
        query.filters.push({ method: 'in', column, value })
        return builder
      }),
      is: vi.fn((column: string, value: unknown) => {
        query.filters.push({ method: 'is', column, value })
        return builder
      }),
      gte: vi.fn((column: string, value: unknown) => {
        query.filters.push({ method: 'gte', column, value })
        return builder
      }),
      lt: vi.fn((column: string, value: unknown) => {
        query.filters.push({ method: 'lt', column, value })
        return builder
      }),
      then: vi.fn((resolve, reject) => Promise.resolve(resolveSelect(query)).then(resolve, reject)),
    }
    return builder
  }

  const createUpdateBuilder = () => {
    const builder = {
      eq: vi.fn(() => builder),
      in: vi.fn(() => Promise.resolve(_updateResult)),
    }
    return builder
  }

  return {
    mockGetUser: vi.fn(),
    setSelectResult: (v: typeof _selectResult) => { _selectResult = v },
    setUpsertResult: (v: typeof _upsertResult) => { _upsertResult = v },
    setUpdateResult: (v: typeof _updateResult) => { _updateResult = v },
    getSelectQueries: () => _selectQueries,
    mockUpsertSelect: _mockUpsertSelect,
    mockFrom: _mockFrom,
    mockUpsert: _mockUpsert,
    createSelectBuilder,
    createUpdateBuilder,
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

function postReq(body: Record<string, unknown>): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/tasks/import-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0]
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

function findFilter(
  query: ReturnType<typeof getSelectQueries>[number],
  method: string,
  column: string
) {
  return query.filters.find(filter => filter.method === method && filter.column === column)
}

beforeEach(() => {
  vi.clearAllMocks()
  setSelectResult({ data: [], error: null })
  setUpsertResult({ data: [], error: null })
  setUpdateResult({ error: null })
  getSelectQueries().length = 0

  // Default mock: tasks テーブル操作
  mockFrom.mockImplementation(() => ({
    select: (columns?: string) => createSelectBuilder('tasks', columns),
    upsert: mockUpsert,
    update: () => createUpdateBuilder(),
  }))
})

// ============================================================
// POST /api/tasks/import-events
// ============================================================
describe('POST /api/tasks/import-events', () => {
  test('未認証の場合は 401 を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } })

    const res = await POST(postReq({ events: [] }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  test('events が空の場合はスキップして成功を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })

    const res = await POST(postReq({ events: [] }))
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
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.inserted).toBe(1)
    expect(json.result).toMatchObject({
      inserted: 1,
      updated: 0,
      softDeleted: 0,
      skipped: 0,
      tasks: [{ id: 'task-1' }],
    })
    expect(mockUpsertSelect).toHaveBeenCalledWith(expect.stringContaining('google_event_fingerprint'))
    expect(mockUpsertSelect).not.toHaveBeenCalledWith()
  })

  test('既存Google連携task取得は全履歴ではなくimport scopeとincoming keyに限定する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({ data: [], error: null })
    setUpsertResult({ data: [{ id: 'task-1' }], error: null })

    const res = await POST(postReq({
      events: [
        createEventPayload({
          google_event_id: 'gevt-scope',
          calendar_id: 'cal-scope',
          start_time: '2026-02-20T10:00:00Z',
          end_time: '2026-02-20T11:00:00Z',
          fingerprint: 'Scoped|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-scope',
        }),
      ],
    }))

    expect(res.status).toBe(200)

    const queries = getSelectQueries()
    const activeScopeQuery = queries.find(query =>
      findFilter(query, 'not', 'google_event_id') &&
      findFilter(query, 'in', 'calendar_id') &&
      findFilter(query, 'gte', 'scheduled_at') &&
      findFilter(query, 'lt', 'scheduled_at') &&
      findFilter(query, 'is', 'deleted_at')
    )
    expect(activeScopeQuery).toBeTruthy()
    expect(findFilter(activeScopeQuery!, 'in', 'calendar_id')?.value).toEqual(['cal-scope'])
    expect(findFilter(activeScopeQuery!, 'gte', 'scheduled_at')?.value).toBe('2026-02-20T10:00:00.000Z')
    expect(findFilter(activeScopeQuery!, 'lt', 'scheduled_at')?.value).toBe('2026-02-20T11:00:00.000Z')

    const deletedCandidateQuery = queries.find(query =>
      findFilter(query, 'eq', 'source')?.value === 'google_event' &&
      findFilter(query, 'eq', 'calendar_id')?.value === 'cal-scope' &&
      findFilter(query, 'in', 'google_event_id') &&
      findFilter(query, 'not', 'deleted_at')
    )
    expect(deletedCandidateQuery).toBeTruthy()
    expect(findFilter(deletedCandidateQuery!, 'in', 'google_event_id')?.value).toEqual(['gevt-scope'])

    const unscopedHistoryQuery = queries.find(query =>
      findFilter(query, 'not', 'google_event_id') &&
      !findFilter(query, 'in', 'calendar_id') &&
      !findFilter(query, 'gte', 'scheduled_at') &&
      !findFilter(query, 'in', 'google_event_id')
    )
    expect(unscopedHistoryQuery).toBeUndefined()
  })

  test('完了済みの新規イベントは done タスクとして INSERT する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({ data: [], error: null })
    setUpsertResult({ data: [{ id: 'task-done' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-done', is_completed: true })],
    }))
    const json = await res.json()
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.inserted).toBe(1)
    expect(rows[0]).toMatchObject({
      google_event_id: 'gevt-done',
      stage: 'done',
      status: 'done',
    })
  })

  test('同じgoogle_event_idでも別カレンダーなら別タスクとしてINSERTする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({ data: [], error: null })
    setUpsertResult({ data: [{ id: 'task-work' }, { id: 'task-personal' }], error: null })

    const res = await POST(postReq({
      events: [
        createEventPayload({
          google_event_id: 'shared-google-id',
          calendar_id: 'work',
          fingerprint: 'Shared|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|work',
        }),
        createEventPayload({
          google_event_id: 'shared-google-id',
          calendar_id: 'personal',
          fingerprint: 'Shared|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|personal',
        }),
      ],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.inserted).toBe(2)
  })

  test('既存タスクの fingerprint が一致する場合はスキップする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // 同じ fingerprint を持つ既存タスク
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: '2026-02-20T08:00:00Z', // 5分以上前
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.skipped).toBe(1)
    expect(json.result.inserted).toBe(0)
    expect(json.result.updated).toBe(0)
  })

  test('完了済みイベントに対応する既存の自動取り込みタスクは done に補正する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        status: 'todo',
        source: 'google_event',
        scheduled_at: '2026-02-20T10:00:00Z',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })
    setUpsertResult({ data: [{ id: 'task-existing', status: 'done' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload({ is_completed: true })],
    }))
    const json = await res.json()
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.updated).toBe(1)
    expect(json.result.skipped).toBe(0)
    expect(rows[0]).toMatchObject({
      id: 'task-existing',
      stage: 'done',
      status: 'done',
    })
  })

  test('既存の手動Google連携タスクがある場合は自動取り込みタスクを増やさない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'manual-linked-task',
        google_event_id: 'gevt-1',
        google_event_fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        source: 'manual',
        calendar_id: 'cal-1',
        scheduled_at: '2026-02-20T10:00:00Z',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.skipped).toBe(1)
    expect(json.result.inserted).toBe(0)
    expect(json.result.updated).toBe(0)
  })

  test('完了済みイベントでも既存の手動Google連携タスクのstatusは上書きしない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'manual-linked-task',
        google_event_id: 'gevt-1',
        google_event_fingerprint: 'Test Event|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        status: 'todo',
        source: 'manual',
        calendar_id: 'cal-1',
        scheduled_at: '2026-02-20T10:00:00Z',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload({ is_completed: true })],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.skipped).toBe(1)
    expect(json.result.updated).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('既存タスクの fingerprint が異なる場合は UPDATE する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Old Title|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: '2026-02-20T08:00:00Z',
      }],
      error: null,
    })
    setUpsertResult({ data: [{ id: 'task-existing' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.updated).toBe(1)
  })

  test('incoming keyに一致する削除済み自動取り込みタスクは古いscheduled_atでも復活候補にする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-deleted',
        google_event_id: 'gevt-1',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Old Title|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        status: 'todo',
        source: 'google_event',
        scheduled_at: '2026-01-01T10:00:00Z',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: '2026-02-20T09:00:00Z',
      }],
      error: null,
    })
    setUpsertResult({ data: [{ id: 'task-deleted', status: 'done' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload({ is_completed: true })],
    }))
    const json = await res.json()
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.updated).toBe(1)
    expect(rows[0]).toMatchObject({
      id: 'task-deleted',
      deleted_at: null,
      stage: 'done',
      status: 'done',
    })
  })

  test('incoming keyに一致しない削除済みGoogle event taskは復活候補として読まない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-old-deleted',
        google_event_id: 'gevt-old-deleted',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Old|2025-12-01T10:00:00Z|2025-12-01T11:00:00Z|cal-1',
        status: 'todo',
        source: 'google_event',
        scheduled_at: '2025-12-01T10:00:00Z',
        updated_at: '2025-12-01T08:00:00Z',
        deleted_at: '2025-12-01T09:00:00Z',
      }],
      error: null,
    })
    setUpsertResult({ data: [{ id: 'task-new' }], error: null })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-new' })],
    }))
    const json = await res.json()
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const deletedCandidateQuery = getSelectQueries().find(query =>
      findFilter(query, 'eq', 'source')?.value === 'google_event' &&
      findFilter(query, 'not', 'deleted_at')
    )

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.inserted).toBe(1)
    expect(json.result.updated).toBe(0)
    expect(rows[0]).toMatchObject({
      google_event_id: 'gevt-new',
    })
    expect(rows[0].id).not.toBe('task-old-deleted')
    expect(findFilter(deletedCandidateQuery!, 'in', 'google_event_id')?.value).toEqual(['gevt-new'])
  })

  test('updated_at が5分以内のタスクはスキップする（ユーザー操作中保護）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    // updated_at が "now" に近い → スキップ対象
    const recentTime = new Date(Date.now() - 60 * 1000).toISOString() // 1分前
    setSelectResult({
      data: [{
        id: 'task-existing',
        google_event_id: 'gevt-1',
        calendar_id: 'cal-1',
        google_event_fingerprint: 'Old Title|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1',
        updated_at: recentTime,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload()],
    }))
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
        calendar_id: 'cal-1',
        scheduled_at: '2026-02-20T10:30:00Z',
        google_event_fingerprint: 'fp',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-new' })],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.softDeleted).toBeGreaterThanOrEqual(1)
  })

  test('今回の取得範囲外の既存タスクはソフトデリートしない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
    setSelectResult({
      data: [{
        id: 'task-outside-scope',
        google_event_id: 'gevt-outside',
        calendar_id: 'cal-1',
        scheduled_at: '2026-03-20T10:00:00Z',
        google_event_fingerprint: 'fp',
        updated_at: '2026-02-20T08:00:00Z',
        deleted_at: null,
      }],
      error: null,
    })

    const res = await POST(postReq({
      events: [createEventPayload({ google_event_id: 'gevt-new' })],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.result.softDeleted).toBe(0)
  })

  test('events フィールドがない場合は 400 を返す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })

    const res = await POST(postReq({}))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('INVALID_REQUEST')
  })
})
