import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WishlistView } from './wishlist-view'
import type { IdealGoalWithItems } from '@/types/database'
import { TODAY_DURATION_DEFAULT } from '@/lib/calendar-constants'

const calendarEvents = vi.hoisted(() => ({
  broadcastCalendarOptimisticEvent: vi.fn(),
  broadcastCalendarOptimisticEventRemoval: vi.fn(),
  broadcastCalendarSync: vi.fn(),
  invalidateCalendarCache: vi.fn(),
}))

vi.mock('@hello-pangea/dnd', async () => {
  const React = await import('react')
  const noopRef = () => undefined

  return {
    DragDropContext: ({ children }: { children: import('react').ReactNode }) =>
      React.createElement('div', null, children),
    Droppable: ({
      children,
    }: {
      children: (
        provided: {
          innerRef: (node: HTMLElement | null) => void
          droppableProps: Record<string, never>
          placeholder: null
        },
        snapshot: { isDraggingOver: boolean },
      ) => import('react').ReactNode
    }) =>
      React.createElement(
        'div',
        null,
        children(
          { innerRef: noopRef, droppableProps: {}, placeholder: null },
          { isDraggingOver: false },
        ),
      ),
    Draggable: ({
      children,
    }: {
      children: (
        provided: {
          innerRef: (node: HTMLElement | null) => void
          draggableProps: Record<string, never>
          dragHandleProps: Record<string, never>
        },
        snapshot: { isDragging: boolean },
      ) => import('react').ReactNode
    }) =>
      React.createElement(
        'div',
        null,
        children(
          { innerRef: noopRef, draggableProps: {}, dragHandleProps: {} },
          { isDragging: false },
        ),
      ),
  }
})

vi.mock('@/hooks/useTagColors', () => ({
  useTagColors: () => ({
    tags: [],
    tagColors: {},
    refreshTags: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCalendars', () => ({
  useCalendars: () => ({
    calendars: [
      {
        google_calendar_id: 'work-cal',
        selected: true,
        is_primary: true,
        access_level: 'owner',
      },
    ],
  }),
}))

vi.mock('@/hooks/useMemoAiTasks', () => ({
  useMemoAiTasks: () => ({
    getBySourceId: () => null,
  }),
}))

vi.mock('@/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    isRecording: false,
    isTranscribing: false,
    error: null,
    permissionState: null,
    analyserRef: { current: null },
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCalendarEvents', () => ({
  ...calendarEvents,
  CALENDAR_EVENT_TIME_UPDATE_EVENT: 'focusmap-calendar-event-time-update',
}))

vi.mock('@/components/memo/note-claude-runner', () => ({
  NoteClaudeRunnerButton: () => null,
  NoteClaudeRunnerPanel: () => null,
}))

vi.mock('./wishlist-card-detail', () => ({
  WishlistCardDetail: () => null,
}))

function createMemoItem(overrides: Partial<IdealGoalWithItems> = {}): IdealGoalWithItems {
  return {
    id: 'memo-1',
    user_id: 'user-1',
    title: 'Drop memo',
    description: 'Drop description',
    status: 'memo',
    memo_status: 'unsorted',
    is_completed: false,
    scheduled_at: null,
    duration_minutes: null,
    google_event_id: null,
    project_id: null,
    category: null,
    tags: [],
    ai_summary: null,
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ideal_items: [],
    ...overrides,
  } as IdealGoalWithItems
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function renderVisibleWishlist() {
  render(
    <WishlistView
      isCalendarSplitVisible
      onToggleCalendarSplit={vi.fn()}
    />,
  )

  await waitFor(() => {
    expect(screen.getByText('Drop memo')).toBeInTheDocument()
    expect(window.__focusmapMemoDropHandler).toEqual(expect.any(Function))
  })

  await act(async () => {
    await Promise.resolve()
  })
}

describe('WishlistView calendar D&D', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.__focusmapMemoDropHandler = undefined
    window.__focusmapMemoDrag = null
    calendarEvents.broadcastCalendarOptimisticEvent.mockClear()
    calendarEvents.broadcastCalendarOptimisticEventRemoval.mockClear()
    calendarEvents.broadcastCalendarSync.mockClear()
    calendarEvents.invalidateCalendarCache.mockClear()
  })

  test('ドロップ成功時にカレンダーAPIへ保存し、メモを予定済みに更新する', async () => {
    const startTime = new Date('2026-05-20T01:30:00.000Z')
    const originalItem = createMemoItem()
    const updatedItem = createMemoItem({
      scheduled_at: startTime.toISOString(),
      duration_minutes: 45,
      google_event_id: 'google-event-1',
      memo_status: 'scheduled',
      is_today: false,
    })
    let wishlistItems = [originalItem]
    const fetchMock = vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') {
        return jsonResponse({ items: wishlistItems })
      }
      if (url === '/api/ai/context') {
        return jsonResponse({ preferences: {} })
      }
      if (url === '/api/wishlist/memo-1/calendar') {
        wishlistItems = [updatedItem]
        return jsonResponse({ google_event_id: 'google-event-1', item: updatedItem })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderVisibleWishlist()

    await act(async () => {
      await window.__focusmapMemoDropHandler?.('memo-1', startTime, 45)
    })

    const calendarCall = fetchMock.mock.calls.find(([input]) => requestUrl(input) === '/api/wishlist/memo-1/calendar')
    expect(calendarCall).toBeDefined()
    expect(calendarCall?.[1]?.method).toBe('POST')
    expect(JSON.parse(calendarCall?.[1]?.body as string)).toMatchObject({
      scheduled_at: startTime.toISOString(),
      duration_minutes: 45,
      title: 'Drop memo',
      description: 'Drop description',
      calendar_id: 'work-cal',
    })
    await waitFor(() => {
      expect(screen.getAllByText('予定済み').length).toBeGreaterThan(2)
    })
    expect(calendarEvents.invalidateCalendarCache).toHaveBeenCalled()
  })

  test('ドロップ失敗時は楽観更新を戻し、エラーを表示する', async () => {
    const startTime = new Date('2026-05-20T02:00:00.000Z')
    const originalItem = createMemoItem({ duration_minutes: null })
    const fetchMock = vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') {
        return jsonResponse({ items: [originalItem] })
      }
      if (url === '/api/ai/context') {
        return jsonResponse({ preferences: {} })
      }
      if (url === '/api/wishlist/memo-1/calendar') {
        return jsonResponse({ error: 'Google Calendar error' }, { status: 500 })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderVisibleWishlist()

    await act(async () => {
      await window.__focusmapMemoDropHandler?.('memo-1', startTime, 0)
    })

    const calendarCall = fetchMock.mock.calls.find(([input]) => requestUrl(input) === '/api/wishlist/memo-1/calendar')
    expect(JSON.parse(calendarCall?.[1]?.body as string)).toMatchObject({
      scheduled_at: startTime.toISOString(),
      duration_minutes: TODAY_DURATION_DEFAULT,
    })
    await waitFor(() => {
      expect(screen.getByText('カレンダー登録に失敗しました: Google Calendar error')).toBeInTheDocument()
    })
    expect(screen.getAllByText('予定済み')).toHaveLength(2)
    expect(calendarEvents.broadcastCalendarOptimisticEventRemoval).toHaveBeenCalled()
  })
})
