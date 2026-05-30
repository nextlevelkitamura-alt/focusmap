import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TodayMemoBoard } from './today-memo-board'
import { invalidateWishlistItemsCache } from '@/lib/wishlist-cache'
import type { IdealGoalWithItems, Project } from '@/types/database'

vi.mock('@/hooks/useCalendars', () => ({
  useCalendars: () => ({
    calendars: [
      {
        id: 'calendar-1',
        google_calendar_id: 'work-cal',
        name: 'Work',
        selected: true,
        is_primary: true,
        access_level: 'owner',
      },
    ],
  }),
}))

vi.mock('@/hooks/useCalendarEvents', () => ({
  broadcastCalendarSync: vi.fn(),
  broadcastEventCompletion: vi.fn(),
  broadcastCalendarOptimisticEvent: vi.fn(),
  broadcastCalendarOptimisticEventRemoval: vi.fn(),
  invalidateCalendarCache: vi.fn(),
}))

vi.mock('@/components/wishlist/wishlist-card', () => ({
  WishlistCard: ({ item }: { item: IdealGoalWithItems }) => (
    <article>{item.title}</article>
  ),
}))

function createMemoItem(overrides: Partial<IdealGoalWithItems> = {}): IdealGoalWithItems {
  return {
    id: 'memo-1',
    user_id: 'user-1',
    title: 'Project memo',
    description: 'Project memo description',
    status: 'memo',
    memo_status: 'unsorted',
    is_completed: false,
    scheduled_at: null,
    duration_minutes: null,
    google_event_id: null,
    project_id: 'project-1',
    category: null,
    tags: [],
    ai_summary: null,
    created_at: '2026-05-30T00:00:00.000Z',
    updated_at: '2026-05-30T00:00:00.000Z',
    ideal_items: [],
    ...overrides,
  } as IdealGoalWithItems
}

const projects = [
  {
    id: 'project-1',
    title: 'SNS運用',
    user_id: 'user-1',
    space_id: 'space-1',
    status: 'active',
    created_at: '2026-05-30T00:00:00.000Z',
    updated_at: '2026-05-30T00:00:00.000Z',
  },
] as Project[]

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('TodayMemoBoard project filtering', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    invalidateWishlistItemsCache()
    window.__focusmapMemoDropHandler = undefined
    window.__focusmapScheduledMemoIndex = undefined
    window.__focusmapScheduledMemoDrag = null
    window.__focusmapScheduledMemoDropHandler = undefined
  })

  test('選択中プロジェクトをメモ取得APIへ渡す', async () => {
    const fetchMock = vi.fn<Window['fetch']>(async (input) => {
      const url = requestUrl(input)
      if (url === '/api/wishlist?space_id=space-1&project_id=project-1') {
        return new Response(JSON.stringify({ items: [createMemoItem()] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <TodayMemoBoard
        projects={projects}
        selectedSpaceId="space-1"
        selectedProjectId="project-1"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Project memo')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist?space_id=space-1&project_id=project-1')
  })
})
