import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  mockExecFile,
  mockExistsSync,
  mockReadFileSync,
  mockInsertActivity,
  mockUpsertTursoAiTask,
  mockInsertTaskEvent,
  mockSupabase,
  setAiTask,
  setSourceTask,
  setThreadRow,
  setRolloutRaw,
  setAiTaskUpdateError,
  getAiTaskUpdates,
  getSourceTaskUpdates,
  resetState,
} = vi.hoisted(() => {
  let aiTask: Record<string, unknown> | null = null
  let sourceTask: Record<string, unknown> | null = null
  let threadRow: Record<string, unknown> | null = null
  let sourceTaskUpdateId: string | null = null
  let aiTaskUpdateError: { message: string } | null = null
  const aiTaskUpdates: Record<string, unknown>[] = []
  const sourceTaskUpdates: Array<{ id: string | null; payload: Record<string, unknown> }> = []
  let rolloutRaw = ''

  const thenable = <T,>(value: T) => ({
    then: (
      resolve: (value: T) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(value).then(resolve, reject),
  })

  const aiTasksTable = {
    select: () => {
      const builder: Record<string, unknown> = {}
      builder.eq = () => builder
      builder.in = () => builder
      builder.order = () => builder
      builder.limit = () => builder
      builder.then = (
        resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: aiTask ? [aiTask] : [], error: null }).then(resolve, reject)
      return builder
    },
    update: (payload: Record<string, unknown>) => {
      aiTaskUpdates.push(payload)
      const builder: Record<string, unknown> = {}
      builder.eq = () => thenable({ error: aiTaskUpdateError })
      return builder
    },
  }

  const tasksTable = {
    select: () => {
      const builder: Record<string, unknown> = {}
      builder.eq = (column: string, value: string) => {
        if (column === 'id') sourceTaskUpdateId = value
        return builder
      }
      builder.is = () => builder
      builder.maybeSingle = () => Promise.resolve({ data: sourceTask, error: null })
      return builder
    },
    update: (payload: Record<string, unknown>) => {
      const builder: Record<string, unknown> = {}
      builder.eq = (column: string, value: string) => {
        if (column === 'id') sourceTaskUpdateId = value
        return builder
      }
      builder.is = () => {
        sourceTaskUpdates.push({ id: sourceTaskUpdateId, payload })
        return thenable({ error: null })
      }
      return builder
    },
  }

  const mockExecFile = vi.fn((
    _bin: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: { stdout: string; stderr: string }, stderr: string) => void,
  ) => {
    const stdout = threadRow ? JSON.stringify([threadRow]) : '[]'
    callback(null, { stdout, stderr: '' }, '')
  })

  const mockSupabase = {
    from: (table: string) => {
      if (table === 'ai_tasks') return aiTasksTable
      if (table === 'tasks') return tasksTable
      throw new Error(`Unexpected table ${table}`)
    },
  }

  return {
    mockExecFile,
    mockExistsSync: vi.fn(() => true),
    mockReadFileSync: vi.fn(() => rolloutRaw),
    mockInsertActivity: vi.fn(() => Promise.resolve({ inserted: true })),
    mockUpsertTursoAiTask: vi.fn(() => Promise.resolve()),
    mockInsertTaskEvent: vi.fn(() => Promise.resolve()),
    mockSupabase,
    setAiTask: (value: Record<string, unknown>) => { aiTask = value },
    setSourceTask: (value: Record<string, unknown> | null) => { sourceTask = value },
    setThreadRow: (value: Record<string, unknown> | null) => { threadRow = value },
    setRolloutRaw: (value: string) => { rolloutRaw = value },
    setAiTaskUpdateError: (value: { message: string } | null) => { aiTaskUpdateError = value },
    getAiTaskUpdates: () => aiTaskUpdates,
    getSourceTaskUpdates: () => sourceTaskUpdates,
    resetState: () => {
      aiTask = null
      sourceTask = null
      threadRow = null
      sourceTaskUpdateId = null
      aiTaskUpdateError = null
      aiTaskUpdates.length = 0
      sourceTaskUpdates.length = 0
      rolloutRaw = ''
      mockExecFile.mockClear()
      mockExistsSync.mockClear()
      mockReadFileSync.mockClear()
      mockInsertActivity.mockClear()
      mockUpsertTursoAiTask.mockClear()
      mockInsertTaskEvent.mockClear()
    },
  }
})

vi.mock('child_process', () => ({
  default: {
    execFile: mockExecFile,
  },
  execFile: mockExecFile,
}))

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
}))

vi.mock('os', () => ({
  default: {
    homedir: () => '/Users/test',
  },
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock('@/lib/auth/verify-supabase-jwt', () => ({
  authenticateSupabaseRequest: vi.fn(() => Promise.resolve({ user: { id: 'user-1' } })),
}))

vi.mock('@/lib/turso/client', () => ({
  isTursoConfigured: vi.fn(() => false),
}))

vi.mock('@/lib/turso/codex-monitoring', () => ({
  upsertTursoAiTask: mockUpsertTursoAiTask,
  insertTaskEvent: mockInsertTaskEvent,
}))

vi.mock('@/lib/ai-task-activity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-task-activity')>('@/lib/ai-task-activity')
  return {
    ...actual,
    insertAiTaskActivityMessage: mockInsertActivity,
  }
})

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ai-task-1',
    user_id: 'user-1',
    space_id: null,
    prompt: '調べて',
    codex_thread_id: 'thread-1',
    cwd: '/repo',
    result: {
      codex_thread_id: 'thread-1',
      codex_run_state: 'running',
      codex_manual_handoff: true,
    },
    status: 'running',
    started_at: '2026-06-07T00:00:00.000Z',
    created_at: '2026-06-07T00:00:00.000Z',
    source_task_id: 'source-task-1',
    executor: 'codex_app',
    ...overrides,
  }
}

function postRequest(
  url = 'http://localhost:3001/api/codex/sync-node',
  body: Record<string, unknown> = { ai_task_id: 'ai-task-1' },
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('/api/codex/sync-node Codex thread closure', () => {
  beforeEach(() => {
    resetState()
    vi.resetModules()
    process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_SYNC = 'true'
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    setAiTask(baseTask())
    setSourceTask({ id: 'source-task-1', status: 'todo', stage: 'plan' })
  })

  test('marks the ai task completed and checks the source node when the Codex thread is archived', async () => {
    setThreadRow({
      id: 'thread-1',
      title: '調べて',
      tokens_used: 10,
      has_user_event: 1,
      archived: 1,
      updated_at_ms: Date.parse('2026-06-07T00:01:00.000Z'),
      preview: 'done',
      rollout_path: '/tmp/rollout.jsonl',
      source: 'codex_app',
      cwd: '/repo',
      first_user_message: '調べて',
    })

    const { POST } = await import('./route')
    const response = await POST(postRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.state).toBe('completed')
    expect(json.source_task_completed).toBe(true)
    expect(getSourceTaskUpdates()).toEqual([
      {
        id: 'source-task-1',
        payload: expect.objectContaining({ status: 'done', stage: 'done' }),
      },
    ])
    expect(getAiTaskUpdates()[0]).toEqual(expect.objectContaining({
      status: 'completed',
      codex_thread_id: 'thread-1',
    }))
    expect(getAiTaskUpdates()[0].result).toEqual(expect.objectContaining({
      codex_review_reason: 'archived',
      codex_source_task_completed: true,
      codex_source_task_id: 'source-task-1',
    }))
    expect(mockInsertActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'completed',
      dedupeKey: 'thread:thread-1:closed:archived',
    }))
  })

  test('marks the ai task completed and checks the source node when the Codex thread was deleted', async () => {
    setThreadRow(null)

    const { POST } = await import('./route')
    const response = await POST(postRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.state).toBe('completed')
    expect(json.source_task_completed).toBe(true)
    expect(getSourceTaskUpdates()).toEqual([
      {
        id: 'source-task-1',
        payload: expect.objectContaining({ status: 'done', stage: 'done' }),
      },
    ])
    expect(getAiTaskUpdates()[0]).toEqual(expect.objectContaining({
      status: 'completed',
      codex_thread_id: 'thread-1',
    }))
    expect(getAiTaskUpdates()[0].result).toEqual(expect.objectContaining({
      codex_review_reason: 'thread_deleted',
      codex_source_task_completed: true,
      codex_source_task_id: 'source-task-1',
    }))
    expect(mockInsertActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'completed',
      dedupeKey: 'thread:thread-1:closed:thread_deleted',
    }))
  })

  test('does not rewrite database rows after an archived thread closure is already persisted', async () => {
    setAiTask(baseTask({
      status: 'completed',
      result: {
        codex_thread_id: 'thread-1',
        codex_run_state: 'awaiting_approval',
        codex_review_reason: 'archived',
        codex_source_task_completed: true,
        codex_source_task_id: 'source-task-1',
      },
    }))
    setThreadRow({
      id: 'thread-1',
      title: '調べて',
      tokens_used: 10,
      has_user_event: 1,
      archived: 1,
      updated_at_ms: Date.parse('2026-06-07T00:01:00.000Z'),
      preview: 'done',
      rollout_path: '/tmp/rollout.jsonl',
      source: 'codex_app',
      cwd: '/repo',
      first_user_message: '調べて',
    })

    const { POST } = await import('./route')
    const response = await POST(postRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.state).toBe('completed')
    expect(json.persisted).toBe(false)
    expect(getSourceTaskUpdates()).toEqual([])
    expect(getAiTaskUpdates()).toEqual([])
    expect(mockUpsertTursoAiTask).not.toHaveBeenCalled()
    expect(mockInsertActivity).not.toHaveBeenCalled()
  })

  test('does not rewrite database rows after a deleted thread closure with no source node is already persisted', async () => {
    setAiTask(baseTask({
      status: 'completed',
      source_task_id: null,
      result: {
        codex_thread_id: 'thread-1',
        codex_run_state: 'awaiting_approval',
        codex_review_reason: 'thread_deleted',
        codex_source_task_completed: false,
      },
    }))
    setThreadRow(null)

    const { POST } = await import('./route')
    const response = await POST(postRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.state).toBe('completed')
    expect(json.persisted).toBe(false)
    expect(getSourceTaskUpdates()).toEqual([])
    expect(getAiTaskUpdates()).toEqual([])
    expect(mockUpsertTursoAiTask).not.toHaveBeenCalled()
    expect(mockInsertActivity).not.toHaveBeenCalled()
  })

  test('syncs a short manual Codex reply from a Mac .local preview host', async () => {
    process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_SYNC = 'false'
    setAiTask(baseTask({
      prompt: 'アンドラ',
      codex_thread_id: null,
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'prompt_waiting',
      },
      status: 'needs_input',
      started_at: '2026-06-07T02:30:55.000+09:00',
      created_at: '2026-06-07T02:30:55.000+09:00',
    }))
    setThreadRow({
      id: '019e9dfc-b4de-7033-a473-69f007ff0823',
      title: 'アンドラ',
      tokens_used: 78,
      has_user_event: 0,
      archived: 0,
      updated_at_ms: Date.parse('2026-06-07T02:31:01.846+09:00'),
      preview: 'アンドラ',
      rollout_path: '/tmp/andorra-rollout.jsonl',
      source: 'vscode',
      cwd: '/repo',
      first_user_message: 'アンドラ',
    })
    setRolloutRaw([
      JSON.stringify({
        timestamp: '2026-06-06T17:30:55.420Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'アンドラ' },
      }),
      JSON.stringify({
        timestamp: '2026-06-06T17:31:01.798Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'アンドラについて、何を調べたいですか？\n\n例: 国の概要、旅行、税制、移住、場所、首都、治安、観光地など。',
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-06T17:31:01.846Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          last_agent_message: 'アンドラについて、何を調べたいですか？\n\n例: 国の概要、旅行、税制、移住、場所、首都、治安、観光地など。',
        },
      }),
    ].join('\n'))

    const { POST } = await import('./route')
    const response = await POST(postRequest('http://naononmac.local:3001/api/codex/sync-node', {
      ai_task_id: 'ai-task-1',
      include_visible_activity: true,
    }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.state).toBe('awaiting_approval')
    expect(getAiTaskUpdates()[0]).toEqual(expect.objectContaining({
      status: 'awaiting_approval',
      codex_thread_id: '019e9dfc-b4de-7033-a473-69f007ff0823',
    }))
    expect(getAiTaskUpdates()[0].result).toEqual(expect.objectContaining({
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'completed',
      progress_summary: expect.objectContaining({
        state: 'needs_review',
        current_step: '完了確認',
        can_mark_completed: true,
      }),
      codex_visible_messages: [expect.objectContaining({
        role: 'codex',
        kind: 'question',
        body: expect.stringContaining('アンドラについて'),
      })],
    }))
    expect(mockInsertActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'question',
      body: expect.stringContaining('アンドラについて'),
      createdAt: '2026-06-06T17:31:01.798Z',
    }))
  })

  test('allows local sync through the Host header when nextUrl is a dev bind host', async () => {
    process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_SYNC = 'false'
    setThreadRow({
      id: 'thread-1',
      title: '調べて',
      tokens_used: 10,
      has_user_event: 1,
      archived: 0,
      updated_at_ms: Date.parse('2026-06-07T00:01:00.000Z'),
      preview: 'done',
      rollout_path: '/tmp/rollout.jsonl',
      source: 'codex_app',
      cwd: '/repo',
      first_user_message: '調べて',
    })
    setRolloutRaw(JSON.stringify({
      timestamp: '2026-06-07T00:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '作業中です' },
    }))

    const { POST } = await import('./route')
    const response = await POST(postRequest('http://0.0.0.0:3001/api/codex/sync-node', {
      ai_task_id: 'ai-task-1',
    }, {
      host: 'localhost:3001',
    }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.synced).toBe(true)
  })

  test('refreshes stale progress summary even when status and thread are unchanged', async () => {
    setAiTask(baseTask({
      status: 'awaiting_approval',
      codex_thread_id: 'thread-1',
      result: {
        codex_manual_handoff: true,
        codex_thread_id: 'thread-1',
        codex_run_state: 'awaiting_approval',
        codex_review_reason: 'completed',
        current_step: '完了確認',
        progress_summary: {
          state: 'needs_review',
          current_step: 'ChatGPT/Codexアプリで確認待ち',
          summary: '古いhandoff文',
          can_mark_completed: false,
          last_activity_at: '2026-06-07T09:04:03.000Z',
          session_health: 'transcript_only',
        },
      },
    }))
    setThreadRow({
      id: 'thread-1',
      title: '調べて',
      tokens_used: 10,
      has_user_event: 1,
      archived: 0,
      updated_at_ms: Date.parse('2026-06-07T09:04:16.000Z'),
      preview: '調べて',
      rollout_path: '/tmp/rollout.jsonl',
      source: 'codex_app',
      cwd: '/repo',
      first_user_message: '調べて',
    })
    setRolloutRaw(JSON.stringify({
      timestamp: '2026-06-07T09:04:16.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', last_agent_message: '調査しました。' },
    }))

    const { POST } = await import('./route')
    const response = await POST(postRequest('http://localhost:3001/api/codex/sync-node', {
      ai_task_id: 'ai-task-1',
      include_visible_activity: true,
    }))

    expect(response.status).toBe(200)
    expect(getAiTaskUpdates()[0].result).toEqual(expect.objectContaining({
      progress_summary: expect.objectContaining({
        current_step: '完了確認',
        summary: expect.stringContaining('Codex.appは確認待ちです'),
        can_mark_completed: true,
        session_health: 'stopped',
      }),
    }))
  })

  test('returns an error instead of pretending sync succeeded when ai_tasks update fails', async () => {
    setAiTask(baseTask({
      codex_thread_id: null,
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'awaiting_approval',
        awaiting_approval_at: '2026-06-07T09:04:03.000Z',
      },
      status: 'awaiting_approval',
    }))
    setThreadRow({
      id: 'thread-1',
      title: '調べて',
      tokens_used: 10,
      has_user_event: 1,
      archived: 0,
      updated_at_ms: Date.parse('2026-06-07T09:04:16.000Z'),
      preview: '調べて',
      rollout_path: '/tmp/rollout.jsonl',
      source: 'codex_app',
      cwd: '/repo',
      first_user_message: '調べて',
    })
    setRolloutRaw([
      JSON.stringify({
        timestamp: '2026-06-07T09:04:11.000Z',
        type: 'event_msg',
        payload: { type: 'task_started' },
      }),
      JSON.stringify({
        timestamp: '2026-06-07T09:04:16.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: '調査しました。' },
      }),
    ].join('\n'))
    setAiTaskUpdateError({ message: 'Service for this project is restricted' })

    const { POST } = await import('./route')
    const response = await POST(postRequest('http://localhost:3001/api/codex/sync-node', {
      ai_task_id: 'ai-task-1',
      include_visible_activity: true,
    }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBe('Codex state update failed')
    expect(getAiTaskUpdates()[0]).toEqual(expect.objectContaining({
      codex_thread_id: 'thread-1',
    }))
    expect(mockInsertActivity).not.toHaveBeenCalled()
  })
})
