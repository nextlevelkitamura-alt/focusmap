import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET, POST } from './route'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'
import { listRunnerHeartbeats, upsertRunnerHeartbeat } from '@/lib/turso/codex-monitoring'

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
const upsertRunnerHeartbeatMock = vi.mocked(upsertRunnerHeartbeat)

function request() {
  return new NextRequest('http://localhost/api/task-progress/runner-heartbeats?limit=5')
}

function supabaseAuthWithHeartbeats(rows: Array<Record<string, unknown>>, options: { upsertRow?: Record<string, unknown> } = {}) {
  const row = options.upsertRow ?? rows[0] ?? {
    id: 'runner-supabase',
    user_id: 'user-1',
    hostname: 'naonomac-playwright.local',
    metadata: {},
    last_heartbeat_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn(() => ({ limit }))
  const selectMaybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const selectEqSecond = vi.fn(() => ({ maybeSingle: selectMaybeSingle }))
  const selectEqFirst = vi.fn(() => ({ eq: selectEqSecond, order }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const updateSelect = vi.fn(() => ({ maybeSingle }))
  const updateEqSecond = vi.fn(() => ({ select: updateSelect }))
  const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }))
  const update = vi.fn(() => ({ eq: updateEqFirst }))
  const upsertSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const upsertSelect = vi.fn(() => ({ single: upsertSingle }))
  const upsert = vi.fn(() => ({ select: upsertSelect }))
  const select = vi.fn(() => ({ eq: selectEqFirst }))
  const from = vi.fn(() => ({ select, update, upsert }))

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

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/task-progress/runner-heartbeats', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
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

  test('POSTはTurso有効時もSupabase runner heartbeatを更新する', async () => {
    const fresh = new Date().toISOString()
    authenticateMonitoringRequestMock.mockResolvedValue(supabaseAuthWithHeartbeats([], {
      upsertRow: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: 'user-1',
        hostname: 'naonomac-playwright.local',
        metadata: { runner_status: 'online', agent_state: 'idle' },
        last_heartbeat_at: fresh,
        created_at: fresh,
        updated_at: fresh,
      },
    }) as never)
    upsertRunnerHeartbeatMock.mockResolvedValue({ last_seen_at: fresh } as never)

    const response = await POST(postRequest({
      runner_id: '11111111-1111-4111-8111-111111111111',
      hostname: 'naonomac-playwright.local',
      device_id: 'naonomac-playwright.local',
      status: 'online',
      metadata: { agent: 'focusmap-agent' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.source).toBe('turso+supabase')
    expect(payload.heartbeat.last_seen_at).toBe(fresh)
    expect(payload.supabase_heartbeat.runner_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(upsertRunnerHeartbeatMock).toHaveBeenCalledWith(expect.objectContaining({
      runner_id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-1',
      status: 'online',
    }))
  })
})
