import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TursoAiHistoryItem } from './ai-history'

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('./client', () => ({
  getTursoClient: () => ({ execute: mockExecute }),
  jsonOrNull: (value: unknown) => value == null ? null : JSON.stringify(value),
  parseJsonRecord: (value: unknown) => {
    if (typeof value !== 'string' || !value) return null
    return JSON.parse(value) as Record<string, unknown>
  },
}))

describe('AI history detail cache helpers', () => {
  beforeEach(() => {
    mockExecute.mockReset()
    mockExecute.mockImplementation(({ sql }: { sql: string }) => (
      Promise.resolve(sql.includes('COUNT(*) AS count') ? { rows: [{ count: 1 }] } : { rows: [] })
    ))
  })

  test('maps provider-generic detail messages to activity-compatible response messages', async () => {
    const { toAiHistoryDetailActivityMessage } = await import('./ai-history')

    expect(toAiHistoryDetailActivityMessage({
      id: 'detail-1',
      user_id: 'user-1',
      history_item_id: 'history-1',
      provider: 'codex_app',
      external_thread_id: 'thread-1',
      repo_path: '/repo',
      sequence: 2,
      role: 'assistant',
      kind: 'assistant_answer',
      body: '実装しました',
      body_hash: 'hash-1',
      occurred_at: '2026-06-20T00:00:01.000Z',
      metadata_json: { source: 'rollout_visible' },
      created_at: '2026-06-20T00:00:02.000Z',
      updated_at: '2026-06-20T00:00:03.000Z',
    })).toMatchObject({
      id: 'detail-1',
      task_id: 'history-1',
      role: 'codex',
      detail_role: 'assistant',
      kind: 'completed',
      detail_kind: 'assistant_answer',
      metadata: {
        source: 'rollout_visible',
        detailRole: 'assistant',
        detailKind: 'assistant_answer',
        detailSequence: 2,
      },
      created_at: '2026-06-20T00:00:01.000Z',
    })
  })

  test('requires hydrate when an unlinked item has no cache or stale cache', async () => {
    const { isAiHistoryDetailHydrateRequired } = await import('./ai-history')

    expect(isAiHistoryDetailHydrateRequired({
      linked_ai_task_id: null,
      last_activity_at: '2026-06-20T00:00:10.000Z',
      detail_synced_at: null,
      detail_message_count: 0,
    })).toBe(true)

    expect(isAiHistoryDetailHydrateRequired({
      linked_ai_task_id: null,
      last_activity_at: '2026-06-20T00:00:10.000Z',
      detail_synced_at: '2026-06-20T00:00:01.000Z',
      detail_message_count: 2,
    })).toBe(true)

    expect(isAiHistoryDetailHydrateRequired({
      linked_ai_task_id: 'ai-task-1',
      last_activity_at: '2026-06-20T00:00:10.000Z',
      detail_synced_at: null,
      detail_message_count: 0,
    })).toBe(false)
  })

  test('upserts sanitized display messages and refreshes history detail summary', async () => {
    const { hashAiHistoryDetailBody, upsertAiHistoryDetailMessages } = await import('./ai-history')

    const result = await upsertAiHistoryDetailMessages({
      userId: 'user-1',
      historyItemId: 'history-1',
      provider: 'codex_app',
      externalThreadId: 'thread-1',
      repoPath: '/repo',
      detailSyncedAt: '2026-06-20T00:01:00.000Z',
      messages: [{
        sequence: 1,
        role: 'assistant',
        kind: 'assistant_answer',
        body: '  実装しました  ',
        occurred_at: '2026-06-20T00:00:01.000Z',
        metadata_json: { source: 'visible' },
      }],
    })

    const insertCall = mockExecute.mock.calls[0]?.[0] as { sql: string; args: unknown[] }
    expect(insertCall.sql).toContain('INSERT INTO ai_history_detail_messages')
    expect(insertCall.args).toEqual(expect.arrayContaining([
      'user-1',
      'history-1',
      'codex_app',
      'thread-1',
      '/repo',
      1,
      'assistant',
      'assistant_answer',
      '実装しました',
      hashAiHistoryDetailBody('実装しました'),
    ]))
    expect((mockExecute.mock.calls[1]?.[0] as { sql: string }).sql).toContain('UPDATE ai_history_items')
    expect(result).toEqual({
      upserted: 1,
      detailSyncedAt: '2026-06-20T00:01:00.000Z',
      messageCount: 1,
    })
  })

  test('returns the actual ai_history_items id from metadata upsert', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 'history-existing' }] })
    const { upsertAiHistoryItem } = await import('./ai-history')

    await expect(upsertAiHistoryItem({
      user_id: 'user-1',
      provider: 'codex_app',
      external_thread_id: 'thread-1',
      repo_path: '/repo',
      title: '履歴',
      status: 'completed',
      last_activity_at: '2026-06-20T00:00:00.000Z',
    })).resolves.toBe('history-existing')

    const sql = (mockExecute.mock.calls[0]?.[0] as { sql: string }).sql
    expect(sql).toContain('RETURNING id')
    expect(sql).toContain('started_at = excluded.started_at')
    expect(sql).toContain('ended_at = excluded.ended_at')
    expect(sql).toContain('work_duration_seconds = excluded.work_duration_seconds')
    expect(sql).toContain('WHEN (excluded.title = ? OR ?)')
    expect(sql).toContain("json_extract(ai_history_items.metadata_json, '$.title_source')")
    expect(sql).toContain('OR ?')
    expect(sql).toContain('THEN ai_history_items.title')
    expect(sql).toContain('THEN ai_history_items.metadata_json')
    const args = (mockExecute.mock.calls[0]?.[0] as { args: unknown[] }).args
    expect(args.slice(-7)).toEqual([
      0,
      '新しいチャット',
      0,
      '新しいチャット',
      '新しいチャット',
      0,
      '新しいチャット',
    ])
  })

  test('keeps parent repo labels separate from the scanned worktree path', async () => {
    const { toAiHistoryListItem } = await import('./ai-history')

    const item: TursoAiHistoryItem = {
      id: 'history-1',
      user_id: 'user-1',
      provider: 'codex_app',
      external_thread_id: 'thread-1',
      repo_path: '/Users/me/focusmap',
      worktree_path: '/Users/me/focusmap-codex-reconcile-main',
      project_id: 'project-1',
      source_task_id: null,
      linked_ai_task_id: null,
      title: '履歴',
      snippet: null,
      status: 'awaiting_approval',
      run_state: null,
      last_activity_at: '2026-06-20T00:00:00.000Z',
      indexed_at: '2026-06-20T00:00:01.000Z',
      started_at: null,
      ended_at: null,
      work_duration_seconds: null,
      archived: false,
      archived_at: null,
      deleted_at: null,
      detail_synced_at: null,
      detail_message_count: null,
      metadata_json: null,
      created_at: '2026-06-20T00:00:01.000Z',
      updated_at: '2026-06-20T00:00:01.000Z',
    }

    expect(toAiHistoryListItem(item, new Map([['/Users/me/focusmap', 'focusmap']]))).toMatchObject({
      repoPath: '/Users/me/focusmap',
      repoLabel: 'focusmap',
      worktreePath: '/Users/me/focusmap-codex-reconcile-main',
    })
  })

  test('uses a generic new-chat title when a stored history title is missing', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'history-untitled',
        user_id: 'user-1',
        provider: 'codex_app',
        external_thread_id: '019eed07-0217-7a53-90aa-706b29a08df9',
        repo_path: '/repo',
        project_id: 'project-1',
        title: null,
        status: 'awaiting_approval',
        last_activity_at: '2026-06-22T00:00:00.000Z',
        indexed_at: '2026-06-22T00:00:00.000Z',
      }],
    })
    const { listAiHistoryItems } = await import('./ai-history')

    await expect(listAiHistoryItems({
      userId: 'user-1',
      projectId: 'project-1',
    })).resolves.toEqual([
      expect.objectContaining({
        external_thread_id: '019eed07-0217-7a53-90aa-706b29a08df9',
        title: '新しいチャット',
      }),
    ])
  })

  test('filters project-scope history by repo_path instead of thread project_id', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] })
    const { listAiHistoryItems } = await import('./ai-history')

    await listAiHistoryItems({
      userId: 'user-1',
      projectId: 'project-1',
      scope: 'project',
      repoPaths: ['/repo'],
    })

    const call = mockExecute.mock.calls[0]?.[0] as { sql: string; args: unknown[] }
    expect(call.sql).toContain('repo_path IN (?)')
    expect(call.sql).not.toContain('project_id = ?')
    expect(call.args).toEqual(expect.arrayContaining(['user-1', '/repo']))
  })

  test('returns an empty project-scope query when the project has no repo_path', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] })
    const { listAiHistoryItems } = await import('./ai-history')

    await listAiHistoryItems({
      userId: 'user-1',
      projectId: 'project-1',
      scope: 'project',
      repoPaths: [],
    })

    const call = mockExecute.mock.calls[0]?.[0] as { sql: string; args: unknown[] }
    expect(call.sql).toContain('0 = 1')
    expect(call.sql).not.toContain('project_id = ?')
    expect(call.args).not.toContain('project-1')
  })

  test('records hydrate requests without refreshing an active unexpired request', async () => {
    const { upsertAiHistoryDetailHydrateRequest } = await import('./ai-history')

    await upsertAiHistoryDetailHydrateRequest({
      userId: 'user-1',
      item: {
        id: 'history-1',
        provider: 'codex_app',
        external_thread_id: 'thread-1',
        repo_path: '/repo',
      },
      reason: 'detail_cache_empty',
      ttlSeconds: 120,
    })

    const call = mockExecute.mock.calls[0]?.[0] as { sql: string; args: unknown[] }
    expect(call.sql).toContain('INSERT INTO ai_history_detail_hydrate_requests')
    expect(call.sql).toContain('WHERE ? = 1')
    expect(call.sql).toContain('OR ai_history_detail_hydrate_requests.expires_at < ?')
    expect(call.args).toEqual(expect.arrayContaining([
      'user-1',
      'history-1',
      'codex_app',
      'thread-1',
      '/repo',
      'detail_cache_empty',
      'web',
    ]))
  })

  test('can refresh an active hydrate request TTL for an explicit watch request', async () => {
    const { upsertAiHistoryDetailHydrateRequest } = await import('./ai-history')

    await upsertAiHistoryDetailHydrateRequest({
      userId: 'user-1',
      item: {
        id: 'history-1',
        provider: 'codex_app',
        external_thread_id: 'thread-1',
        repo_path: '/repo',
      },
      reason: 'detail_cache_stale',
      ttlSeconds: 120,
      refreshActive: true,
    })

    const call = mockExecute.mock.calls[0]?.[0] as { args: unknown[] }
    expect(call.args.at(-2)).toBe(1)
  })
})
