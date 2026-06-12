import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WishlistCard } from './wishlist-card'
import type { IdealGoalWithItems, Project } from '@/types/database'
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

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    user_id: 'user-1',
    space_id: 'space-1',
    title: '転職',
    description: '',
    purpose: null,
    category_tag: null,
    priority: 0,
    status: 'active',
    color_theme: '#3b82f6',
    repo_path: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Project
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

  test('削除ボタンは確認ダイアログなしで削除する', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(
      <WishlistCard
        item={createMemoItem({ title: 'Delete memo' })}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        onClick={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTitle('削除'))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('memo-1')
    })
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  test('未予定カードは左側の予定ボタンからスケジュール画面を開ける', () => {
    const onScheduleClick = vi.fn()
    const onOpen = vi.fn()

    render(
      <WishlistCard
        item={createMemoItem({ title: 'Schedule memo' })}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={onOpen}
        onScheduleClick={onScheduleClick}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '予定に入れる' }))

    expect(onScheduleClick).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  test('予定済みカードには予定ボタンを表示しない', () => {
    render(
      <WishlistCard
        item={createMemoItem({ scheduled_at: '2026-06-12T10:00:00.000Z', memo_status: 'scheduled' })}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
        onScheduleClick={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '予定に入れる' })).not.toBeInTheDocument()
  })

  test('プロジェクトは左上、タグは見出し下に1回だけ表示し、チェックボックスを右上に置く', () => {
    render(
      <WishlistCard
        item={createMemoItem({ category: 'アイデア', tags: ['アイデア', '採用'] })}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
        project={createProject()}
      />
    )

    expect(screen.getByText('転職')).toBeInTheDocument()
    expect(screen.getAllByText('アイデア')).toHaveLength(1)
    expect(screen.getByText('採用')).toBeInTheDocument()

    const checkButton = screen.getByTitle('完了にする')
    expect(checkButton).toHaveClass('absolute')
    expect(checkButton).toHaveClass('right-2')
    expect(checkButton).toHaveClass('top-2')
    expect(screen.queryByTitle('今日するリストに追加')).not.toBeInTheDocument()
    expect(screen.queryByTitle('今日するリストから外す')).not.toBeInTheDocument()
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
