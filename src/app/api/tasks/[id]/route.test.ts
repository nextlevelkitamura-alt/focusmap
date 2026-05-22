import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  mockDeleteFromCalendar,
  mockSyncToCalendar,
  mockCalendarEventsUpdate,
  mockEventCompletionsUpsert,
  mockEventCompletionsDelete,
  getSelectResult,
  getUpdateResult,
  getDeleteResult,
  getCalendarEventsUpdateResult,
  getEventCompletionsUpsertResult,
  getEventCompletionsDeleteResult,
  setSelectResult,
  setUpdateResult,
  setDeleteResult,
  setCalendarEventsUpdateResult,
  setEventCompletionsUpsertResult,
  setEventCompletionsDeleteResult,
} = vi.hoisted(() => {
  let _selectResult: { data: unknown; error: unknown } = { data: null, error: null }
  let _updateResult: { data: unknown; error: unknown } = { data: null, error: null }
  let _deleteResult: { error: unknown } = { error: null }
  let _calendarEventsUpdateResult: { data: unknown; error: unknown } = { data: [], error: null }
  let _eventCompletionsUpsertResult: { error: unknown } = { error: null }
  let _eventCompletionsDeleteResult: { error: unknown } = { error: null }

  return {
    mockGetUser: vi.fn(),
    mockDeleteFromCalendar: vi.fn(),
    mockSyncToCalendar: vi.fn(),
    mockCalendarEventsUpdate: vi.fn(),
    mockEventCompletionsUpsert: vi.fn(),
    mockEventCompletionsDelete: vi.fn(),
    getSelectResult: () => _selectResult,
    getUpdateResult: () => _updateResult,
    getDeleteResult: () => _deleteResult,
    getCalendarEventsUpdateResult: () => _calendarEventsUpdateResult,
    getEventCompletionsUpsertResult: () => _eventCompletionsUpsertResult,
    getEventCompletionsDeleteResult: () => _eventCompletionsDeleteResult,
    setSelectResult: (v: typeof _selectResult) => { _selectResult = v },
    setUpdateResult: (v: typeof _updateResult) => { _updateResult = v },
    setDeleteResult: (v: typeof _deleteResult) => { _deleteResult = v },
    setCalendarEventsUpdateResult: (v: typeof _calendarEventsUpdateResult) => { _calendarEventsUpdateResult = v },
    setEventCompletionsUpsertResult: (v: typeof _eventCompletionsUpsertResult) => { _eventCompletionsUpsertResult = v },
    setEventCompletionsDeleteResult: (v: typeof _eventCompletionsDeleteResult) => { _eventCompletionsDeleteResult = v },
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (table: string) => {
        const createTaskUpdateSelectResult = () => ({
          single: () => Promise.resolve(getUpdateResult()),
          then: (
            resolve: (value: ReturnType<typeof getUpdateResult>) => unknown,
            reject?: (reason: unknown) => unknown
          ) => Promise.resolve(getUpdateResult()).then(resolve, reject),
        })

        if (table === 'tasks') {
          return {
            // GET / DELETE の最初のタスク取得: .select().eq().eq().single()
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve(getSelectResult()),
                }),
              }),
            }),
            // DELETE: .delete().eq().eq()
            delete: () => ({
              eq: () => ({
                eq: () => Promise.resolve(getDeleteResult()),
              }),
            }),
            // PATCH: .update().eq().eq().select().single()
            update: () => {
              const builder: Record<string, unknown> = {}
              builder.eq = () => builder
              builder.is = () => builder
              builder.select = createTaskUpdateSelectResult
              return builder
            },
          }
        }
        if (table === 'calendar_events') {
          return {
            update: mockCalendarEventsUpdate.mockImplementation(() => {
              const builder: Record<string, unknown> = {}
              builder.eq = () => builder
              builder.select = () => Promise.resolve(getCalendarEventsUpdateResult())
              return builder
            }),
          }
        }
        if (table === 'event_completions') {
          return {
            upsert: mockEventCompletionsUpsert.mockImplementation(() =>
              Promise.resolve(getEventCompletionsUpsertResult())
            ),
            delete: mockEventCompletionsDelete.mockImplementation(() => {
              const builder: Record<string, unknown> = {}
              builder.eq = () => builder
              builder.then = (
                resolve: (value: ReturnType<typeof getEventCompletionsDeleteResult>) => unknown,
                reject?: (reason: unknown) => unknown
              ) => Promise.resolve(getEventCompletionsDeleteResult()).then(resolve, reject)
              return builder
            }),
          }
        }
        if (table === 'ideal_goals') {
          return {
            update: () => {
              const builder: Record<string, unknown> = {}
              builder.eq = () => builder
              builder.then = (
                resolve: (value: { error: null }) => unknown,
                reject?: (reason: unknown) => unknown
              ) => Promise.resolve({ error: null }).then(resolve, reject)
              return builder
            },
          }
        }
        return {}
      },
    })
  ),
}))

// PATCH の dynamic import を含む google-calendar モック
vi.mock('@/lib/google-calendar', () => ({
  deleteTaskFromCalendar: mockDeleteFromCalendar,
  syncTaskToCalendar: mockSyncToCalendar,
}))

// --- テスト対象 ---
import { GET, DELETE, PATCH } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const baseTask = {
  id: 'task-1',
  user_id: 'user-1',
  title: 'Test Task',
  status: 'todo',
  google_event_id: null as string | null,
  calendar_id: null as string | null,
  scheduled_at: null as string | null,
  estimated_time: 60,
}

function makeRequest(
  method: string,
  id: string,
  body?: Record<string, unknown>
): Request {
  return new Request(`http://localhost/api/tasks/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const mockParams = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  setSelectResult({ data: { ...baseTask }, error: null })
  setUpdateResult({ data: { ...baseTask }, error: null })
  setDeleteResult({ error: null })
  setCalendarEventsUpdateResult({ data: [{ id: 'event-row-1', calendar_id: 'cal@gmail.com' }], error: null })
  setEventCompletionsUpsertResult({ error: null })
  setEventCompletionsDeleteResult({ error: null })
  mockDeleteFromCalendar.mockResolvedValue(undefined)
  mockSyncToCalendar.mockResolvedValue({ googleEventId: 'gevt-updated' })
})

// ============================================================
// GET /api/tasks/[id]
// ============================================================
describe('GET /api/tasks/[id]', () => {
  describe('正常系', () => {
    test('タスクを取得して返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await GET(makeRequest('GET', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.task.id).toBe('task-1')
      expect(json.task.title).toBe('Test Task')
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await GET(makeRequest('GET', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: null, error: { message: 'Not found' } })

      const res = await GET(makeRequest('GET', 'task-missing'), mockParams('task-missing'))
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error.code).toBe('NOT_FOUND')
    })
  })
})

// ============================================================
// DELETE /api/tasks/[id]
// ============================================================
describe('DELETE /api/tasks/[id]', () => {
  describe('正常系', () => {
    test('タスクを削除して success を返す（google_event_id なし）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(makeRequest('DELETE', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(mockDeleteFromCalendar).not.toHaveBeenCalled()
    })

    test('google_event_id ありのタスク削除では calendar も削除する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({
        data: {
          ...baseTask,
          google_event_id: 'gevt-1',
          calendar_id: 'cal@gmail.com',
        },
        error: null,
      })

      const res = await DELETE(makeRequest('DELETE', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(mockDeleteFromCalendar).toHaveBeenCalledWith(
        'user-1', 'task-1', 'gevt-1', 'cal@gmail.com'
      )
    })

    test('カレンダー削除が失敗してもタスク削除は続行する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-1' },
        error: null,
      })
      mockDeleteFromCalendar.mockRejectedValue(new Error('Calendar API error'))

      const res = await DELETE(makeRequest('DELETE', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      // カレンダーエラーを無視してタスク削除成功
      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await DELETE(makeRequest('DELETE', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: null, error: { message: 'Not found' } })

      const res = await DELETE(makeRequest('DELETE', 'task-missing'), mockParams('task-missing'))
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error.code).toBe('NOT_FOUND')
    })

    test('削除エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setDeleteResult({ error: { message: 'Delete failed' } })

      const res = await DELETE(makeRequest('DELETE', 'task-1'), mockParams('task-1'))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('DELETE_ERROR')
    })
  })
})

// ============================================================
// PATCH /api/tasks/[id]
// ============================================================
describe('PATCH /api/tasks/[id]', () => {
  describe('正常系', () => {
    test('タスクを更新して返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setUpdateResult({
        data: { ...baseTask, title: 'Updated Title' },
        error: null,
      })

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'Updated Title' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.task.title).toBe('Updated Title')
    })

    test('google_event_id ありでタイトル変更 → カレンダーも更新', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({
        data: {
          ...baseTask,
          google_event_id: 'gevt-1',
          calendar_id: 'cal@gmail.com',
          scheduled_at: '2026-02-19T14:00:00Z',
        },
        error: null,
      })
      setUpdateResult({
        data: {
          ...baseTask,
          title: 'Updated Title',
          google_event_id: 'gevt-1',
          scheduled_at: '2026-02-19T14:00:00Z',
        },
        error: null,
      })

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'Updated Title' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(mockSyncToCalendar).toHaveBeenCalled()
    })

    test('google_event_id なしの場合はカレンダー更新しない', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      // google_event_id = null (デフォルト)

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'New Title' }),
        mockParams('task-1')
      )

      expect(res.status).toBe(200)
      expect(mockSyncToCalendar).not.toHaveBeenCalled()
    })

    test('google_event_id ありで完了にするとイベント完了記録も保存する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({
        data: {
          ...baseTask,
          source: 'google_event',
          google_event_id: 'gevt-1',
          calendar_id: 'cal@gmail.com',
          scheduled_at: '2026-02-19T14:00:00Z',
        },
        error: null,
      })
      setUpdateResult({
        data: [{
          ...baseTask,
          source: 'google_event',
          status: 'done',
          google_event_id: 'gevt-1',
          calendar_id: 'cal@gmail.com',
          scheduled_at: '2026-02-19T14:00:00Z',
        }],
        error: null,
      })

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { status: 'done' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(mockCalendarEventsUpdate).toHaveBeenCalledWith({ is_completed: true })
      expect(mockEventCompletionsUpsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        google_event_id: 'gevt-1',
        calendar_id: 'cal@gmail.com',
        completed_date: '2026-02-19',
      }, {
        onConflict: 'user_id,google_event_id,completed_date',
      })
    })

    test('カレンダー更新失敗してもタスク更新は成功', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-1', calendar_id: 'cal@gmail.com' },
        error: null,
      })
      setUpdateResult({
        data: { ...baseTask, title: 'Updated', google_event_id: 'gevt-1' },
        error: null,
      })
      mockSyncToCalendar.mockRejectedValue(new Error('Calendar sync failed'))

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'Updated' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'Test' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSelectResult({ data: null, error: { message: 'Not found' } })

      const res = await PATCH(
        makeRequest('PATCH', 'task-missing', { title: 'Test' }),
        mockParams('task-missing')
      )
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error.code).toBe('NOT_FOUND')
    })

    test('更新エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setUpdateResult({ data: null, error: { message: 'Update failed' } })

      const res = await PATCH(
        makeRequest('PATCH', 'task-1', { title: 'Test' }),
        mockParams('task-1')
      )
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error.code).toBe('UPDATE_ERROR')
    })
  })
})
