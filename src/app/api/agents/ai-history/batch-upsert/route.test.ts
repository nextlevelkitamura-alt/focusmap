import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const runnerMaybeSingle = vi.fn()
  const runnerEq2 = vi.fn(() => ({ maybeSingle: runnerMaybeSingle }))
  const runnerEq1 = vi.fn(() => ({ eq: runnerEq2 }))
  const runnerSelect = vi.fn(() => ({ eq: runnerEq1 }))
  const aiTaskQuery = {
    select: vi.fn(() => aiTaskQuery),
    eq: vi.fn(() => aiTaskQuery),
    in: vi.fn(() => aiTaskQuery),
    order: vi.fn(() => aiTaskQuery),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  const tasksQuery = {
    select: vi.fn(() => tasksQuery),
    update: vi.fn(() => tasksQuery),
    eq: vi.fn(() => tasksQuery),
    in: vi.fn(() => tasksQuery),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    is: vi.fn(() => Promise.resolve({ error: null })),
  }
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'ai_runners') return { select: runnerSelect }
      if (table === 'ai_tasks') return aiTaskQuery
      if (table === 'tasks') return tasksQuery
      return aiTaskQuery
    }),
  }
  return { runnerMaybeSingle, runnerSelect, aiTaskQuery, tasksQuery, supabase }
})

vi.mock('@/lib/agent-auth', () => ({
  authenticateAgent: vi.fn(() => Promise.resolve({
    supabase: mocks.supabase,
    token: {
      id: 'token-1',
      user_id: 'user-1',
      space_id: null,
      name: 'agent',
      expires_at: null,
      revoked_at: null,
    },
  })),
}))

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: vi.fn(() => true),
  TursoConfigurationError: class TursoConfigurationError extends Error {},
}))

vi.mock('@/lib/turso/ai-history', () => ({
  AI_HISTORY_STATUSES: new Set(['running', 'awaiting_approval', 'needs_input', 'completed', 'failed', 'idle']),
  getAiHistoryItemForUser: vi.fn(() => Promise.resolve(null)),
  upsertAiHistoryItem: vi.fn(() => Promise.resolve('history-1')),
  upsertProjectRepoScope: vi.fn(() => Promise.resolve()),
}))

import { POST } from './route'
import { getAiHistoryItemForUser, upsertAiHistoryItem } from '@/lib/turso/ai-history'

const upsertAiHistoryItemMock = vi.mocked(upsertAiHistoryItem)
const getAiHistoryItemForUserMock = vi.mocked(getAiHistoryItemForUser)

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/agents/ai-history/batch-upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agents/ai-history/batch-upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runnerMaybeSingle.mockResolvedValue({
      data: { id: 'runner-1', user_id: 'user-1', executors: ['codex_app'] },
      error: null,
    })
    mocks.aiTaskQuery.limit.mockResolvedValue({ data: [], error: null })
    mocks.tasksQuery.limit.mockResolvedValue({ data: [], error: null })
    mocks.tasksQuery.is.mockResolvedValue({ error: null })
    getAiHistoryItemForUserMock.mockResolvedValue(null)
    upsertAiHistoryItemMock.mockResolvedValue('history-1')
  })

  test('returns historyItemId for each successfully upserted item', async () => {
    const response = await POST(request({
      runner_id: 'runner-1',
      provider: 'codex_app',
      items: [{
        externalThreadId: 'thread-1',
        repoPath: '/repo',
        title: 'AI履歴',
        status: 'completed',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
      }],
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toEqual([{
      index: 0,
      historyItemId: 'history-1',
      id: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      projectId: null,
      sourceTaskId: null,
      linkedAiTaskId: null,
    }])
    expect(payload.policy.idField).toBe('historyItemId')
    expect(upsertAiHistoryItemMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      provider: 'codex_app',
      external_thread_id: 'thread-1',
      repo_path: '/repo',
    }))
  })

  test('uses a friendly placeholder title when runner omits title', async () => {
    const response = await POST(request({
      runner_id: 'runner-1',
      provider: 'codex_app',
      items: [{
        externalThreadId: 'thread-no-title',
        repoPath: '/repo',
        status: 'idle',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
      }],
    }))

    expect(response.status).toBe(200)
    expect(upsertAiHistoryItemMock).toHaveBeenCalledWith(expect.objectContaining({
      external_thread_id: 'thread-no-title',
      title: '新しいチャット',
    }))
  })

  test('syncs placed AI history status back to the source mindmap task', async () => {
    mocks.tasksQuery.limit.mockResolvedValueOnce({
      data: [{
        id: 'task-1',
        project_id: 'project-1',
        source: 'codex_app_thread',
        deleted_at: null,
      }],
      error: null,
    })

    const response = await POST(request({
      runner_id: 'runner-1',
      provider: 'codex_app',
      items: [{
        externalThreadId: 'thread-1',
        repoPath: '/repo',
        sourceTaskId: 'task-1',
        title: 'AI履歴',
        status: 'awaiting_approval',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
      }],
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.sourceTasksSynced).toBe(1)
    expect(upsertAiHistoryItemMock).toHaveBeenCalledWith(expect.objectContaining({
      source_task_id: 'task-1',
      clear_source_task_id: false,
      status: 'awaiting_approval',
    }))
    expect(mocks.tasksQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      codex_status: 'awaiting_approval',
      codex_thread_id: 'thread-1',
    }))
    expect(mocks.tasksQuery.eq).toHaveBeenCalledWith('id', 'task-1')
    expect(mocks.tasksQuery.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mocks.tasksQuery.is).toHaveBeenCalledWith('deleted_at', null)
  })

  test('syncs status to an existing preserved source task when the runner omits sourceTaskId', async () => {
    getAiHistoryItemForUserMock.mockResolvedValue({
      source_task_id: 'task-preserved',
    } as Awaited<ReturnType<typeof getAiHistoryItemForUser>>)
    mocks.tasksQuery.limit.mockResolvedValueOnce({
      data: [{
        id: 'task-preserved',
        project_id: 'project-1',
        source: 'codex_app_thread',
        deleted_at: null,
      }],
      error: null,
    })

    const response = await POST(request({
      runner_id: 'runner-1',
      provider: 'codex_app',
      items: [{
        externalThreadId: 'thread-preserved',
        repoPath: '/repo',
        title: '配置済みAI履歴',
        status: 'needs_input',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
      }],
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.sourceTasksSynced).toBe(1)
    expect(getAiHistoryItemForUserMock).toHaveBeenCalledWith('history-1', 'user-1')
    expect(mocks.tasksQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      codex_status: 'awaiting_approval',
      codex_thread_id: 'thread-preserved',
    }))
    expect(mocks.tasksQuery.eq).toHaveBeenCalledWith('id', 'task-preserved')
  })

  test('does not sync an existing preserved legacy Codex Inbox task', async () => {
    getAiHistoryItemForUserMock.mockResolvedValue({
      source_task_id: 'legacy-inbox-task',
    } as Awaited<ReturnType<typeof getAiHistoryItemForUser>>)
    mocks.tasksQuery.limit.mockResolvedValueOnce({
      data: [{
        id: 'legacy-inbox-task',
        project_id: 'project-1',
        source: 'codex_inbox',
        deleted_at: null,
      }],
      error: null,
    })

    const response = await POST(request({
      runner_id: 'runner-1',
      provider: 'codex_app',
      items: [{
        externalThreadId: 'thread-legacy',
        repoPath: '/repo',
        title: '古いInbox履歴',
        status: 'awaiting_approval',
        lastActivityAt: '2026-06-20T00:00:00.000Z',
      }],
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.sourceTasksSynced).toBe(0)
    expect(mocks.tasksQuery.update).not.toHaveBeenCalled()
  })
})
