import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const runnerMaybeSingle = vi.fn()
  const runnerEq2 = vi.fn(() => ({ maybeSingle: runnerMaybeSingle }))
  const runnerEq1 = vi.fn(() => ({ eq: runnerEq2 }))
  const runnerSelect = vi.fn(() => ({ eq: runnerEq1 }))
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'ai_runners') return { select: runnerSelect }
      return { select: vi.fn() }
    }),
  }
  return { runnerMaybeSingle, supabase }
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
  listActiveAiHistoryMonitorTargets: vi.fn(() => Promise.resolve([{
    id: 'history-1',
    provider: 'codex_app',
    external_thread_id: 'thread-1',
    repo_path: '/repo',
    project_id: 'project-1',
    status: 'running',
    run_state: 'started',
    last_activity_at: '2026-06-23T08:00:00.000Z',
    indexed_at: '2026-06-23T08:01:00.000Z',
  }])),
  toAiHistoryMonitorTarget: vi.fn((item: Record<string, unknown>) => ({
    historyItemId: item.id,
    id: item.id,
    provider: item.provider,
    externalThreadId: item.external_thread_id,
    repoPath: item.repo_path,
    projectId: item.project_id,
    status: item.status,
    runState: item.run_state,
    lastActivityAt: item.last_activity_at,
    indexedAt: item.indexed_at,
  })),
}))

import { POST } from './route'
import { listActiveAiHistoryMonitorTargets } from '@/lib/turso/ai-history'

const listActiveAiHistoryMonitorTargetsMock = vi.mocked(listActiveAiHistoryMonitorTargets)

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/agents/ai-history/active-monitor-targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agents/ai-history/active-monitor-targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runnerMaybeSingle.mockResolvedValue({
      data: { id: 'runner-1', user_id: 'user-1', executors: ['codex_app'] },
      error: null,
    })
  })

  test('returns active Codex history targets for the agent runner', async () => {
    const response = await POST(request({ runner_id: 'runner-1', limit: 25 }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(listActiveAiHistoryMonitorTargetsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'codex_app',
      limit: 25,
    })
    expect(payload.targets).toEqual([{
      historyItemId: 'history-1',
      id: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      projectId: 'project-1',
      status: 'running',
      runState: 'started',
      lastActivityAt: '2026-06-23T08:00:00.000Z',
      indexedAt: '2026-06-23T08:01:00.000Z',
    }])
    expect(payload.policy.activeStatuses).toEqual(['running', 'awaiting_approval', 'needs_input'])
    expect(payload.policy).toMatchObject({
      provider: 'codex_app',
      metadataOnly: true,
      rawBodiesIncluded: false,
    })
  })
})
