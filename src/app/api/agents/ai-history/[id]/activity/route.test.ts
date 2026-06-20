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
      space_id: 'space-1',
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
  AI_HISTORY_DETAIL_ROLES: new Set(['user', 'assistant', 'system']),
  AI_HISTORY_DETAIL_KINDS: new Set(['user_prompt', 'assistant_answer', 'assistant_question', 'status', 'summary']),
  getAiHistoryItemForUser: vi.fn(),
  upsertAiHistoryDetailMessages: vi.fn(),
}))

import { POST, normalizeAiHistoryDetailPayloadMessage } from './route'
import { getAiHistoryItemForUser, upsertAiHistoryDetailMessages } from '@/lib/turso/ai-history'

const getAiHistoryItemForUserMock = vi.mocked(getAiHistoryItemForUser)
const upsertAiHistoryDetailMessagesMock = vi.mocked(upsertAiHistoryDetailMessages)

const baseItem = {
  id: 'history-1',
  user_id: 'user-1',
  provider: 'codex_app',
  external_thread_id: 'thread-1',
  repo_path: '/repo',
  linked_ai_task_id: null,
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/agents/ai-history/history-1/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('normalizeAiHistoryDetailPayloadMessage', () => {
  test('rejects raw JSON-looking bodies before they can be cached', () => {
    expect(normalizeAiHistoryDetailPayloadMessage({
      sequence: 0,
      role: 'assistant',
      kind: 'assistant_answer',
      body: '{"rollout": [{"type":"event_msg"}]}',
    }, 0)).toEqual({ error: 'raw_json_body at messages[0]' })
  })
})

describe('POST /api/agents/ai-history/[id]/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runnerMaybeSingle.mockResolvedValue({
      data: { id: 'runner-1', user_id: 'user-1', executors: ['codex_app'] },
      error: null,
    })
    getAiHistoryItemForUserMock.mockResolvedValue(baseItem as never)
    upsertAiHistoryDetailMessagesMock.mockResolvedValue({
      upserted: 2,
      messageCount: 2,
      detailSyncedAt: '2026-06-20T00:00:02.000Z',
    } as never)
  })

  test('upserts sanitized detail messages for an unlinked history item', async () => {
    const response = await POST(request({
      runner_id: 'runner-1',
      detail_synced_at: '2026-06-20T00:00:02.000Z',
      messages: [
        {
          sequence: 0,
          role: 'user',
          kind: 'user_prompt',
          body: 'この履歴を表示して',
          occurred_at: '2026-06-20T00:00:00.000Z',
          metadata: { source: 'visible_rollout' },
        },
        {
          sequence: 1,
          role: 'assistant',
          kind: 'assistant_answer',
          body: '表示できるようにしました',
          occurred_at: '2026-06-20T00:00:01.000Z',
        },
      ],
    }), { params: Promise.resolve({ id: 'history-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      historyItemId: 'history-1',
      upserted: 2,
      messageCount: 2,
    })
    expect(mocks.runnerSelect).toHaveBeenCalledWith('id, user_id, executors')
    expect(getAiHistoryItemForUserMock).toHaveBeenCalledWith('history-1', 'user-1')
    expect(upsertAiHistoryDetailMessagesMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      historyItemId: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      detailSyncedAt: '2026-06-20T00:00:02.000Z',
      messages: [
        expect.objectContaining({
          sequence: 0,
          role: 'user',
          kind: 'user_prompt',
          body: 'この履歴を表示して',
        }),
        expect.objectContaining({
          sequence: 1,
          role: 'assistant',
          kind: 'assistant_answer',
          body: '表示できるようにしました',
        }),
      ],
    }))
  })

  test('rejects payloads that include raw rollout fields', async () => {
    const response = await POST(request({
      runner_id: 'runner-1',
      raw_rollout: [{ type: 'event_msg' }],
      messages: [{
        sequence: 0,
        role: 'assistant',
        kind: 'assistant_answer',
        body: '表示用だけ',
      }],
    }), { params: Promise.resolve({ id: 'history-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      error: 'Raw detail payload is not accepted',
      blockedKey: '$.raw_rollout',
    })
    expect(upsertAiHistoryDetailMessagesMock).not.toHaveBeenCalled()
  })

  test('rejects linked history items so existing ai_tasks activity remains primary', async () => {
    getAiHistoryItemForUserMock.mockResolvedValue({
      ...baseItem,
      linked_ai_task_id: 'ai-task-1',
    } as never)

    const response = await POST(request({
      runner_id: 'runner-1',
      messages: [{
        sequence: 0,
        role: 'assistant',
        kind: 'assistant_answer',
        body: '表示用だけ',
      }],
    }), { params: Promise.resolve({ id: 'history-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.code).toBe('linked_ai_task_activity_primary')
    expect(upsertAiHistoryDetailMessagesMock).not.toHaveBeenCalled()
  })
})
