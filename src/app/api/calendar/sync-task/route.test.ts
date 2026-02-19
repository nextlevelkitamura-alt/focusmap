import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- vi.hoisted で変数を先にホイスト ---
const {
  mockGetUser,
  mockSyncTaskToCalendar,
  mockDeleteTaskFromCalendar,
  getTaskSelectResult,
  getTaskUpdateResult,
  getSettingsResult,
  setTaskSelectResult,
  setTaskUpdateResult,
  setSettingsResult,
} = vi.hoisted(() => {
  let _taskSelectResult: { data: unknown; error: unknown } = { data: null, error: null }
  let _taskUpdateResult: { error: unknown } = { error: null }
  let _settingsResult: { data: unknown; error: unknown } = { data: null, error: null }

  return {
    mockGetUser: vi.fn(),
    mockSyncTaskToCalendar: vi.fn(),
    mockDeleteTaskFromCalendar: vi.fn(),
    getTaskSelectResult: () => _taskSelectResult,
    getTaskUpdateResult: () => _taskUpdateResult,
    getSettingsResult: () => _settingsResult,
    setTaskSelectResult: (v: typeof _taskSelectResult) => { _taskSelectResult = v },
    setTaskUpdateResult: (v: typeof _taskUpdateResult) => { _taskUpdateResult = v },
    setSettingsResult: (v: typeof _settingsResult) => { _settingsResult = v },
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
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve(getTaskSelectResult()),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve(getTaskUpdateResult()),
              }),
            }),
          }
        }
        if (table === 'user_calendar_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve(getSettingsResult()),
              }),
            }),
          }
        }
        return {}
      },
    })
  ),
}))

vi.mock('@/lib/google-calendar', () => ({
  syncTaskToCalendar: mockSyncTaskToCalendar,
  deleteTaskFromCalendar: mockDeleteTaskFromCalendar,
}))

// --- テスト対象 ---
import { POST, PATCH, DELETE } from './route'

// --- helpers ---
const mockUser = { id: 'user-1', email: 'test@example.com' }

const baseTask = {
  id: 'task-1',
  user_id: 'user-1',
  title: 'Test Task',
  calendar_id: 'cal@gmail.com',
  google_event_id: null as string | null,
}

const baseSettings = {
  id: 'settings-1',
  user_id: 'user-1',
  is_sync_enabled: true,
  access_token: 'token-abc',
}

function makeRequest(method: string, body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/calendar/sync-task', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postReq(body: Record<string, unknown>) { return makeRequest('POST', body) }
function patchReq(body: Record<string, unknown>) { return makeRequest('PATCH', body) }
function deleteReq(body: Record<string, unknown>) { return makeRequest('DELETE', body) }

const validPostBody = {
  taskId: 'task-1',
  scheduled_at: '2026-02-19T14:00:00Z',
  estimated_time: 60,
  calendar_id: 'cal@gmail.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  // デフォルトの成功状態にリセット
  setTaskSelectResult({ data: { ...baseTask }, error: null })
  setTaskUpdateResult({ error: null })
  setSettingsResult({ data: { ...baseSettings }, error: null })
  mockSyncTaskToCalendar.mockResolvedValue({ googleEventId: 'gevt-123' })
  mockDeleteTaskFromCalendar.mockResolvedValue(undefined)
})

// ============================================================
// POST /api/calendar/sync-task
// ============================================================
describe('POST /api/calendar/sync-task', () => {
  describe('正常系', () => {
    test('タスクをカレンダーに同期して googleEventId を返す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.googleEventId).toBe('gevt-123')

      expect(mockSyncTaskToCalendar).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        expect.objectContaining({
          title: 'Test Task',
          scheduled_at: '2026-02-19T14:00:00Z',
          estimated_time: 60,
          calendar_id: 'cal@gmail.com',
        })
      )
    })

    test('task に google_event_id があれば更新として syncTaskToCalendar に渡す', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-existing' },
        error: null,
      })

      await POST(postReq(validPostBody))

      expect(mockSyncTaskToCalendar).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        expect.objectContaining({ google_event_id: 'gevt-existing' })
      )
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBe('Unauthorized')
      expect(mockSyncTaskToCalendar).not.toHaveBeenCalled()
    })

    test('auth エラーオブジェクトあり → 401', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'JWT expired' },
      })

      const res = await POST(postReq(validPostBody))
      expect(res.status).toBe(401)
    })
  })

  describe('バリデーションエラー', () => {
    test('taskId 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ scheduled_at: '2026-02-19T14:00:00Z', estimated_time: 60, calendar_id: 'cal@gmail.com' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('taskId')
    })

    test('scheduled_at 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ taskId: 'task-1', estimated_time: 60, calendar_id: 'cal@gmail.com' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('scheduled_at')
    })

    test('estimated_time が 0 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ ...validPostBody, estimated_time: 0 }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('estimated_time')
    })

    test('estimated_time が負数 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ ...validPostBody, estimated_time: -1 }))
      const json = await res.json()

      expect(res.status).toBe(400)
    })

    test('calendar_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await POST(postReq({ taskId: 'task-1', scheduled_at: '2026-02-19T14:00:00Z', estimated_time: 60 }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('calendar_id')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({ data: null, error: { message: 'Row not found' } })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error).toBe('Task not found')
    })

    test('タスク更新エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskUpdateResult({ error: { message: 'Update failed' } })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toContain('Failed to update task')
    })
  })

  describe('カレンダー設定エラー', () => {
    test('カレンダー未連携（settings が null）→ 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSettingsResult({ data: null, error: null })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('not connected')
    })

    test('同期が無効（is_sync_enabled: false）→ 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setSettingsResult({
        data: { ...baseSettings, is_sync_enabled: false },
        error: null,
      })

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('disabled')
    })

    test('syncTaskToCalendar が例外をスロー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      mockSyncTaskToCalendar.mockRejectedValue(new Error('Google API error'))

      const res = await POST(postReq(validPostBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Google API error')
    })
  })
})

// ============================================================
// PATCH /api/calendar/sync-task
// ============================================================
describe('PATCH /api/calendar/sync-task', () => {
  const validPatchBody = {
    taskId: 'task-1',
    scheduled_at: '2026-02-20T10:00:00Z',
    estimated_time: 90,
    calendar_id: 'cal@gmail.com',
  }

  describe('正常系', () => {
    test('google_event_id があるタスクを更新する', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-existing' },
        error: null,
      })

      const res = await PATCH(patchReq(validPatchBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.googleEventId).toBe('gevt-123')

      expect(mockSyncTaskToCalendar).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        expect.objectContaining({ google_event_id: 'gevt-existing' })
      )
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await PATCH(patchReq(validPatchBody))
      expect(res.status).toBe(401)
    })
  })

  describe('バリデーションエラー', () => {
    test('taskId 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await PATCH(patchReq({ scheduled_at: '2026-02-20T10:00:00Z' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('taskId')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({ data: null, error: { message: 'Not found' } })

      const res = await PATCH(patchReq(validPatchBody))
      expect(res.status).toBe(404)
    })

    test('google_event_id がないタスク → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: null },
        error: null,
      })

      const res = await PATCH(patchReq(validPatchBody))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('google_event_id')
    })

    test('syncTaskToCalendar が例外をスロー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-existing' },
        error: null,
      })
      mockSyncTaskToCalendar.mockRejectedValue(new Error('Calendar API error'))

      const res = await PATCH(patchReq(validPatchBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Calendar API error')
    })
  })
})

// ============================================================
// DELETE /api/calendar/sync-task
// ============================================================
describe('DELETE /api/calendar/sync-task', () => {
  const validDeleteBody = {
    taskId: 'task-1',
    google_event_id: 'gevt-123',
  }

  describe('正常系', () => {
    test('イベントを削除して task の google_event_id, calendar_id をクリアする', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-123', calendar_id: 'cal@gmail.com' },
        error: null,
      })

      const res = await DELETE(deleteReq(validDeleteBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)

      expect(mockDeleteTaskFromCalendar).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        'gevt-123',
        'cal@gmail.com'
      )
    })

    test('calendar_id が null のタスクでも削除できる', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-123', calendar_id: null },
        error: null,
      })

      const res = await DELETE(deleteReq(validDeleteBody))
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      // undefined が渡される（calendarId?: string）
      expect(mockDeleteTaskFromCalendar).toHaveBeenCalledWith(
        'user-1',
        'task-1',
        'gevt-123',
        undefined
      )
    })
  })

  describe('認証エラー', () => {
    test('未認証 → 401', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const res = await DELETE(deleteReq(validDeleteBody))
      expect(res.status).toBe(401)
    })
  })

  describe('バリデーションエラー', () => {
    test('taskId 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(deleteReq({ google_event_id: 'gevt-123' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('taskId')
    })

    test('google_event_id 欠落 → 400', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })

      const res = await DELETE(deleteReq({ taskId: 'task-1' }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('google_event_id')
    })
  })

  describe('DBエラー', () => {
    test('タスク未存在 → 404', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({ data: null, error: { message: 'Not found' } })

      const res = await DELETE(deleteReq(validDeleteBody))
      expect(res.status).toBe(404)
    })

    test('タスク更新エラー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-123' },
        error: null,
      })
      setTaskUpdateResult({ error: { message: 'Update failed' } })

      const res = await DELETE(deleteReq(validDeleteBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toContain('Failed to update task')
    })

    test('deleteTaskFromCalendar が例外をスロー → 500', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } })
      setTaskSelectResult({
        data: { ...baseTask, google_event_id: 'gevt-123' },
        error: null,
      })
      mockDeleteTaskFromCalendar.mockRejectedValue(new Error('Google delete error'))

      const res = await DELETE(deleteReq(validDeleteBody))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBe('Google delete error')
    })
  })
})
