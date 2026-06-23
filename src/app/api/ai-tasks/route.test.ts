import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST } from './route'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { resolveAiTaskSpaceId } from '@/lib/space-access'
import { createClient } from '@/utils/supabase/server'

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/auth/verify-supabase-jwt', () => ({
  authenticateSupabaseRequest: vi.fn(),
}))

vi.mock('@/lib/space-access', () => ({
  canViewSpace: vi.fn(),
  normalizeVisibility: vi.fn((value: unknown, fallback: string) => value || fallback),
  resolveAiTaskSpaceId: vi.fn(),
}))

vi.mock('@/lib/usage-guard', () => ({
  assertCanExecute: vi.fn(),
}))

vi.mock('@/lib/format', () => ({
  formatBillingCycle: vi.fn(() => '2026-06'),
}))

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: vi.fn(() => false),
}))

vi.mock('@/lib/turso/codex-monitoring', () => ({
  upsertTursoAiTask: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)
const authenticateSupabaseRequestMock = vi.mocked(authenticateSupabaseRequest)
const resolveAiTaskSpaceIdMock = vi.mocked(resolveAiTaskSpaceId)

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/ai-tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function mockAiTaskInsert() {
  let inserted: Record<string, unknown> | null = null
  const single = vi.fn(async () => ({
    data: {
      id: 'task-1',
      created_at: '2026-06-23T00:00:00.000Z',
      ...inserted,
    },
    error: null,
  }))
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: Record<string, unknown>) => {
    inserted = payload
    return { select }
  })
  const from = vi.fn(() => ({ insert }))
  createClientMock.mockResolvedValue({ from } as never)
  return { insert, getInserted: () => inserted }
}

describe('/api/ai-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateSupabaseRequestMock.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      claims: {},
    } as never)
    resolveAiTaskSpaceIdMock.mockResolvedValue({ spaceId: null } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('codex_app autoはscheduled_at未指定なら即時claim可能な時刻を入れる', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'))
    const { getInserted } = mockAiTaskInsert()

    const response = await POST(postRequest({
      prompt: 'run this',
      executor: 'codex_app',
      dispatch_mode: 'auto',
      cwd: '/tmp/focusmap',
    }))

    expect(response.status).toBe(201)
    expect(getInserted()).toMatchObject({
      executor: 'codex_app',
      status: 'pending',
      scheduled_at: '2026-06-23T00:00:00.000Z',
      cwd: '/tmp/focusmap',
    })
  })

  test('codex_app manual handoffはneeds_inputのままscheduled_atを補完しない', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'))
    const { getInserted } = mockAiTaskInsert()

    const response = await POST(postRequest({
      prompt: 'copy this',
      executor: 'codex_app',
      dispatch_mode: 'manual',
    }))

    expect(response.status).toBe(201)
    expect(getInserted()).toMatchObject({
      executor: 'codex_app',
      status: 'needs_input',
      started_at: '2026-06-23T00:00:00.000Z',
      scheduled_at: null,
    })
    expect((getInserted()?.result as Record<string, unknown>).codex_run_state).toBe('prompt_waiting')
  })
})
