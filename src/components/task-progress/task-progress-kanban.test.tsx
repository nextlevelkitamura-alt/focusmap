import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import type { TaskProgressSnapshotTask } from '@/types/task-progress'
import { TaskProgressKanban } from './task-progress-kanban'

vi.mock('@/lib/auth/supabase-auth-fetch', () => ({
  fetchWithSupabaseAuth: vi.fn(),
}))

const fetchWithSupabaseAuthMock = vi.mocked(fetchWithSupabaseAuth)

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function progressTask(overrides: Partial<TaskProgressSnapshotTask> = {}): TaskProgressSnapshotTask {
  return {
    id: 'task-1',
    title: 'Codexタスク',
    status: 'awaiting_approval',
    executor: 'codex_app',
    codex_thread_id: null,
    current_step: '確認待ちです',
    progress_percent: null,
    summary: null,
    updated_at: new Date().toISOString(),
    source_type: 'mindmap',
    source_id: 'node-1',
    ...overrides,
  }
}

function sourceTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'todo',
    title: id,
    deleted_at: null,
    ...overrides,
  }
}

function renderMobileKanban(
  tasks: TaskProgressSnapshotTask[] = [],
  sourceTasksById = new Map<string, ReturnType<typeof sourceTask>>(),
) {
  render(
    <TaskProgressKanban
      tasks={tasks}
      sourceTasksById={sourceTasksById}
      isMobile
      pollIntervalMs={3000}
      onRefresh={vi.fn()}
      onOpenTask={vi.fn()}
    />,
  )
}

describe('TaskProgressKanban', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({ source: 'turso', heartbeats: [] }))
  })

  test('スマホのCodexボタンにMac onlineを表示する', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }))

    renderMobileKanban()

    expect(await screen.findByText('online')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mac状態はオンライン/ })).toBeInTheDocument()
    })
  })

  test('古いheartbeatはスマホのCodexボタンでoffline扱いにする', async () => {
    const staleSeenAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    fetchWithSupabaseAuthMock.mockResolvedValue(jsonResponse({
      source: 'turso',
      heartbeats: [
        {
          runner_id: 'runner-1',
          status: 'online',
          last_seen_at: staleSeenAt,
          updated_at: staleSeenAt,
        },
      ],
    }))

    renderMobileKanban()

    expect(await screen.findByText('offline')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mac状態はオフライン/ })).toBeInTheDocument()
    })
  })

  test('非表示中はMac heartbeatを読まず、表示復帰時に読む', async () => {
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get')
    try {
      visibilitySpy.mockReturnValue('hidden')

      renderMobileKanban()

      await new Promise(resolve => window.setTimeout(resolve, 0))
      expect(fetchWithSupabaseAuthMock).not.toHaveBeenCalled()

      visibilitySpy.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))

      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(1)
      })
    } finally {
      visibilitySpy.mockRestore()
    }
  })

  test('iOSアプリ復帰イベントでMac heartbeatを即再取得する', async () => {
    let nowMs = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    try {
      renderMobileKanban()

      expect(await screen.findByText('offline')).toBeInTheDocument()
      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(1)
      })

      nowMs += 1_000
      act(() => {
        window.dispatchEvent(new Event('focusmap:native-app-resume'))
      })

      await waitFor(() => {
        expect(fetchWithSupabaseAuthMock).toHaveBeenCalledTimes(2)
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  test('スマホ看板はステータスタブで表示レーンを切り替える', async () => {
    renderMobileKanban([
      progressTask({
        id: 'running-task',
        title: '実行中のCodexタスク',
        status: 'running',
        source_id: 'node-running',
      }),
      progressTask({
        id: 'review-task',
        title: '確認待ちのCodexタスク',
        status: 'awaiting_approval',
        source_id: 'node-review',
      }),
    ], new Map([
      ['node-running', sourceTask('node-running')],
      ['node-review', sourceTask('node-review')],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codex看板を開く/ }))

    expect(screen.getByText('確認待ちのCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('実行中のCodexタスク')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /実行中 1件/ }))

    expect(screen.getByText('実行中のCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('確認待ちのCodexタスク')).not.toBeInTheDocument()
  })

  test('マインドマップから削除済みのCodex taskは看板に出さない', async () => {
    renderMobileKanban([
      progressTask({
        id: 'visible-task',
        title: '残っているノードのCodexタスク',
        source_id: 'node-visible',
      }),
      progressTask({
        id: 'deleted-task',
        title: '削除済みノードのCodexタスク',
        source_id: 'node-deleted',
      }),
    ], new Map([
      ['node-visible', sourceTask('node-visible')],
    ]))

    fireEvent.click(await screen.findByRole('button', { name: /Codex看板を開く/ }))

    expect(screen.getByText('残っているノードのCodexタスク')).toBeInTheDocument()
    expect(screen.queryByText('削除済みノードのCodexタスク')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /確認待ち 1件/ })).toBeInTheDocument()
  })
})
