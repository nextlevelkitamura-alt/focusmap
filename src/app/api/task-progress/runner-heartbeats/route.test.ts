import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET } from './route'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'
import { listRunnerHeartbeats } from '@/lib/turso/codex-monitoring'

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: vi.fn(() => true),
  TursoConfigurationError: class TursoConfigurationError extends Error {},
}))

vi.mock('@/lib/turso/request-auth', () => ({
  authenticateMonitoringRequest: vi.fn(),
}))

vi.mock('@/lib/turso/codex-monitoring', () => ({
  listRunnerHeartbeats: vi.fn(),
  upsertRunnerHeartbeat: vi.fn(),
}))

const authenticateMonitoringRequestMock = vi.mocked(authenticateMonitoringRequest)
const listRunnerHeartbeatsMock = vi.mocked(listRunnerHeartbeats)

function request() {
  return new NextRequest('http://localhost/api/task-progress/runner-heartbeats?limit=5')
}

function supabaseAuthWithHeartbeats(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))

  return {
    source: 'supabase',
    userId: 'user-1',
    email: 'user@example.com',
    spaceId: null,
    supabase: { from },
    agent: null,
    claims: null,
  }
}

describe('/api/task-progress/runner-heartbeats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('Tursoのheartbeatが新しければTursoだけ返す', async () => {
    const fresh = new Date().toISOString()
    authenticateMonitoringRequestMock.mockResolvedValue(supabaseAuthWithHeartbeats([]) as never)
    listRunnerHeartbeatsMock.mockResolvedValue([
      {
        runner_id: 'runner-turso',
        user_id: 'user-1',
        status: 'online',
        last_seen_at: fresh,
        updated_at: fresh,
      },
    ] as never)

    const response = await GET(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.source).toBe('turso')
    expect(payload.heartbeats).toHaveLength(1)
    expect(payload.heartbeats[0].runner_id).toBe('runner-turso')
  })

  test('Tursoが古い時はSupabaseの新しいheartbeatを混ぜて返す', async () => {
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    authenticateMonitoringRequestMock.mockResolvedValue(supabaseAuthWithHeartbeats([
      {
        id: 'runner-supabase',
        user_id: 'user-1',
        hostname: 'naonomac-playwright.local',
        metadata: { runner_status: 'online', agent_state: 'idle' },
        last_heartbeat_at: fresh,
        created_at: fresh,
        updated_at: fresh,
      },
    ]) as never)
    listRunnerHeartbeatsMock.mockResolvedValue([
      {
        runner_id: 'runner-turso',
        user_id: 'user-1',
        status: 'online',
        last_seen_at: stale,
        updated_at: stale,
      },
    ] as never)

    const response = await GET(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.source).toBe('turso+supabase')
    expect(payload.heartbeats[0].runner_id).toBe('runner-supabase')
    expect(payload.heartbeats[0].status).toBe('online')
  })
})
