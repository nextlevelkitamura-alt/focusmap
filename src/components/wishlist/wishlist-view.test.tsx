import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WishlistView } from './wishlist-view'
import type { IdealGoalWithItems } from '@/types/database'
import { LINKED_TASK_STATUS_EVENT, TODAY_DURATION_DEFAULT } from '@/lib/calendar-constants'
import { compressImageFileForUpload } from '@/lib/image-compression'
import { invalidateWishlistItemsCache } from '@/lib/wishlist-cache'

const calendarEvents = vi.hoisted(() => ({
  useCalendarEvents: vi.fn(() => ({
    events: [],
    isLoading: false,
    isRefreshing: false,
    error: null,
    syncNow: vi.fn(),
    refetch: vi.fn(),
    setEvents: vi.fn(),
    addOptimisticEvent: vi.fn(),
    removeOptimisticEvent: vi.fn(),
  })),
  broadcastCalendarOptimisticEvent: vi.fn(),
  broadcastCalendarOptimisticEventRemoval: vi.fn(),
  broadcastCalendarSync: vi.fn(),
  invalidateCalendarCache: vi.fn(),
}))

const memoAiTaskMock = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}))

vi.mock('@hello-pangea/dnd', async () => {
  const React = await import('react')
  const noopRef = () => undefined

  return {
    DragDropContext: ({ children }: { children: import('react').ReactNode }) =>
      React.createElement('div', null, children),
    useKeyboardSensor: () => undefined,
    useMouseSensor: () => undefined,
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
    getBySourceId: () => memoAiTaskMock.task,
    refresh: memoAiTaskMock.refresh,
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

vi.mock('@/lib/image-compression', () => ({
  MAX_UPLOAD_IMAGE_BYTES: 300 * 1024,
  compressImageFileForUpload: vi.fn(async (file: File) => file),
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
    onOpenChange,
  }: {
    item: IdealGoalWithItems | null
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => open && item ? (
    <div data-testid="memo-detail">
      <span>{item.title}</span>
      <button type="button" onClick={() => onOpenChange(false)}>閉じる</button>
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

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect
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
    calendarEvents.useCalendarEvents.mockClear()
    calendarEvents.useCalendarEvents.mockReturnValue({
      events: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      syncNow: vi.fn(),
      refetch: vi.fn(),
      setEvents: vi.fn(),
      addOptimisticEvent: vi.fn(),
      removeOptimisticEvent: vi.fn(),
    })
    memoAiTaskMock.task = null
    memoAiTaskMock.refresh.mockClear()
    vi.mocked(compressImageFileForUpload).mockReset()
    vi.mocked(compressImageFileForUpload).mockImplementation(async (file: File) => file)
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
	      expect(screen.getByText('予定済み')).toBeInTheDocument()
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
	    expect(screen.queryByText('予定済み')).not.toBeInTheDocument()
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

    expect(screen.queryByLabelText('カレンダーを閉じる')).not.toBeInTheDocument()
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

    expect(screen.queryByText('マップ追加済み')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    expect(screen.getByText('Mapped memo')).toBeInTheDocument()
    expect(screen.getByText('Unsorted memo')).toBeInTheDocument()
  })

  test('スマホの予定ボタンはメモタブ内カレンダーを開き、ドラッグ終了で保存して一覧に戻る', async () => {
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

    const originalItem = createMemoItem({ title: 'Schedule from memo' })
    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist') return jsonResponse({ items: [originalItem] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      if (url === '/api/wishlist/memo-1/calendar') {
        const body = JSON.parse((init?.body as string | undefined) ?? '{}')
        return jsonResponse({
          google_event_id: 'google-event-1',
          item: createMemoItem({
            ...originalItem,
            scheduled_at: body.scheduled_at,
            duration_minutes: body.duration_minutes,
            google_event_id: 'google-event-1',
            memo_status: 'scheduled',
            is_today: false,
          }),
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView />)

    await screen.findByText('Schedule from memo')
    fireEvent.click(screen.getByRole('button', { name: '予定に入れる' }))

    await screen.findByTestId('memo-inline-scheduler')
    expect(screen.queryByText('この時間に入れる')).not.toBeInTheDocument()
    expect(screen.queryByText('キャンセル')).not.toBeInTheDocument()

    const grid = screen.getByTestId('memo-scheduler-grid')
    const draft = screen.getByTestId('memo-scheduler-draft')
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(rect({ top: 0, bottom: 1536, height: 1536, width: 360, right: 360 }))
    vi.spyOn(draft, 'getBoundingClientRect').mockReturnValue(rect({ top: 640, bottom: 700, height: 60, width: 300, right: 360 }))

    fireEvent.pointerDown(draft, { pointerId: 1, button: 0, clientY: 650 })
    fireEvent.pointerMove(draft, { pointerId: 1, button: 0, clientY: 770 })
    fireEvent.pointerUp(draft, { pointerId: 1, button: 0, clientY: 770 })

    await waitFor(() => {
      expect(screen.queryByTestId('memo-inline-scheduler')).not.toBeInTheDocument()
      const calendarCall = fetchMock.mock.calls.find(([input]) => requestUrl(input) === '/api/wishlist/memo-1/calendar')
      expect(calendarCall).toBeDefined()
      expect(JSON.parse(calendarCall?.[1]?.body as string)).toMatchObject({
        duration_minutes: TODAY_DURATION_DEFAULT,
        calendar_id: 'work-cal',
        title: 'Schedule from memo',
      })
    })
    expect(screen.getByText('Schedule from memo')).toBeInTheDocument()
  })

  test('看板の完了切り替えを紐づくマインドマップノードへ同期する', async () => {
    const originalItem = createMemoItem({
      id: 'memo-linked',
      title: 'Linked memo',
      memo_status: 'organized',
      mindmap_task_ids: ['task-1', 'task-2'],
    } as Partial<IdealGoalWithItems>)
    let serverItem = originalItem
    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/wishlist') && init?.method !== 'PATCH') return jsonResponse({ items: [serverItem] })
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

  test('デスクトップ表示では右パネルの保存でメモを追加する', async () => {
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
      expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'メモにメモを追加' }))

    const descriptionField = await screen.findByPlaceholderText('本文を入力')
    await waitFor(() => {
      expect(descriptionField).toHaveFocus()
    })

    fireEvent.change(descriptionField, {
      target: { value: 'あ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

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

  test('デスクトップ表示ではカード選択を右編集パネルに開き、Codex履歴も同じパネルに収める', async () => {
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
    memoAiTaskMock.task = {
      id: 'ai-task-1',
      executor: 'codex_app',
      status: 'running',
      created_at: '2026-06-11T00:00:00.000Z',
      started_at: '2026-06-11T00:00:00.000Z',
      completed_at: null,
      result: {},
    }

    let serverItem = createMemoItem({
      id: 'memo-existing',
      title: 'Existing memo',
      description: 'Existing body',
      project_id: 'project-1',
      duration_minutes: 15,
    })
    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/wishlist') && init?.method !== 'PATCH') return jsonResponse({ items: [serverItem] })
      if (url === '/api/wishlist/memo-existing' && init?.method === 'PATCH') {
        const body = JSON.parse((init.body as string | undefined) ?? '{}')
        serverItem = createMemoItem({ ...serverItem, ...body })
        return jsonResponse({ item: serverItem })
      }
      if (url === '/api/codex/sync-node') return jsonResponse({ ok: true })
      if (url === '/api/ai-tasks/ai-task-1/activity') {
        return jsonResponse({
          messages: [{
            id: 'message-1',
            task_id: 'ai-task-1',
            user_id: 'user-1',
            role: 'codex',
            kind: 'message',
            body: 'Codex response',
            importance: 'normal',
            metadata: {},
            created_at: '2026-06-11T00:01:00.000Z',
          }],
        })
      }
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WishlistView
        selectedProjectId="project-1"
        projects={[{
          id: 'project-1',
          user_id: 'user-1',
          space_id: 'space-1',
          title: 'Project',
          description: '',
          purpose: null,
          category_tag: null,
          priority: 0,
          status: 'active',
          color_theme: 'blue',
          repo_path: '/repo/focusmap',
          created_at: '2026-05-21T00:00:00.000Z',
        } as never]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Existing memo')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Existing memo'))

    await waitFor(() => {
      expect(screen.getByText('メモを編集')).toBeInTheDocument()
      expect(screen.queryByTestId('memo-detail')).not.toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Existing memo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codexに送る' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Codexチャット/ })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('Existing memo'), {
      target: { value: 'Updated memo' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([input, init]) =>
        requestUrl(input) === '/api/wishlist/memo-existing' && init?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
      const patchBody = JSON.parse(patchCall?.[1]?.body as string)
      expect(patchBody).toMatchObject({
        title: 'Updated memo',
        description: 'Existing body',
        duration_minutes: 15,
      })
    })
  })

  test('デスクトップ右パネルで選んだ画像を保存後に圧縮して添付APIへアップロードする', async () => {
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
      if (url === '/api/wishlist' && init?.method === 'POST') {
        const body = JSON.parse((init.body as string | undefined) ?? '{}')
        return jsonResponse({ item: createMemoItem({ id: 'created-memo', title: body.title, ...body }) }, { status: 201 })
      }
      if (url === '/api/wishlist/created-memo/attachments' && init?.method === 'POST') {
        return jsonResponse({ attachment: { id: 'image-1' } }, { status: 201 })
      }
      if (url === '/api/wishlist') return jsonResponse({ items: [] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<WishlistView selectedProjectId="project-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'メモにメモを追加' }))
    await screen.findByText('メモを追加')
    expect(screen.queryByRole('button', { name: /クリップボードから貼り付け/ })).not.toBeInTheDocument()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const imageFile = new File(['image'], 'memo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [imageFile] } })
    fireEvent.change(screen.getByPlaceholderText('本文を入力'), {
      target: { value: '画像付きメモ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(compressImageFileForUpload).toHaveBeenCalledWith(imageFile)
      expect(fetchMock.mock.calls.some(([input, init]) =>
        requestUrl(input) === '/api/wishlist/created-memo/attachments' && init?.method === 'POST',
      )).toBe(true)
    })
  })

  test('デスクトップ右パネルは文字入力まで保存しない', async () => {
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
      expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'メモにメモを追加' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })
    expect(screen.queryByRole('button', { name: '完了にメモを追加' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input, init]) =>
      requestUrl(input).startsWith('/api/wishlist') && init?.method === 'POST',
    )).toBe(false)
  })

  test('デスクトップ右パネルは閉じられ、メモ列の追加から再表示できる', async () => {
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

    const fetchMock = vi.fn<Window['fetch']>(async input => {
      const url = requestUrl(input)
      if (url.startsWith('/api/wishlist')) return jsonResponse({ items: [] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView selectedProjectId="project-1" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'メモにメモを追加' }))

    const descriptionField = await screen.findByPlaceholderText('本文を入力')
    await waitFor(() => {
      expect(descriptionField).toHaveFocus()
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: '追加パネルを閉じる' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'メモにメモを追加' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })
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
      expect(screen.getByRole('button', { name: '今日0' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'メモ0' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /マップ追加済み/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /予定済み/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '今日0' }))
    fireEvent.change(screen.getByPlaceholderText('話した内容やメモを入力'), {
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

  test('スマホ表示では完了カラムからの追加先をメモに戻す', async () => {
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

    await screen.findByRole('button', { name: '完了0' })
    fireEvent.click(screen.getByRole('button', { name: '完了0' }))
    fireEvent.change(screen.getByPlaceholderText('話した内容やメモを入力'), {
      target: { value: '完了表示から追加' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'メモを追加' }))

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([input, init]) =>
        requestUrl(input) === '/api/wishlist' && init?.method === 'POST',
      )
      expect(createCall).toBeDefined()
      const createBody = JSON.parse(createCall?.[1]?.body as string)
      expect(createBody).toMatchObject({
        title: '完了表示から追加',
        memo_status: 'unsorted',
        is_today: false,
        is_completed: false,
      })
    })
  })

  test('スマホ表示では入力後のキラキラでメモを予定化する', async () => {
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

    const scheduledAt = '2026-06-13T03:00:00.000Z'
    const fetchMock = vi.fn<Window['fetch']>(async (input, init) => {
      const url = requestUrl(input)
      if (url === '/api/ai-ingest') {
        return jsonResponse({
          suggestion: {
            title: '商談内容の整理',
            description: 'AI summary should not replace original',
            scheduled_at: scheduledAt,
            duration_minutes: 60,
            tags: [],
            time_candidates: [{
              label: '指定日時',
              scheduled_at: scheduledAt,
              duration_minutes: 60,
              reason: '入力から日時を抽出',
            }],
            subtask_suggestions: [],
          },
        })
      }
      if (url === '/api/wishlist' && init?.method === 'POST') {
        const body = JSON.parse((init.body as string | undefined) ?? '{}')
        return jsonResponse({
          item: createMemoItem({
            id: 'scheduled-memo',
            title: body.title,
            description: body.description,
            scheduled_at: body.scheduled_at,
            duration_minutes: body.duration_minutes,
            memo_status: body.memo_status,
            is_today: body.is_today,
          }),
        }, { status: 201 })
      }
      if (url === '/api/wishlist/scheduled-memo/calendar') {
        return jsonResponse({
          google_event_id: 'google-event-1',
          item: createMemoItem({
            id: 'scheduled-memo',
            title: '商談内容の整理',
            description: '商談で話した内容を整理したい',
            scheduled_at: scheduledAt,
            duration_minutes: 60,
            google_event_id: 'google-event-1',
            memo_status: 'scheduled',
          }),
        })
      }
      if (url === '/api/wishlist') return jsonResponse({ items: [] })
      if (url === '/api/ai/context') return jsonResponse({ preferences: {} })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WishlistView />)

    await screen.findByPlaceholderText('話した内容やメモを入力')
    fireEvent.change(screen.getByPlaceholderText('話した内容やメモを入力'), {
      target: { value: '商談で話した内容を整理したい' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AIでメモを予約' }))

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([input, init]) =>
        requestUrl(input) === '/api/wishlist' && init?.method === 'POST',
      )
      expect(createCall).toBeDefined()
      expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({
        title: '商談内容の整理',
        description: '商談で話した内容を整理したい',
        scheduled_at: scheduledAt,
        duration_minutes: 60,
        memo_status: 'scheduled',
      })
    })
    expect(fetchMock.mock.calls.some(([input, init]) =>
      requestUrl(input) === '/api/wishlist/scheduled-memo/calendar' && init?.method === 'POST',
    )).toBe(true)
  })
})
