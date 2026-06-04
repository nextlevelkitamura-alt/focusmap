import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WishlistView } from './wishlist-view'
import type { IdealGoalWithItems } from '@/types/database'
import { LINKED_TASK_STATUS_EVENT, TODAY_DURATION_DEFAULT } from '@/lib/calendar-constants'
import { invalidateWishlistItemsCache } from '@/lib/wishlist-cache'

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
  WishlistCardDetail: ({
    item,
    open,
    isPersisting,
  }: {
    item: IdealGoalWithItems | null
    open: boolean
    isPersisting?: boolean
  }) => open && item ? (
    <div data-testid="memo-detail">
      <span>{item.title}</span>
      {isPersisting && <span>作成中</span>}
    </div>
  ) : null,
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

async function renderVisibleWishlist(expectedText = 'Drop memo') {
  render(
    <WishlistView
      isCalendarSplitVisible
      onToggleCalendarSplit={vi.fn()}
    />,
  )

  await waitFor(() => {
    expect(screen.getByText(expectedText)).toBeInTheDocument()
    expect(window.__focusmapMemoDropHandler).toEqual(expect.any(Function))
  })

  await act(async () => {
    await Promise.resolve()
  })
}

describe('WishlistView calendar D&D', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    invalidateWishlistItemsCache()
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
	      expect(screen.getAllByText('予定済み').length).toBeGreaterThanOrEqual(2)
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
	    expect(screen.getAllByText('予定済み')).toHaveLength(1)
    expect(calendarEvents.broadcastCalendarOptimisticEventRemoval).toHaveBeenCalled()
  })

  test('カレンダー表示中は未予定と今日するだけをカレンダーD&D対象にする', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() + 1)
    scheduled.setHours(11, 0, 0, 0)
    const wishlistItems = [
      createMemoItem({ id: 'memo-unsorted', title: 'Unsorted memo' }),
      createMemoItem({ id: 'memo-today', title: 'Today memo', is_today: true }),
      createMemoItem({
        id: 'memo-scheduled',
        title: 'Scheduled memo',
        scheduled_at: scheduled.toISOString(),
        memo_status: 'scheduled',
        google_event_id: 'google-event-1',
      }),
      createMemoItem({
        id: 'memo-completed',
        title: 'Completed memo',
        is_completed: true,
        memo_status: 'completed',
      }),
    ]
    vi.stubGlobal('fetch', vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') return jsonResponse({ items: wishlistItems })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    }))

    await renderVisibleWishlist('Unsorted memo')

    expect(screen.getByLabelText('カレンダーを閉じる')).toHaveTextContent('')
    expect(screen.queryByLabelText('タグメニューを開く')).not.toBeInTheDocument()
    expect(screen.queryByTitle('複数メモをマインドマップに整理')).not.toBeInTheDocument()
    expect(screen.getByText('Unsorted memo').closest('div[draggable="true"]')).toBeTruthy()
    expect(screen.getByText('Today memo').closest('div[draggable="true"]')).toBeTruthy()
    expect(screen.getByText('Scheduled memo').closest('div[draggable="true"]')).toBeNull()
    expect(screen.getByText('Completed memo').closest('div[draggable="true"]')).toBeNull()
  })

  test('マインドマップ連携済みメモをマップ追加済みカラムに表示する', async () => {
    const wishlistItems = [
      createMemoItem({
        id: 'memo-mapped',
        title: 'Mapped memo',
        memo_status: 'organized',
        ai_source_payload: {
          mindmap_links: [
            {
              task_id: 'task-1',
              linked_at: '2026-05-20T00:00:00.000Z',
            },
          ],
        },
      }),
      createMemoItem({ id: 'memo-unsorted', title: 'Unsorted memo' }),
    ]
    vi.stubGlobal('fetch', vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') return jsonResponse({ items: wishlistItems })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    }))

    await renderVisibleWishlist('Mapped memo')

    expect(screen.getByText('マップ追加済み')).toBeInTheDocument()
    expect(screen.getByText('Mapped memo')).toBeInTheDocument()
    expect(screen.getByText('Unsorted memo')).toBeInTheDocument()
  })

  test('看板の完了切り替えを紐づくマインドマップノードへ同期する', async () => {
    const originalItem = createMemoItem({
      id: 'memo-linked',
      title: 'Linked memo',
      memo_status: 'organized',
      mindmap_task_ids: ['task-1', 'task-2'],
    } as Partial<IdealGoalWithItems>)
    let serverItem = originalItem
    const fetchMock = vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') return jsonResponse({ items: [serverItem] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      if (url === '/api/wishlist/memo-linked') {
        const [, init] = fetchMock.mock.calls.at(-1) ?? []
        const updates = JSON.parse((init?.body as string | undefined) ?? '{}')
        serverItem = createMemoItem({ ...serverItem, ...updates })
        return jsonResponse({ item: serverItem })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    const onLinkedTaskStatusChange = vi.fn(async () => undefined)

    render(
      <WishlistView
        onLinkedTaskStatusChange={onLinkedTaskStatusChange}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Linked memo')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('完了にする'))

    await waitFor(() => {
      expect(onLinkedTaskStatusChange).toHaveBeenCalledWith('task-1', 'done')
      expect(onLinkedTaskStatusChange).toHaveBeenCalledWith('task-2', 'done')
    })

    fireEvent.click(screen.getByTitle('完了済み'))

    await waitFor(() => {
      expect(onLinkedTaskStatusChange).toHaveBeenCalledWith('task-1', 'todo')
      expect(onLinkedTaskStatusChange).toHaveBeenCalledWith('task-2', 'todo')
    })
  })

  test('マインドマップノードの完了切り替えを関連メモのチェックへ即時反映する', async () => {
    const serverItem = createMemoItem({
      id: 'memo-linked',
      title: 'Linked memo',
      memo_status: 'organized',
      is_completed: false,
      mindmap_task_ids: ['task-1'],
    } as Partial<IdealGoalWithItems>)
    const fetchMock = vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') return jsonResponse({ items: [serverItem] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView />)

    await waitFor(() => {
      expect(screen.getByText('Linked memo')).toBeInTheDocument()
      expect(screen.getByTitle('完了にする')).toBeInTheDocument()
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(LINKED_TASK_STATUS_EVENT, {
        detail: { taskId: 'task-1', status: 'done' },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTitle('完了済み')).toBeInTheDocument()
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(LINKED_TASK_STATUS_EVENT, {
        detail: { taskId: 'task-1', status: 'todo' },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTitle('完了にする')).toBeInTheDocument()
    })
  })

  test('デスクトップ表示では入力ありの追加ボタンでメモを即時追加する', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/wishlist') && init?.method === 'POST') {
        const body = JSON.parse((init.body as string | undefined) ?? '{}')
        return jsonResponse({ item: createMemoItem({ id: 'created-memo', title: body.title, ...body }) }, { status: 201 })
      }
      if (url.startsWith('/api/wishlist')) return jsonResponse({ items: [] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView selectedProjectId="project-1" />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /追加/ })[0]).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('音声またはテキストで入力'), {
      target: { value: 'あ' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /追加/ })[0])

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([input, init]) =>
        requestUrl(input).startsWith('/api/wishlist') && init?.method === 'POST',
      )
      expect(createCall).toBeDefined()
      const createBody = JSON.parse(createCall?.[1]?.body as string)
      expect(createBody).toMatchObject({
        title: 'あ',
        project_id: 'project-1',
        memo_status: 'unsorted',
      })
      expect(createBody).not.toHaveProperty('display_order')
    })
  })

  test('入力なしの追加ボタンはAPI完了前に新規メモ編集を開く', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    const fetchMock = vi.fn<Window['fetch']>((async (input, init) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/wishlist') && init?.method === 'POST') {
        return new Promise<Response>(() => undefined)
      }
      if (url.startsWith('/api/wishlist')) return Promise.resolve(jsonResponse({ items: [] }))
      if (url === '/api/ai/context') return Promise.resolve(jsonResponse({ preferences: {} }))
      return Promise.resolve(jsonResponse({}))
    }) as Window['fetch'])
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView selectedProjectId="project-1" />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /追加/ })[0]).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: /追加/ })[0])

    await waitFor(() => {
      expect(screen.getByTestId('memo-detail')).toHaveTextContent('新しいメモ')
      expect(screen.getByTestId('memo-detail')).toHaveTextContent('作成中')
    })
    expect(fetchMock.mock.calls.some(([input, init]) =>
      requestUrl(input).startsWith('/api/wishlist') && init?.method === 'POST',
    )).toBe(true)
    const createCall = fetchMock.mock.calls.find(([input, init]) =>
      requestUrl(input).startsWith('/api/wishlist') && init?.method === 'POST',
    )
    expect(JSON.parse(createCall?.[1]?.body as string)).not.toHaveProperty('display_order')
  })

  test('スマホ表示では選択中カラムに合わせて追加メモの保存先を変える', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist' && init?.method === 'POST') {
        const body = JSON.parse((init.body as string | undefined) ?? '{}')
        return jsonResponse({ item: createMemoItem({ id: 'created-memo', title: body.title, ...body }) }, { status: 201 })
      }
      if (url === '/api/wishlist') return jsonResponse({ items: [] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '今日する0' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '今日する0' }))
    fireEvent.change(screen.getByPlaceholderText('音声またはテキストで入力'), {
      target: { value: '新しいメモ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'メモを追加' }))

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([input, init]) =>
        requestUrl(input) === '/api/wishlist' && init?.method === 'POST',
      )
      expect(createCall).toBeDefined()
      const createBody = JSON.parse(createCall?.[1]?.body as string)
      expect(createBody).toMatchObject({
        title: '新しいメモ',
        memo_status: 'unsorted',
        is_today: true,
        is_completed: false,
      })
      expect(createBody).not.toHaveProperty('display_order')
    })
  })
})
