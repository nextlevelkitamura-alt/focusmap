import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- fetch モック（グローバル） ---
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// --- localStorage モック ---
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

// --- helpers ---
function createCalendar(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cal-1',
    user_id: 'user-1',
    google_calendar_id: 'test@gmail.com',
    name: 'My Calendar',
    description: null,
    location: null,
    timezone: 'Asia/Tokyo',
    color: '#4285f4',
    background_color: '#4285f4',
    selected: true,
    access_level: 'owner',
    is_primary: true,
    google_created_at: null,
    google_updated_at: null,
    synced_at: '2026-02-01T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...overrides,
  }
}

function mockFetchSuccess(calendars: ReturnType<typeof createCalendar>[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ calendars }),
  })
}

function mockFetchError(status = 500, errorMessage = 'Server Error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ error: errorMessage }),
  })
}

function mockFetchPatchSuccess() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({}),
  })
}

// --- useCalendars はモジュールレベルキャッシュを持つため、毎テストで再インポート ---
beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  localStorageMock.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.clearAllTimers()
})

// --- useCalendars を動的にインポートするヘルパー ---
async function importHook() {
  const mod = await import('./useCalendars')
  return mod.useCalendars
}

// ============================================================
// fetchCalendars
// ============================================================
describe('useCalendars - fetchCalendars', () => {
  test('マウント時にカレンダー一覧を取得する', async () => {
    const calendars = [createCalendar({ id: 'cal-1', name: 'Work' })]
    mockFetchSuccess(calendars)

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/calendars')
    expect(result.current.calendars).toHaveLength(1)
    expect(result.current.calendars[0].name).toBe('Work')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  test('APIエラー時は error ステートをセットする', async () => {
    mockFetchError(500, 'Internal Server Error')

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.error).not.toBeNull()
    expect(result.current.error?.message).toBe('Internal Server Error')
    expect(result.current.calendars).toHaveLength(0)
    expect(result.current.isLoading).toBe(false)
  })

  test('fetch 失敗時（ネットワークエラー）は error ステートをセットする', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'))

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.error).not.toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  test('forceSync=true でキャッシュを無視して再取得する', async () => {
    // 1回目: 初回フェッチ（キャッシュ保存）
    const calendars = [createCalendar()]
    mockFetchSuccess(calendars)

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)

    // 2回目: forceSync=true で強制再取得
    const updatedCalendars = [createCalendar({ name: 'Updated' })]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ calendars: updatedCalendars }),
    })

    await act(async () => {
      await result.current.fetchCalendars(true)
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/calendars?forceSync=true')
    expect(result.current.calendars[0].name).toBe('Updated')
  })

  test('成功時に localStorage へカレンダー選択状態を保存する', async () => {
    const calendars = [
      createCalendar({ id: 'cal-1', google_calendar_id: 'a@gmail.com', selected: true }),
      createCalendar({ id: 'cal-2', google_calendar_id: 'b@gmail.com', selected: false }),
    ]
    mockFetchSuccess(calendars)

    const useCalendars = await importHook()
    renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'calendar-selection',
      JSON.stringify({ 'a@gmail.com': true, 'b@gmail.com': false })
    )
  })
})

// ============================================================
// toggleCalendar
// ============================================================
describe('useCalendars - toggleCalendar', () => {
  test('トグル後に PATCH リクエストを送信する', async () => {
    const calendars = [createCalendar({ id: 'cal-1', selected: true })]
    mockFetchSuccess(calendars)
    mockFetchPatchSuccess()

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    await act(async () => {
      await result.current.toggleCalendar('cal-1', false)
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/calendars/cal-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ selected: false }),
      })
    )
  })

  test('楽観的更新: PATCH 完了前に状態が変わる', async () => {
    const calendars = [createCalendar({ id: 'cal-1', selected: true })]
    mockFetchSuccess(calendars)

    // PATCH は遅延で成功させる
    let resolvePatch: () => void
    mockFetch.mockReturnValueOnce(
      new Promise<unknown>(resolve => {
        resolvePatch = () => resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({}),
        })
      })
    )

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // PATCH 開始（非同期、まだ完了していない）
    act(() => {
      result.current.toggleCalendar('cal-1', false)
    })

    // PATCH 完了前に楽観的に selected=false になっている
    expect(result.current.calendars[0].selected).toBe(false)

    // PATCH を完了させる
    await act(async () => {
      resolvePatch!()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  })

  test('APIエラー時にロールバックする', async () => {
    const calendars = [createCalendar({ id: 'cal-1', selected: true })]
    mockFetchSuccess(calendars)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    })

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    await act(async () => {
      try {
        await result.current.toggleCalendar('cal-1', false)
      } catch {
        // expected error
      }
    })

    // ロールバックで selected=true に戻る
    expect(result.current.calendars[0].selected).toBe(true)
    expect(result.current.error).not.toBeNull()
  })
})

// ============================================================
// toggleAll
// ============================================================
describe('useCalendars - toggleAll', () => {
  test('全カレンダーを一括選択する', async () => {
    const calendars = [
      createCalendar({ id: 'cal-1', selected: false }),
      createCalendar({ id: 'cal-2', google_calendar_id: 'b@gmail.com', selected: false }),
    ]
    mockFetchSuccess(calendars)
    // PATCH リクエスト分をモック
    mockFetchPatchSuccess()
    mockFetchPatchSuccess()

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    await act(async () => {
      await result.current.toggleAll(true)
    })

    expect(result.current.calendars.every(c => c.selected)).toBe(true)
  })

  test('全カレンダーを一括解除する', async () => {
    const calendars = [
      createCalendar({ id: 'cal-1', selected: true }),
      createCalendar({ id: 'cal-2', google_calendar_id: 'b@gmail.com', selected: true }),
    ]
    mockFetchSuccess(calendars)
    mockFetchPatchSuccess()
    mockFetchPatchSuccess()

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    await act(async () => {
      await result.current.toggleAll(false)
    })

    expect(result.current.calendars.every(c => !c.selected)).toBe(true)
  })
})

// ============================================================
// selectedCalendarIds
// ============================================================
describe('useCalendars - selectedCalendarIds', () => {
  test('選択済みカレンダーの google_calendar_id を返す', async () => {
    const calendars = [
      createCalendar({ id: 'cal-1', google_calendar_id: 'a@gmail.com', selected: true }),
      createCalendar({ id: 'cal-2', google_calendar_id: 'b@gmail.com', selected: false }),
      createCalendar({ id: 'cal-3', google_calendar_id: 'c@gmail.com', selected: true }),
    ]
    mockFetchSuccess(calendars)

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.selectedCalendarIds).toEqual(['a@gmail.com', 'c@gmail.com'])
  })

  test('カレンダーが未取得の場合は空配列を返す', async () => {
    // fetch を遅延させる（未解決のまま）
    mockFetch.mockReturnValueOnce(new Promise(() => {}))

    const useCalendars = await importHook()
    const { result } = renderHook(() => useCalendars())

    expect(result.current.selectedCalendarIds).toEqual([])
  })
})
