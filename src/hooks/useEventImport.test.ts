import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { CalendarEvent } from '@/types/calendar'
import {
  computeFingerprint,
  shouldFilterEvent,
  isRecentlyUpdated,
  mapEventToTask,
} from './useEventImport'

// --- Helpers ---

function createMockEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 6)}`,
    user_id: 'user-1',
    google_event_id: 'gevt-1',
    calendar_id: 'cal-1',
    title: 'Test Event',
    start_time: '2026-02-20T10:00:00Z',
    end_time: '2026-02-20T11:00:00Z',
    is_all_day: false,
    timezone: 'Asia/Tokyo',
    synced_at: '2026-02-20T09:00:00Z',
    created_at: '2026-02-20T08:00:00Z',
    updated_at: '2026-02-20T09:00:00Z',
    ...overrides,
  }
}

// =============================================================
// computeFingerprint
// =============================================================

describe('computeFingerprint', () => {
  test('タイトル・開始/終了時間・カレンダーIDからフィンガープリントを生成する', () => {
    const event = createMockEvent({
      title: 'Meeting',
      start_time: '2026-02-20T10:00:00Z',
      end_time: '2026-02-20T11:00:00Z',
      calendar_id: 'cal-1',
    })
    const fp = computeFingerprint(event)
    expect(fp).toBe('Meeting|2026-02-20T10:00:00Z|2026-02-20T11:00:00Z|cal-1')
  })

  test('タイトルが変わるとフィンガープリントが変わる', () => {
    const event1 = createMockEvent({ title: 'Meeting A' })
    const event2 = createMockEvent({ title: 'Meeting B' })
    expect(computeFingerprint(event1)).not.toBe(computeFingerprint(event2))
  })

  test('時間が変わるとフィンガープリントが変わる', () => {
    const event1 = createMockEvent({ start_time: '2026-02-20T10:00:00Z' })
    const event2 = createMockEvent({ start_time: '2026-02-20T11:00:00Z' })
    expect(computeFingerprint(event1)).not.toBe(computeFingerprint(event2))
  })
})

// =============================================================
// shouldFilterEvent
// =============================================================

describe('shouldFilterEvent', () => {
  test('全日イベントは除外する', () => {
    const event = createMockEvent({ is_all_day: true })
    expect(shouldFilterEvent(event)).toBe(true)
  })

  test('通常イベントは取り込む', () => {
    const event = createMockEvent({ is_all_day: false })
    expect(shouldFilterEvent(event)).toBe(false)
  })
})

// =============================================================
// isRecentlyUpdated
// =============================================================

describe('isRecentlyUpdated', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('updated_at が5分以内ならtrueを返す', () => {
    vi.setSystemTime(new Date('2026-02-20T10:04:00Z'))
    expect(isRecentlyUpdated('2026-02-20T10:00:00Z')).toBe(true)
  })

  test('updated_at が5分超ならfalseを返す', () => {
    vi.setSystemTime(new Date('2026-02-20T10:06:00Z'))
    expect(isRecentlyUpdated('2026-02-20T10:00:00Z')).toBe(false)
  })

  test('updated_at がnullならfalseを返す', () => {
    expect(isRecentlyUpdated(null)).toBe(false)
  })

  test('カスタム閾値（10分）で判定できる', () => {
    vi.setSystemTime(new Date('2026-02-20T10:08:00Z'))
    expect(isRecentlyUpdated('2026-02-20T10:00:00Z', 10)).toBe(true)
    expect(isRecentlyUpdated('2026-02-20T10:00:00Z', 5)).toBe(false)
  })
})

// =============================================================
// mapEventToTask
// =============================================================

describe('mapEventToTask', () => {
  test('CalendarEvent を Task フィールドに正しくマッピングする', () => {
    const event = createMockEvent({
      google_event_id: 'gevt-abc',
      calendar_id: 'cal-work',
      title: 'チーム会議',
      start_time: '2026-02-20T10:00:00Z',
      end_time: '2026-02-20T11:30:00Z',
    })

    const task = mapEventToTask(event, 'user-123')

    expect(task).toMatchObject({
      user_id: 'user-123',
      title: 'チーム会議',
      google_event_id: 'gevt-abc',
      calendar_id: 'cal-work',
      scheduled_at: '2026-02-20T10:00:00Z',
      estimated_time: 90, // 1.5 hours = 90 minutes
      source: 'google_event',
      stage: 'scheduled',
      status: 'todo',
    })
  })

  test('フィンガープリントが設定される', () => {
    const event = createMockEvent()
    const task = mapEventToTask(event, 'user-1')
    expect(task.google_event_fingerprint).toBe(computeFingerprint(event))
  })

  test('30分のイベントは estimated_time=30 になる', () => {
    const event = createMockEvent({
      start_time: '2026-02-20T10:00:00Z',
      end_time: '2026-02-20T10:30:00Z',
    })
    const task = mapEventToTask(event, 'user-1')
    expect(task.estimated_time).toBe(30)
  })
})

// =============================================================
// useEventImport Hook
// =============================================================

describe('useEventImport', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  test('初期状態: isImporting=false, lastImportedAt=null, error=null', async () => {
    // useEventImport の import を遅延させてモック可能にする
    const { useEventImport } = await import('./useEventImport')

    const { result } = renderHook(() => useEventImport())

    expect(result.current.isImporting).toBe(false)
    expect(result.current.lastImportedAt).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('importEvents: 新規イベントを取り込める', async () => {
    // API成功レスポンス
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: { inserted: 2, updated: 0, softDeleted: 0, skipped: 0 },
      }),
    })

    const { useEventImport } = await import('./useEventImport')
    const { result } = renderHook(() => useEventImport())

    const events = [
      createMockEvent({ google_event_id: 'gevt-1', title: 'Event 1' }),
      createMockEvent({ google_event_id: 'gevt-2', title: 'Event 2' }),
    ]

    let importResult: any
    await act(async () => {
      importResult = await result.current.importEvents(events)
    })

    expect(importResult).toEqual({
      inserted: 2,
      updated: 0,
      softDeleted: 0,
      skipped: 0,
    })
    expect(result.current.lastImportedAt).not.toBeNull()
  })

  test('importEvents: 全日イベントはフィルタされてAPIに送られない', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: { inserted: 1, updated: 0, softDeleted: 0, skipped: 0 },
      }),
    })

    const { useEventImport } = await import('./useEventImport')
    const { result } = renderHook(() => useEventImport())

    const events = [
      createMockEvent({ google_event_id: 'gevt-1', is_all_day: false }),
      createMockEvent({ google_event_id: 'gevt-2', is_all_day: true }),
    ]

    await act(async () => {
      await result.current.importEvents(events)
    })

    // fetch に渡されたイベントが1つだけであること
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].google_event_id).toBe('gevt-1')
  })

  test('importEvents: APIエラー時はerrorが設定される', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal error' },
      }),
    })

    const { useEventImport } = await import('./useEventImport')
    const { result } = renderHook(() => useEventImport())

    await act(async () => {
      try {
        await result.current.importEvents([createMockEvent()])
      } catch {
        // expected
      }
    })

    expect(result.current.error).not.toBeNull()
  })

  test('importEvents: 空配列の場合はAPIを呼ばない', async () => {
    const { useEventImport } = await import('./useEventImport')
    const { result } = renderHook(() => useEventImport())

    let importResult: any
    await act(async () => {
      importResult = await result.current.importEvents([])
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(importResult).toEqual({
      inserted: 0,
      updated: 0,
      softDeleted: 0,
      skipped: 0,
    })
  })

  test('importEvents: 全てフィルタされた場合もAPIを呼ばない', async () => {
    const { useEventImport } = await import('./useEventImport')
    const { result } = renderHook(() => useEventImport())

    const events = [
      createMockEvent({ is_all_day: true }),
      createMockEvent({ is_all_day: true }),
    ]

    let importResult: any
    await act(async () => {
      importResult = await result.current.importEvents(events)
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(importResult).toEqual({
      inserted: 0,
      updated: 0,
      softDeleted: 0,
      skipped: 0,
    })
  })
})
