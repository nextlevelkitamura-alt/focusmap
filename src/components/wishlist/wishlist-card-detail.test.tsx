import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { IdealGoalWithItems } from '@/types/database'
import { WishlistCardDetail } from './wishlist-card-detail'
import { useState } from 'react'

vi.mock('@/hooks/useMemoAiTasks', () => ({
  useMemoAiTasks: () => ({
    getBySourceId: () => null,
  }),
}))

vi.mock('@/components/memo/note-claude-runner', () => ({
  NoteClaudeRunnerPanel: () => null,
}))

vi.mock('@/components/memo/memo-refine-chat', () => ({
  MemoRefineChat: () => null,
}))

vi.mock('@/components/memo/memo-chat-history', () => ({
  MemoChatHistory: () => null,
}))

function createMemoItem(overrides: Partial<IdealGoalWithItems> = {}): IdealGoalWithItems {
  return {
    id: 'memo-1',
    user_id: 'user-1',
    title: 'Original title',
    description: 'Original body',
    status: 'memo',
    memo_status: 'unsorted',
    is_completed: false,
    scheduled_at: null,
    duration_minutes: null,
    google_event_id: null,
    calendar_id: null,
    project_id: null,
    category: null,
    tags: [],
    ai_summary: null,
    time_candidates: null,
    subtask_suggestions: null,
    created_at: '2026-05-21T00:00:00.000Z',
    updated_at: '2026-05-21T00:00:00.000Z',
    ideal_items: [],
    ...overrides,
  } as IdealGoalWithItems
}

function DetailHarness() {
  const [item, setItem] = useState<IdealGoalWithItems>(createMemoItem())

  return (
    <WishlistCardDetail
      item={item}
      open
      onOpenChange={vi.fn()}
      onUpdate={async (_id, updates) => {
        setItem(prev => ({
          ...prev,
          ...updates,
          updated_at: '2026-05-21T00:01:00.000Z',
        }) as IdealGoalWithItems)
      }}
      onCalendarAdd={vi.fn()}
      tagOptions={['仕事', 'アイデア']}
    />
  )
}

describe('WishlistCardDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ attachments: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
  })

  test('タグ変更で入力中の見出しと本文を消さない', async () => {
    render(<DetailHarness />)

    const titleInput = await screen.findByDisplayValue('Original title')
    const bodyInput = screen.getByPlaceholderText('本文にGoogle DocsなどのURLを貼ると、そのままリンクとして開けます。')

    fireEvent.change(titleInput, { target: { value: 'Draft title' } })
    fireEvent.change(bodyInput, { target: { value: 'Draft body' } })
    fireEvent.click(screen.getByRole('button', { name: /タグ/ }))
    fireEvent.click(screen.getByRole('button', { name: '仕事' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Draft title')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Draft body')).toBeInTheDocument()
    })
  })

  test('画像エリアでフォルダー選択・ドラッグ&ドロップ・クリップボード貼り付け導線を表示する', async () => {
    render(<DetailHarness />)

    fireEvent.click(await screen.findByRole('button', { name: /画像/ }))

    expect(screen.getByText('画像を追加')).toBeInTheDocument()
    expect(screen.getByText('クリックしてフォルダーから選択、またはドラッグ&ドロップ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /クリップボード画像を貼り付け/ })).toBeInTheDocument()
  })

  test('画像をドロップすると添付APIへアップロードする', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-1',
            file_name: 'memo.png',
            file_url: 'https://example.com/memo.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    fireEvent.click(await screen.findByRole('button', { name: /画像/ }))

    const dropZone = screen.getByText('画像を追加').closest('button')
    expect(dropZone).toBeTruthy()
    fireEvent.drop(dropZone!, {
      dataTransfer: {
        files: [new File(['data'], 'memo.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByAltText('memo.png')).toBeInTheDocument()
  })

  test('クリップボード画像を貼り付けると添付APIへアップロードする', async () => {
    const clipboardRead = vi.fn(async () => [{
      types: ['image/png'],
      getType: vi.fn(async () => new Blob(['data'], { type: 'image/png' })),
    }])
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: clipboardRead },
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-clipboard',
            file_name: 'clipboard.png',
            file_url: 'https://example.com/clipboard.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    fireEvent.click(await screen.findByRole('button', { name: /画像/ }))
    fireEvent.click(screen.getByRole('button', { name: /クリップボード画像を貼り付け/ }))

    await waitFor(() => {
      expect(clipboardRead).toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByAltText('clipboard.png')).toBeInTheDocument()
  })

  test('画像タブ内でCmd+Vするとクリップボード画像をアップロードする', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          attachment: {
            id: 'image-paste-event',
            file_name: 'pasted-event.png',
            file_url: 'https://example.com/pasted-event.png',
            file_type: 'image/png',
            file_size: 4,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DetailHarness />)
    fireEvent.click(await screen.findByRole('button', { name: /画像/ }))
    fireEvent.paste(screen.getByTestId('memo-image-paste-target'), {
      clipboardData: {
        files: [new File(['data'], 'pasted-event.png', { type: 'image/png' })],
        items: [],
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wishlist/memo-1/attachments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByAltText('pasted-event.png')).toBeInTheDocument()
  })
})
