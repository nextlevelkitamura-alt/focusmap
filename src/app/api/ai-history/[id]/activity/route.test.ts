import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET } from './route'
import {
  aiHistoryDetailHydrateReason,
  countAiHistoryDetailMessages,
  getAiHistoryItemForUser,
  isAiHistoryDetailHydrateRequired,
  listAiHistoryDetailMessages,
  toAiHistoryDetailActivityMessage,
  upsertAiHistoryDetailHydrateRequest,
} from '@/lib/turso/ai-history'
import { authenticateAiHistoryRequest } from '../../_shared'

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: vi.fn(() => true),
  TursoConfigurationError: class TursoConfigurationError extends Error {},
}))

vi.mock('@/lib/turso/ai-history', () => ({
  getAiHistoryItemForUser: vi.fn(),
  listAiHistoryDetailMessages: vi.fn(),
  countAiHistoryDetailMessages: vi.fn(),
  isAiHistoryDetailHydrateRequired: vi.fn(),
  aiHistoryDetailHydrateReason: vi.fn(),
  upsertAiHistoryDetailHydrateRequest: vi.fn(),
  toAiHistoryDetailActivityMessage: vi.fn((message: Record<string, unknown>) => ({
    id: message.id,
    task_id: message.history_item_id,
    user_id: message.user_id,
    role: message.role === 'user' ? 'user' : 'codex',
    detail_role: message.role,
    kind: message.role === 'user' ? 'sent' : 'completed',
    detail_kind: message.kind,
    body: message.body,
    importance: 'normal',
    metadata: {},
    created_at: message.occurred_at ?? message.created_at,
  })),
}))

vi.mock('../../_shared', () => ({
  authenticateAiHistoryRequest: vi.fn(),
  parseLimit: (value: string | null, defaultValue: number, max: number) => {
    const parsed = Number.parseInt(value || String(defaultValue), 10)
    return Math.min(Math.max(Number.isFinite(parsed) ? parsed : defaultValue, 1), max)
  },
  unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}))

const authenticateAiHistoryRequestMock = vi.mocked(authenticateAiHistoryRequest)
const getAiHistoryItemForUserMock = vi.mocked(getAiHistoryItemForUser)
const listAiHistoryDetailMessagesMock = vi.mocked(listAiHistoryDetailMessages)
const countAiHistoryDetailMessagesMock = vi.mocked(countAiHistoryDetailMessages)
const isAiHistoryDetailHydrateRequiredMock = vi.mocked(isAiHistoryDetailHydrateRequired)
const aiHistoryDetailHydrateReasonMock = vi.mocked(aiHistoryDetailHydrateReason)
const toAiHistoryDetailActivityMessageMock = vi.mocked(toAiHistoryDetailActivityMessage)
const upsertAiHistoryDetailHydrateRequestMock = vi.mocked(upsertAiHistoryDetailHydrateRequest)

const baseItem = {
  id: 'history-1',
  user_id: 'user-1',
  provider: 'codex_app',
  external_thread_id: 'thread-1',
  repo_path: '/repo',
  worktree_path: null,
  project_id: 'project-1',
  source_task_id: null,
  linked_ai_task_id: null,
  title: '履歴',
  snippet: null,
  status: 'completed' as const,
  run_state: null,
  last_activity_at: '2026-06-20T00:00:00.000Z',
  indexed_at: '2026-06-20T00:00:00.000Z',
  started_at: null,
  ended_at: null,
  work_duration_seconds: null,
  archived: false,
  archived_at: null,
  deleted_at: null,
  detail_synced_at: '2026-06-20T00:00:01.000Z',
  detail_message_count: 2,
  metadata_json: null,
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
}

function request(path = '/api/ai-history/history-1/activity?limit=30&mode=report') {
  return new NextRequest(`http://localhost${path}`)
}

describe('GET /api/ai-history/[id]/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAiHistoryRequestMock.mockResolvedValue({
      user: { id: 'user-1' },
      supabase: {},
    } as never)
    getAiHistoryItemForUserMock.mockResolvedValue(baseItem)
    listAiHistoryDetailMessagesMock.mockResolvedValue([])
    countAiHistoryDetailMessagesMock.mockResolvedValue(0)
    isAiHistoryDetailHydrateRequiredMock.mockReturnValue(true)
    aiHistoryDetailHydrateReasonMock.mockReturnValue('detail_cache_empty')
    upsertAiHistoryDetailHydrateRequestMock.mockResolvedValue({
      id: 'aihreq-1',
      requestedAt: '2026-06-20T00:00:00.000Z',
      expiresAt: '2026-06-20T00:02:00.000Z',
    })
  })

  test('keeps linked AI history redirected to existing ai_tasks activity', async () => {
    getAiHistoryItemForUserMock.mockResolvedValue({
      ...baseItem,
      linked_ai_task_id: 'ai-task-1',
    })

    const response = await GET(request(), { params: Promise.resolve({ id: 'history-1' }) })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost/api/ai-tasks/ai-task-1/activity?limit=30&mode=report',
    )
    expect(listAiHistoryDetailMessagesMock).not.toHaveBeenCalled()
  })

  test('returns cached unlinked detail messages with hydrate not required', async () => {
    listAiHistoryDetailMessagesMock.mockResolvedValue([
      {
        id: 'detail-1',
        user_id: 'user-1',
        history_item_id: 'history-1',
        provider: 'codex_app',
        external_thread_id: 'thread-1',
        repo_path: '/repo',
        sequence: 0,
        role: 'user',
        kind: 'user_prompt',
        body: '実装して',
        body_hash: 'hash-user',
        occurred_at: '2026-06-20T00:00:00.000Z',
        metadata_json: null,
        created_at: '2026-06-20T00:00:00.000Z',
        updated_at: '2026-06-20T00:00:00.000Z',
      },
      {
        id: 'detail-2',
        user_id: 'user-1',
        history_item_id: 'history-1',
        provider: 'codex_app',
        external_thread_id: 'thread-1',
        repo_path: '/repo',
        sequence: 1,
        role: 'assistant',
        kind: 'assistant_answer',
        body: '完了しました',
        body_hash: 'hash-assistant',
        occurred_at: '2026-06-20T00:00:01.000Z',
        metadata_json: null,
        created_at: '2026-06-20T00:00:01.000Z',
        updated_at: '2026-06-20T00:00:01.000Z',
      },
    ])
    countAiHistoryDetailMessagesMock.mockResolvedValue(2)
    isAiHistoryDetailHydrateRequiredMock.mockReturnValue(false)
    aiHistoryDetailHydrateReasonMock.mockReturnValue(null)

    const response = await GET(request(), { params: Promise.resolve({ id: 'history-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.source).toBe('ai_history_detail_cache')
    expect(payload.messages).toHaveLength(2)
    expect(payload.hydrate).toMatchObject({
      required: false,
      reason: null,
      messageCount: 2,
    })
    expect(toAiHistoryDetailActivityMessageMock).toHaveBeenCalledTimes(2)
  })

  test('returns hydrate required when unlinked cache is empty', async () => {
    const response = await GET(request('/api/ai-history/history-1/activity'), {
      params: Promise.resolve({ id: 'history-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload.source).toBe('hydrate_required')
    expect(payload.messages).toEqual([])
    expect(payload.hydrate).toMatchObject({
      required: true,
      reason: 'detail_cache_empty',
      historyItemId: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      messageCount: 0,
    })
    expect(upsertAiHistoryDetailHydrateRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      item: expect.objectContaining({ id: 'history-1' }),
      reason: 'detail_cache_empty',
      requestedBy: 'web',
      ttlSeconds: 120,
    }))
  })
})
