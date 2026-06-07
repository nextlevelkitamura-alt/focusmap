import { render, screen, waitFor } from '@testing-library/react'
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

function renderMobileKanban(tasks: TaskProgressSnapshotTask[] = []) {
  render(
    <TaskProgressKanban
      tasks={tasks}
      sourceTasksById={new Map()}
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
})
