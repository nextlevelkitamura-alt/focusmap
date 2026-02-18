import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskCalendarSync } from './useTaskCalendarSync'

// --- fetch mock ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// --- helpers ---
function mockFetchSuccess(data: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

function mockFetchError(status: number, error: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error }),
  })
}

const baseProps = {
  taskId: 'task-1',
  scheduled_at: null as string | null,
  estimated_time: 0,
  calendar_id: null as string | null,
  google_event_id: null as string | null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTaskCalendarSync', () => {
  // ===========================
  // 初期状態
  // ===========================
  describe('初期状態', () => {
    test('status=idle, error=null, フラグが正しい', () => {
      const props = { ...baseProps }
      const { result } = renderHook(() => useTaskCalendarSync(props))

      expect(result.current.status).toBe('idle')
      expect(result.current.error).toBeNull()
      expect(result.current.isSyncing).toBe(false)
      expect(result.current.isSuccess).toBe(false)
      expect(result.current.isError).toBe(false)
    })
  })

  // ===========================
  // 新規作成 (POST)
  // ===========================
  describe('新規作成 (POST)', () => {
    test('3フィールド揃い + google_event_id なし → POST を送信', async () => {
      mockFetchSuccess({ googleEventId: 'evt-123' })

      const onGoogleEventIdChange = vi.fn()
      const onSyncSuccess = vi.fn()
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        onGoogleEventIdChange,
        onSyncSuccess,
      }

      const { result } = renderHook(() => useTaskCalendarSync(props))

      // useEffect が発火するのを待つ
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/calendar/sync-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 'task-1',
          scheduled_at: '2026-02-18T10:00:00Z',
          estimated_time: 30,
          calendar_id: 'cal-1',
        }),
      })

      expect(result.current.status).toBe('success')
      expect(onGoogleEventIdChange).toHaveBeenCalledWith('evt-123')
      expect(onSyncSuccess).toHaveBeenCalled()
    })

    test('estimated_time が 0 の場合は POST しない', async () => {
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 0,
        calendar_id: 'cal-1',
      }

      renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================
  // 更新 (PATCH)
  // ===========================
  describe('更新 (PATCH)', () => {
    test('フィールド変更 + google_event_id あり → PATCH を送信', async () => {
      // 初回レンダリング（変更なし）
      const initialProps = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        google_event_id: 'evt-123',
      }

      const { rerender } = renderHook(
        (props) => useTaskCalendarSync(props),
        { initialProps }
      )

      // 時間を変更 → PATCH
      mockFetchSuccess({ googleEventId: 'evt-123' })

      const updatedProps = {
        ...initialProps,
        estimated_time: 60,
      }

      await act(async () => {
        rerender(updatedProps)
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/calendar/sync-task', expect.objectContaining({
        method: 'PATCH',
      }))
    })

    test('フィールド変更なし → PATCH を送信しない', async () => {
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        google_event_id: 'evt-123',
      }

      const { rerender } = renderHook(
        (p) => useTaskCalendarSync(p),
        { initialProps: props }
      )

      // 同じ props で再レンダリング
      await act(async () => {
        rerender({ ...props })
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================
  // 削除 (DELETE)
  // ===========================
  describe('削除 (DELETE)', () => {
    test('calendar_id 解除 + google_event_id あり → DELETE を送信', async () => {
      const initialProps = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        google_event_id: 'evt-123',
      }

      const { rerender } = renderHook(
        (props) => useTaskCalendarSync(props),
        { initialProps }
      )

      // calendar_id を null に → DELETE
      mockFetchSuccess()

      await act(async () => {
        rerender({
          ...initialProps,
          calendar_id: null,
        })
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/calendar/sync-task', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({
          taskId: 'task-1',
          google_event_id: 'evt-123',
        }),
      }))
    })
  })

  // ===========================
  // カレンダー変更 (DELETE → POST)
  // ===========================
  describe('カレンダー変更', () => {
    test('calendar_id 変更 → DELETE → POST の2段階処理', async () => {
      const initialProps = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        google_event_id: 'evt-123',
      }

      const { rerender } = renderHook(
        (props) => useTaskCalendarSync(props),
        { initialProps }
      )

      // DELETE成功 → POST成功
      mockFetchSuccess() // DELETE
      mockFetchSuccess({ googleEventId: 'evt-456' }) // POST

      await act(async () => {
        rerender({
          ...initialProps,
          calendar_id: 'cal-2',
        })
        await vi.runAllTimersAsync()
      })

      // DELETE が呼ばれたことを確認
      expect(mockFetch).toHaveBeenCalledWith('/api/calendar/sync-task', expect.objectContaining({
        method: 'DELETE',
      }))

      // POST が呼ばれたことを確認
      expect(mockFetch).toHaveBeenCalledWith('/api/calendar/sync-task', expect.objectContaining({
        method: 'POST',
      }))

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================
  // enabled=false
  // ===========================
  describe('enabled=false', () => {
    test('同期をスキップする', async () => {
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        enabled: false,
      }

      renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ===========================
  // エラー処理
  // ===========================
  describe('エラー処理', () => {
    test('fetch失敗後にリトライし、成功すればstatus=successになる', async () => {
      // 1回目: 失敗 → リトライ → 2回目: 成功（ループ回避）
      mockFetchError(500, 'Server error')
      mockFetchSuccess({ googleEventId: 'evt-retry' })

      const onSyncSuccess = vi.fn()
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        onSyncSuccess,
      }

      const { result } = renderHook(() => useTaskCalendarSync(props))

      // 初回の fetch（失敗）
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      // リトライタイマー（1秒後）を発火
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('success')
      expect(onSyncSuccess).toHaveBeenCalled()
    })

    test('404エラーはリトライせずidleに戻る', async () => {
      mockFetchError(404, 'Not found')

      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
      }

      const { result } = renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      // 404は1回のみ、リトライなし
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('idle')

      // タイマーを進めてもリトライしない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test('maxRetries到達後にonSyncErrorが呼ばれる', async () => {
      // 4回失敗（初回 + 3リトライ）
      mockFetchError(500, 'Server error')
      mockFetchError(500, 'Server error')
      mockFetchError(500, 'Server error')
      mockFetchError(500, 'Server error')

      const onSyncError = vi.fn()
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        onSyncError,
      }

      const { result } = renderHook(() => useTaskCalendarSync(props))

      // 初回失敗
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      // リトライ1 (1秒後)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      // リトライ2 (2秒後)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      // リトライ3 (4秒後)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })

      expect(mockFetch).toHaveBeenCalledTimes(4)
      expect(result.current.isError).toBe(true)
      expect(result.current.error?.message).toBe('Server error')
      expect(onSyncError).toHaveBeenCalled()
    })
  })

  // ===========================
  // retry
  // ===========================
  describe('retry', () => {
    test('retry() で POST を再送信する', async () => {
      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
      }

      // 初回 POST を成功させる
      mockFetchSuccess({ googleEventId: 'evt-123' })

      const { result } = renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // retry() を呼び出す（google_event_id がないので POST）
      mockFetchSuccess({ googleEventId: 'evt-456' })

      await act(async () => {
        result.current.retry()
        await vi.runAllTimersAsync()
      })

      // POST が2回呼ばれる（初回 + retry）
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================
  // コールバック
  // ===========================
  describe('コールバック', () => {
    test('onSyncSuccess が同期成功時に呼ばれる', async () => {
      const onSyncSuccess = vi.fn()
      mockFetchSuccess()

      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        onSyncSuccess,
      }

      renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(onSyncSuccess).toHaveBeenCalledTimes(1)
    })

    test('onGoogleEventIdChange が googleEventId 返却時に呼ばれる', async () => {
      const onGoogleEventIdChange = vi.fn()
      mockFetchSuccess({ googleEventId: 'evt-new' })

      const props = {
        ...baseProps,
        scheduled_at: '2026-02-18T10:00:00Z',
        estimated_time: 30,
        calendar_id: 'cal-1',
        onGoogleEventIdChange,
      }

      renderHook(() => useTaskCalendarSync(props))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(onGoogleEventIdChange).toHaveBeenCalledWith('evt-new')
    })
  })
})
