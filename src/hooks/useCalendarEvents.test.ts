import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { CalendarEvent } from '@/types/calendar'

// --- モジュールレベル状態をリセットするため、毎テストで再インポート ---
// vi.resetModules() + dynamic import で cache / inflightRequests / quota 状態をクリア

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// helpers
function createMockEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 6)}`,
    user_id: 'user-1',
    google_event_id: 'gevt-1',
    calendar_id: 'cal-1',
    title: 'Test Event',
    start_time: '2026-02-18T10:00:00Z',
    end_time: '2026-02-18T11:00:00Z',
    is_all_day: false,
    timezone: 'Asia/Tokyo',
    ...overrides,
  }
}

function mockFetchSuccess(events: CalendarEvent[] = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve({ events }),
  })
}

function mockFetchError(status: number, message: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve({ error: { message } }),
  })
}

const baseOptions = {
  timeMin: new Date('2026-02-17T00:00:00Z'),
  timeMax: new Date('2026-02-24T00:00:00Z'),
}

beforeEach(async () => {
  vi.clearAllMocks()
  // mockResolvedValueOnce のキューもリセット（clearAllMocks ではキューが残る）
  mockFetch.mockReset()
  vi.useFakeTimers()
  // モジュールレベルの cache / quota 状態をリセット
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCalendarEvents', () => {
  // 毎テストで fresh な useCalendarEvents を取得
  async function getHook() {
    const mod = await import('./useCalendarEvents')
    return mod.useCalendarEvents
  }

  // ===========================
  // 初期状態
  // ===========================
  describe('初期状態', () => {
    test('フェッチ完了後にisLoading=falseになる', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([])

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.events).toEqual([])
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })
  })

  // ===========================
  // fetchEvents (初回取得)
  // ===========================
  describe('fetchEvents', () => {
    test('マウント時に自動的にイベントを取得する', async () => {
      const useCalendarEvents = await getHook()
      const events = [createMockEvent({ title: 'Meeting' })]
      mockFetchSuccess(events)

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/calendar/events/list?')
      )
      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].title).toBe('Meeting')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.lastSyncedAt).not.toBeNull()
    })

    test('APIエラー時にerrorがセットされる', async () => {
      const useCalendarEvents = await getHook()
      mockFetchError(500, 'Internal Server Error')

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.error).not.toBeNull()
      expect(result.current.events).toEqual([])
      expect(result.current.isLoading).toBe(false)
    })

    test('calendarIds を指定してフェッチする', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([createMockEvent()])

      const options = {
        ...baseOptions,
        calendarIds: ['cal-1', 'cal-2'],
      }

      renderHook(() => useCalendarEvents(options))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('calendarId=cal-1%2Ccal-2')
    })
  })

  // ===========================
  // syncNow (手動同期)
  // ===========================
  describe('syncNow', () => {
    test('forceSync=true でキャッシュを無視して再取得する', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([createMockEvent({ title: 'First' })])

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      // 初回取得
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.events[0].title).toBe('First')

      // 手動同期
      mockFetchSuccess([createMockEvent({ title: 'Refreshed' })])

      await act(async () => {
        await result.current.syncNow()
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const secondUrl = mockFetch.mock.calls[1][0] as string
      expect(secondUrl).toContain('forceSync=true')
      expect(result.current.events[0].title).toBe('Refreshed')
    })
  })

  // ===========================
  // キャッシュ
  // ===========================
  describe('キャッシュ', () => {
    test('キャッシュ有効期間中は再フェッチしない', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([createMockEvent()])

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      // 初回取得
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)

      // refetch（キャッシュヒット）
      await act(async () => {
        await result.current.refetch(false)
      })

      // キャッシュから返されるのでfetchは増えない
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================
  // 503 リトライ
  // ===========================
  describe('503リトライ', () => {
    test('503レスポンス後にリトライする', async () => {
      const useCalendarEvents = await getHook()
      const events = [createMockEvent({ title: 'After Retry' })]

      // 1回目: 503
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      })

      // 2回目: 成功
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ events }),
      })

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].title).toBe('After Retry')
    })
  })

  // ===========================
  // Quota エラー + バックオフ
  // ===========================
  describe('Quotaエラー', () => {
    test('Quotaエラー時にバックオフ期間が設定される', async () => {
      const useCalendarEvents = await getHook()

      mockFetchError(429, 'Quota exceeded')

      const { result } = renderHook(() => useCalendarEvents(baseOptions))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.error?.message).toContain('Quota exceeded')

      // バックオフ期間中に再度リクエスト → エラー
      mockFetchSuccess([])

      await act(async () => {
        await result.current.refetch(true)
      })

      expect(result.current.error?.message).toContain('API quota exceeded')
    })
  })

  // ===========================
  // autoSync
  // ===========================
  describe('autoSync', () => {
    test('autoSync=true でインターバル同期する', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([])

      const options = {
        ...baseOptions,
        autoSync: true,
        syncInterval: 5000, // 5秒
      }

      renderHook(() => useCalendarEvents(options))

      // 初回取得 — setInterval が設定されているため runAllTimersAsync は使えない
      // （setInterval は永続的にタイマーを生成し、runAllTimersAsync が無限ループする）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)

      // 5秒後の自動同期（キャッシュヒットするのでfetchは増えない）
      // キャッシュTTL(5分)以内なのでfetchは増えない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      // autoSync ではキャッシュが有効な間はfetchしない（forceSync=false）
      expect(mockFetch).toHaveBeenCalledTimes(1) // キャッシュヒット
    })

    test('autoSync=false ではインターバル同期しない', async () => {
      const useCalendarEvents = await getHook()
      mockFetchSuccess([])

      const options = {
        ...baseOptions,
        autoSync: false,
      }

      renderHook(() => useCalendarEvents(options))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      const initialCallCount = mockFetch.mock.calls.length

      // 10分待っても追加コールなし
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600000)
      })

      expect(mockFetch).toHaveBeenCalledTimes(initialCallCount)
    })
  })

  // ===========================
  // calendarIds 変更検知
  // ===========================
  describe('calendarIds 変更検知', () => {
    test('calendarIds が変更されたら再取得する', async () => {
      const useCalendarEvents = await getHook()

      mockFetchSuccess([createMockEvent({ title: 'Cal1 Event' })])

      const initialProps = {
        ...baseOptions,
        calendarIds: ['cal-1'],
      }

      const { result, rerender } = renderHook(
        (props) => useCalendarEvents(props),
        { initialProps }
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.events[0].title).toBe('Cal1 Event')

      // calendarIds を変更
      mockFetchSuccess([createMockEvent({ title: 'Cal2 Event' })])

      await act(async () => {
        rerender({
          ...baseOptions,
          calendarIds: ['cal-2'],
        })
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.events[0].title).toBe('Cal2 Event')
    })
  })
})
