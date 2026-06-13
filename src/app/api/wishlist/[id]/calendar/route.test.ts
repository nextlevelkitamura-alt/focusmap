import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const getUser = vi.fn()
  const settingsMaybeSingle = vi.fn()
  const memoMaybeSingle = vi.fn()
  const memoUpdateSingle = vi.fn()
  const memoUpdate = vi.fn()
  const calendarInsert = vi.fn()
  const calendarDelete = vi.fn()

  const from = vi.fn((table: string) => {
    if (table === 'user_calendar_settings') {
      const builder = {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: settingsMaybeSingle,
          })),
        })),
      }
      return builder
    }

    if (table === 'ideal_goals') {
      return {
        select: vi.fn(() => {
          const builder = {
            eq: vi.fn(() => builder),
            maybeSingle: memoMaybeSingle,
          }
          return builder
        }),
        update: memoUpdate.mockImplementation(() => {
          const builder = {
            eq: vi.fn(() => builder),
            select: vi.fn(() => ({
              single: memoUpdateSingle,
            })),
          }
          return builder
        }),
      }
    }

    if (table === 'calendar_events') {
      return {
        delete: vi.fn(() => {
          const builder = {
            eq: vi.fn(() => builder),
          }
          return builder
        }),
      }
    }

    return {}
  })

  return {
    client: {
      auth: { getUser },
      from,
    },
    getUser,
    settingsMaybeSingle,
    memoMaybeSingle,
    memoUpdateSingle,
    memoUpdate,
    calendarInsert,
    calendarDelete,
  }
})

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => mocks.client),
}))

vi.mock('@/lib/google-calendar', () => ({
  getCalendarClient: vi.fn(async () => ({
    calendar: {
      events: {
        insert: mocks.calendarInsert,
        delete: mocks.calendarDelete,
      },
    },
  })),
}))

import { POST } from './route'

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/wishlist/memo-1/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/wishlist/[id]/calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com' } },
      error: null,
    })
    mocks.settingsMaybeSingle.mockResolvedValue({
      data: { is_sync_enabled: true, default_calendar_id: 'default-cal' },
      error: null,
    })
    mocks.memoMaybeSingle.mockResolvedValue({
      data: { google_event_id: null },
      error: null,
    })
    mocks.calendarInsert.mockResolvedValue({
      data: { id: 'google-event-1' },
    })
    mocks.memoUpdateSingle.mockResolvedValue({
      data: {
        id: 'memo-1',
        title: 'メモを予定化',
        scheduled_at: '2026-06-13T01:30:00.000Z',
        duration_minutes: 15,
        google_event_id: 'google-event-1',
        memo_status: 'scheduled',
        ideal_items: [],
      },
      error: null,
    })
  })

  test('ideal_goalsに存在しないcalendar_id列を更新せず、選択カレンダーIDを返す', async () => {
    const res = await POST(createRequest({
      scheduled_at: '2026-06-13T01:30:00.000Z',
      duration_minutes: 15,
      title: 'メモを予定化',
      description: '詳細',
      calendar_id: 'work-cal',
    }), {
      params: Promise.resolve({ id: 'memo-1' }),
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.calendar_id).toBe('work-cal')
    expect(mocks.calendarInsert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'work-cal',
    }))
    expect(mocks.memoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      google_event_id: 'google-event-1',
      scheduled_at: '2026-06-13T01:30:00.000Z',
      duration_minutes: 15,
      memo_status: 'scheduled',
      is_today: false,
    }))
    const updatePayload = mocks.memoUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('calendar_id')
  })
})
