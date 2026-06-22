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
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'ai_runners') return { select: runnerSelect }
      if (table === 'ai_tasks') return aiTaskQuery
      return aiTaskQuery
    }),
  }
  return { runnerMaybeSingle, runnerSelect, aiTaskQuery, supabase }
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
  upsertAiHistoryItem: vi.fn(() => Promise.resolve('history-1')),
  upsertProjectRepoScope: vi.fn(() => Promise.resolve()),
}))

import { POST } from './route'
import { upsertAiHistoryItem } from '@/lib/turso/ai-history'

const upsertAiHistoryItemMock = vi.mocked(upsertAiHistoryItem)

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
})
