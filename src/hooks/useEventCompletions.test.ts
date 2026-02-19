import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEventCompletions } from './useEventCompletions'

// --- fetch モック ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// --- helpers ---
const TODAY = '2026-02-19'

function createCompletion(googleEventId: string, calendarId = 'cal-1') {
  return {
    id: `comp-${googleEventId}`,
    user_id: 'user-1',
    google_event_id: googleEventId,
    calendar_id: calendarId,
    completed_date: TODAY,
    created_at: `${TODAY}T00:00:00Z`,
  }
}

function mockFetchSuccess(completions: ReturnType<typeof createCompletion>[] = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true, completions }),
  })
}

function mockMutationSuccess() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  })
}

function mockMutationError(message = 'Error') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: false, error: message }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  // Date のみフェイク（2026-02-19 固定）
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// 初回フェッチ
// ============================================================
describe('useEventCompletions - 初回フェッチ', () => {
  test('マウント時に今日の完了イベントを取得する', async () => {
    const completions = [createCompletion('evt-1'), createCompletion('evt-2')]
    mockFetchSuccess(completions)

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/event-completions?date=${TODAY}`
    )
    expect(result.current.isLoading).toBe(false)
    expect(result.current.completedEventIds.size).toBe(2)
    expect(result.current.completedEventIds.has('evt-1')).toBe(true)
    expect(result.current.completedEventIds.has('evt-2')).toBe(true)
  })

  test('APIエラー時はローディングが完了し空の Set を返す', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'))

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.completedEventIds.size).toBe(0)
  })

  test('success: false のレスポンスは空の Set を返す', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false }),
    })

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.completedEventIds.size).toBe(0)
  })

  test('初期状態は isLoading: true & completedEventIds が空', () => {
    // fetch を未解決のままにする
    mockFetch.mockReturnValueOnce(new Promise(() => {}))

    const { result } = renderHook(() => useEventCompletions())

    // マウント直後（非同期フェッチ前）
    expect(result.current.isLoading).toBe(true)
    expect(result.current.completedEventIds.size).toBe(0)
  })
})

// ============================================================
// toggleEventCompletion: 未完了 → 完了
// ============================================================
describe('useEventCompletions - toggleEventCompletion (add)', () => {
  test('未完了イベントをトグルすると completedEventIds に追加される', async () => {
    mockFetchSuccess([]) // 初回は空
    mockMutationSuccess() // POST 成功

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.completedEventIds.has('evt-new')).toBe(false)

    act(() => {
      result.current.toggleEventCompletion('evt-new', 'cal-1')
    })

    // 楽観的更新で即座に追加される
    expect(result.current.completedEventIds.has('evt-new')).toBe(true)
  })

  test('POST リクエストが正しいボディで送信される', async () => {
    mockFetchSuccess([])
    mockMutationSuccess()

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    act(() => {
      result.current.toggleEventCompletion('evt-abc', 'cal-work')
    })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/event-completions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          google_event_id: 'evt-abc',
          calendar_id: 'cal-work',
          completed_date: TODAY,
        }),
      })
    )
  })

  test('POST 失敗時はロールバック（refetch）される', async () => {
    mockFetchSuccess([]) // 初回: 空
    mockMutationError('Post failed') // POST 失敗
    mockFetchSuccess([]) // ロールバック用 refetch

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    act(() => {
      result.current.toggleEventCompletion('evt-fail', 'cal-1')
    })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // ロールバック用の refetch が呼ばれる
    expect(mockFetch).toHaveBeenCalledTimes(3) // 初回 + POST + refetch
    expect(result.current.completedEventIds.has('evt-fail')).toBe(false)
  })
})

// ============================================================
// toggleEventCompletion: 完了 → 未完了
// ============================================================
describe('useEventCompletions - toggleEventCompletion (remove)', () => {
  test('完了済みイベントをトグルすると completedEventIds から削除される', async () => {
    const completions = [createCompletion('evt-done')]
    mockFetchSuccess(completions) // 初回: 完了済み
    mockMutationSuccess() // DELETE 成功

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.completedEventIds.has('evt-done')).toBe(true)

    act(() => {
      result.current.toggleEventCompletion('evt-done', 'cal-1')
    })

    // 楽観的更新で即座に削除
    expect(result.current.completedEventIds.has('evt-done')).toBe(false)
  })

  test('DELETE リクエストが正しいボディで送信される', async () => {
    const completions = [createCompletion('evt-done')]
    mockFetchSuccess(completions)
    mockMutationSuccess()

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    act(() => {
      result.current.toggleEventCompletion('evt-done', 'cal-1')
    })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/event-completions',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({
          google_event_id: 'evt-done',
          completed_date: TODAY,
        }),
      })
    )
  })

  test('DELETE 失敗時はロールバック（refetch）される', async () => {
    const completions = [createCompletion('evt-done')]
    mockFetchSuccess(completions)
    mockMutationError('Delete failed')
    // ロールバック refetch: 元の completion を返す
    mockFetchSuccess(completions)

    const { result } = renderHook(() => useEventCompletions())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    act(() => {
      result.current.toggleEventCompletion('evt-done', 'cal-1')
    })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // refetch が呼ばれ、evt-done が復活する
    expect(mockFetch).toHaveBeenCalledTimes(3) // 初回 + DELETE + refetch
    expect(result.current.completedEventIds.has('evt-done')).toBe(true)
  })
})
