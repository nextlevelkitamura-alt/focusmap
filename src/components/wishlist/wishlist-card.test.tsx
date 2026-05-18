import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WishlistCard } from './wishlist-card'
import type { IdealGoalWithItems } from '@/types/database'

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
})
