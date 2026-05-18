import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WishlistCard } from './wishlist-card'
import type { IdealGoalWithItems } from '@/types/database'
import { MEMO_DRAG_MIME, TODAY_DURATION_DEFAULT } from '@/lib/calendar-constants'

function createMemoItem(overrides: Partial<IdealGoalWithItems> = {}): IdealGoalWithItems {
  return {
    id: 'memo-1',
    user_id: 'user-1',
    title: 'Test memo',
    description: 'Test description',
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ideal_items: [],
    ...overrides,
  } as IdealGoalWithItems
}

describe('WishlistCard', () => {
  test('memo_status=completed のカードはクリックで未完了として保存する', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)

    render(
      <WishlistCard
        item={createMemoItem({ is_completed: false, memo_status: 'completed' })}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTitle('完了済み'))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('memo-1', {
        is_completed: false,
        memo_status: 'unsorted',
      })
    })
  })

  test('未完了カードはクリックで完了として保存する', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)

    render(
      <WishlistCard
        item={createMemoItem({ is_completed: false, memo_status: 'unsorted' })}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTitle('完了にする'))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('memo-1', {
        is_completed: true,
        memo_status: 'completed',
        is_today: false,
      })
    })
  })

  test('今日に予定済みのカードは今日する解除として扱う', async () => {
    const onToggleToday = vi.fn().mockResolvedValue(undefined)
    const scheduledAt = new Date()
    scheduledAt.setHours(18, 30, 0, 0)
    const item = createMemoItem({
      scheduled_at: scheduledAt.toISOString(),
      memo_status: 'scheduled',
      is_today: false,
    })

    render(
      <WishlistCard
        item={item}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
        onToggleToday={onToggleToday}
      />
    )

    fireEvent.click(screen.getByTitle('今日するリストから外す'))

    await waitFor(() => {
      expect(onToggleToday).toHaveBeenCalledWith(item, true)
    })
  })

  test('nativeMemoDrag=true の未完了カードはカレンダーD&D payloadを設定する', () => {
    const item = createMemoItem({ duration_minutes: null })
    const data: Record<string, string> = {}
    const dataTransfer = {
      setData: vi.fn((type: string, value: string) => { data[type] = value }),
      setDragImage: vi.fn(),
      effectAllowed: '',
    }

    const { container } = render(
      <WishlistCard
        item={item}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
        nativeMemoDrag
      />
    )

    const card = container.firstElementChild as HTMLElement
    expect(card).toHaveAttribute('draggable', 'true')

    fireEvent.dragStart(card, { dataTransfer })

    const payload = JSON.parse(data[MEMO_DRAG_MIME])
    expect(payload).toEqual({
      memoId: 'memo-1',
      durationMinutes: TODAY_DURATION_DEFAULT,
      title: 'Test memo',
    })
    expect(data['text/plain']).toBe(`__focusmap_memo__${JSON.stringify(payload)}`)
    expect(window.__focusmapMemoDrag).toEqual(payload)

    fireEvent.dragEnd(card)
    expect(window.__focusmapMemoDrag).toBeNull()
  })

  test('完了メモはnativeMemoDrag=trueでもドラッグ不可にする', () => {
    const { container } = render(
      <WishlistCard
        item={createMemoItem({ is_completed: true, memo_status: 'completed' })}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
        nativeMemoDrag
      />
    )

    expect(container.firstElementChild).not.toHaveAttribute('draggable', 'true')
  })
})
