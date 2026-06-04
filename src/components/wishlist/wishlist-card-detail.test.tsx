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
})
