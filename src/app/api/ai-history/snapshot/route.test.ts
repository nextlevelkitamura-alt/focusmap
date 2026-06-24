import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAiHistoryRequest: vi.fn(),
  isTursoConfigured: vi.fn(() => true),
  listAiHistorySnapshot: vi.fn(),
  projectMaybeSingle: vi.fn(),
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(),
          })),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: mocks.isTursoConfigured,
  TursoConfigurationError: class TursoConfigurationError extends Error {},
}))

vi.mock('@/lib/turso/ai-history', () => ({
  encodeAiHistoryCursor: vi.fn((item: { indexed_at: string; id: string }) => `${item.indexed_at}|${item.id}`),
  listAiHistorySnapshot: mocks.listAiHistorySnapshot,
  parseAiHistoryCursor: vi.fn((value: string | null) => {
    if (!value) return null
    const [indexedAt, id] = value.split('|')
    if (!indexedAt || !id) return null
    return { indexedAt, id }
  }),
  toAiHistoryListItem: vi.fn((item: Record<string, unknown>) => ({
    id: item.id,
    provider: item.provider,
    externalThreadId: item.external_thread_id,
    title: item.title,
    snippet: item.snippet,
    repoPath: item.repo_path,
    repoLabel: 'focusmap',
    worktreePath: item.worktree_path,
    placement: item.source_task_id ? 'mindmap' : 'unplaced',
    sourceTaskId: item.source_task_id,
    linkedAiTaskId: item.linked_ai_task_id,
    status: item.status,
    runState: item.run_state,
    lastActivityAt: item.last_activity_at,
    indexedAt: item.indexed_at,
    startedAt: item.started_at,
    endedAt: item.ended_at,
    workDurationSeconds: item.work_duration_seconds,
    archived: item.archived,
    deletedAt: item.deleted_at,
    detailHydrated: Boolean(item.detail_synced_at || item.detail_message_count),
    detailHydrateRequired: false,
    detailHydrateReason: null,
    detailMessageCount: item.detail_message_count ?? 0,
    detailSyncedAt: item.detail_synced_at,
    updatedAt: item.updated_at,
    codexOpenUrl: `codex://threads/${item.external_thread_id}`,
  })),
}))

vi.mock('../_shared', () => ({
  authenticateAiHistoryRequest: mocks.authenticateAiHistoryRequest,
  parseLimit: (value: string | null, defaultValue: number, max: number) => {
    const parsed = Number.parseInt(value || String(defaultValue), 10)
    return Math.min(Math.max(Number.isFinite(parsed) ? parsed : defaultValue, 1), max)
  },
  unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}))

import { GET } from './route'

function request(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

const baseRow = {
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
  snippet: '軽量snippet',
  status: 'running',
  run_state: 'started',
  last_activity_at: '2026-06-24T00:00:01.000Z',
  indexed_at: '2026-06-24T00:00:02.000Z',
  started_at: '2026-06-24T00:00:00.000Z',
  ended_at: null,
  work_duration_seconds: null,
  archived: false,
  archived_at: null,
  deleted_at: null,
  detail_synced_at: null,
  detail_message_count: 0,
  metadata_json: null,
  created_at: '2026-06-24T00:00:00.000Z',
  updated_at: '2026-06-24T00:00:02.000Z',
}

describe('GET /api/ai-history/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const projectEqUser = vi.fn(() => ({ maybeSingle: mocks.projectMaybeSingle }))
    const projectEqId = vi.fn(() => ({ eq: projectEqUser }))
    const projectSelect = vi.fn(() => ({ eq: projectEqId }))
    mocks.supabase.from.mockReturnValue({ select: projectSelect })
    mocks.isTursoConfigured.mockReturnValue(true)
    mocks.authenticateAiHistoryRequest.mockResolvedValue({
      user: { id: 'user-1' },
      supabase: mocks.supabase,
    })
    mocks.projectMaybeSingle.mockResolvedValue({
      data: {
        id: 'project-1',
        repo_path: '/repo',
      },
      error: null,
    })
    mocks.listAiHistorySnapshot.mockResolvedValue([baseRow])
  })

  test('returns metadata-only global snapshot without counts or reconcile work', async () => {
    const response = await GET(request(
      '/api/ai-history/snapshot?project_id=project-1&scope=global&repo=all&provider=codex_app&limit=25',
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.listAiHistorySnapshot).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      scope: 'global',
      provider: 'codex_app',
      repo: 'all',
      repoPaths: [],
      cursor: null,
      limit: 25,
      includeDeleted: false,
    })
    expect(payload).toMatchObject({
      source: 'turso',
      cursor: '2026-06-24T00:00:02.000Z|history-1',
      changedSince: null,
      hasMore: false,
      includeDeleted: false,
      filter: {
        projectId: 'project-1',
        repo: 'all',
        scope: 'global',
        provider: 'codex_app',
      },
      policy: {
        metadataOnly: true,
        countsIncluded: false,
        reconcileIncluded: false,
        detailHydrateRequestsCreated: false,
        rawBodiesIncluded: false,
        cursor: 'indexed_at|id',
      },
    })
    expect(payload.counts).toBeUndefined()
    expect(payload.items[0]).toMatchObject({
      id: 'history-1',
      externalThreadId: 'thread-1',
      status: 'running',
      runState: 'started',
      detailMessageCount: 0,
      deletedAt: null,
    })
  })

  test('uses project repo scope and returns the requested cursor when unchanged', async () => {
    mocks.listAiHistorySnapshot.mockResolvedValue([])

    const response = await GET(request(
      '/api/ai-history/snapshot?project_id=project-1&repo=/repo' +
        '&cursor=2026-06-24T00:00:02.000Z|history-1&include_deleted=true',
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.listAiHistorySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project',
      provider: 'codex_app',
      repo: '/repo',
      repoPaths: ['/repo'],
      cursor: { indexedAt: '2026-06-24T00:00:02.000Z', id: 'history-1' },
      includeDeleted: true,
    }))
    expect(payload.cursor).toBe('2026-06-24T00:00:02.000Z|history-1')
    expect(payload.changedSince).toBe('2026-06-24T00:00:02.000Z')
    expect(payload.items).toEqual([])
    expect(payload.includeDeleted).toBe(true)
  })

  test('keeps the empty snapshot contract when Turso is not configured', async () => {
    mocks.isTursoConfigured.mockReturnValue(false)

    const response = await GET(request('/api/ai-history/snapshot?project_id=project-1&scope=global'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      source: 'turso_not_configured',
      items: [],
      hasMore: false,
      filter: {
        projectId: 'project-1',
        repo: 'all',
        scope: 'global',
        provider: 'codex_app',
      },
      policy: {
        metadataOnly: true,
        countsIncluded: false,
        reconcileIncluded: false,
        detailHydrateRequestsCreated: false,
        rawBodiesIncluded: false,
      },
    })
    expect(mocks.listAiHistorySnapshot).not.toHaveBeenCalled()
  })
})
