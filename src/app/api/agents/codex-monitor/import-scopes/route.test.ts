import { describe, expect, test, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const runnerMaybeSingle = vi.fn()
  const runnerEq2 = vi.fn(() => ({ maybeSingle: runnerMaybeSingle }))
  const runnerEq1 = vi.fn(() => ({ eq: runnerEq2 }))
  const runnerSelect = vi.fn(() => ({ eq: runnerEq1 }))
  const projectResponse: { data: unknown[]; error: unknown } = { data: [], error: null }
  const projectQuery = {
    select: vi.fn(() => projectQuery),
    eq: vi.fn(() => projectQuery),
    neq: vi.fn(() => projectQuery),
    not: vi.fn(() => projectQuery),
    order: vi.fn(() => projectQuery),
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => (
      Promise.resolve(projectResponse).then(resolve, reject)
    ),
  }
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'ai_runners') return { select: runnerSelect }
      return projectQuery
    }),
  }
  return { runnerMaybeSingle, runnerSelect, projectQuery, projectResponse, supabase }
})

vi.mock('@/lib/agent-auth', () => ({
  authenticateAgent: vi.fn(() => Promise.resolve({
    supabase: mocks.supabase,
    token: {
      id: 'token-1',
      user_id: 'user-1',
      space_id: 'space-1',
      name: 'agent',
      expires_at: null,
      revoked_at: null,
    },
  })),
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/agents/codex-monitor/import-scopes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runnerMaybeSingle.mockResolvedValue({
    data: { id: 'runner-1', executors: ['codex_app'] },
    error: null,
  })
  mocks.projectResponse.data = []
  mocks.projectResponse.error = null
})

describe('POST /api/agents/codex-monitor/import-scopes', () => {
  test('returns enabled repo scopes for Codex-capable runner', async () => {
    mocks.projectResponse.data = [
      {
        id: 'project-1',
        space_id: 'space-1',
        repo_path: '/Users/me/project',
        codex_thread_import_enabled_since: '2026-06-11T00:00:00.000Z',
      },
      {
        id: 'project-without-repo',
        space_id: 'space-1',
        repo_path: null,
        codex_thread_import_enabled_since: '2026-06-11T00:00:00.000Z',
      },
    ]

    const res = await POST(request({ runner_id: 'runner-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.scopes).toEqual([{
      project_id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/project',
      enabled_since: '2026-06-11T00:00:00.000Z',
    }])
    expect(mocks.runnerSelect).toHaveBeenCalledWith('id, user_id, executors')
    expect(mocks.projectQuery.eq).toHaveBeenCalledWith('codex_thread_import_enabled', true)
    expect(mocks.projectQuery.eq).toHaveBeenCalledWith('space_id', 'space-1')
  })

  test('rejects runners without Codex executor', async () => {
    mocks.runnerMaybeSingle.mockResolvedValue({
      data: { id: 'runner-1', executors: ['terminal'] },
      error: null,
    })

    const res = await POST(request({ runner_id: 'runner-1' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBe('Runner is not allowed to import Codex threads')
  })
})
