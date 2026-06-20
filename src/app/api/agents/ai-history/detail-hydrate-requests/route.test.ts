import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const runnerMaybeSingle = vi.fn()
  const runnerEq2 = vi.fn(() => ({ maybeSingle: runnerMaybeSingle }))
  const runnerEq1 = vi.fn(() => ({ eq: runnerEq2 }))
  const runnerSelect = vi.fn(() => ({ eq: runnerEq1 }))
  const supabase = {
    from: vi.fn(() => ({ select: runnerSelect })),
  }
  return { runnerMaybeSingle, runnerSelect, supabase }
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
  listAiHistoryDetailHydrateRequests: vi.fn(),
  toAiHistoryDetailHydrateRequestItem: vi.fn((request: Record<string, unknown>) => ({
    id: request.id,
    historyItemId: request.history_item_id,
    provider: request.provider,
    externalThreadId: request.external_thread_id,
    repoPath: request.repo_path,
    reason: request.reason,
    requestedAt: request.requested_at,
    expiresAt: request.expires_at,
    detailSyncedAt: request.detail_synced_at,
    detailMessageCount: request.detail_message_count,
    lastActivityAt: request.last_activity_at,
  })),
}))

import { GET, POST } from './route'
import { listAiHistoryDetailHydrateRequests } from '@/lib/turso/ai-history'

const listAiHistoryDetailHydrateRequestsMock = vi.mocked(listAiHistoryDetailHydrateRequests)

function request(path = '/api/agents/ai-history/detail-hydrate-requests?runner_id=runner-1&limit=5') {
  return new NextRequest(`http://localhost${path}`)
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/agents/ai-history/detail-hydrate-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/agents/ai-history/detail-hydrate-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runnerMaybeSingle.mockResolvedValue({
      data: { id: 'runner-1', user_id: 'user-1', executors: ['codex_app'] },
      error: null,
    })
    listAiHistoryDetailHydrateRequestsMock.mockResolvedValue([{
      id: 'request-1',
      user_id: 'user-1',
      history_item_id: 'history-1',
      provider: 'codex_app',
      external_thread_id: 'thread-1',
      repo_path: '/repo',
      reason: 'detail_cache_empty',
      requested_by: 'web',
      requested_at: '2026-06-20T00:00:00.000Z',
      expires_at: '2026-06-20T00:02:00.000Z',
      fulfilled_at: null,
      created_at: '2026-06-20T00:00:00.000Z',
      updated_at: '2026-06-20T00:00:00.000Z',
      detail_synced_at: null,
      detail_message_count: 0,
      last_activity_at: '2026-06-20T00:00:00.000Z',
    }])
  })

  test('returns active hydrate requests for Codex-capable runner', async () => {
    const response = await GET(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.requests).toEqual([{
      id: 'request-1',
      historyItemId: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      reason: 'detail_cache_empty',
      requestedAt: '2026-06-20T00:00:00.000Z',
      expiresAt: '2026-06-20T00:02:00.000Z',
      detailSyncedAt: null,
      detailMessageCount: 0,
      lastActivityAt: '2026-06-20T00:00:00.000Z',
    }])
    expect(payload.policy).toMatchObject({
      idField: 'historyItemId',
      postActivityUrlTemplate: '/api/agents/ai-history/{historyItemId}/activity',
    })
    expect(listAiHistoryDetailHydrateRequestsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 5,
    })
  })

  test('requires runner_id', async () => {
    const response = await GET(request('/api/agents/ai-history/detail-hydrate-requests'))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('runner_id is required')
  })

  test('also supports POST for the agent API client request pattern', async () => {
    const response = await POST(postRequest({ runner_id: 'runner-1', limit: 3 }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.requests[0].historyItemId).toBe('history-1')
    expect(listAiHistoryDetailHydrateRequestsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      limit: 3,
    })
  })
})
