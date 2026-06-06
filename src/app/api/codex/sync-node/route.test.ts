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
  getAiTaskUpdates,
  getSourceTaskUpdates,
  resetState,
} = vi.hoisted(() => {
  let aiTask: Record<string, unknown> | null = null
  let sourceTask: Record<string, unknown> | null = null
  let threadRow: Record<string, unknown> | null = null
  let sourceTaskUpdateId: string | null = null
  const aiTaskUpdates: Record<string, unknown>[] = []
  const sourceTaskUpdates: Array<{ id: string | null; payload: Record<string, unknown> }> = []

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
      builder.eq = () => thenable({ error: null })
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
    mockReadFileSync: vi.fn(() => ''),
    mockInsertActivity: vi.fn(() => Promise.resolve({ inserted: true })),
    mockUpsertTursoAiTask: vi.fn(() => Promise.resolve()),
    mockInsertTaskEvent: vi.fn(() => Promise.resolve()),
    mockSupabase,
    setAiTask: (value: Record<string, unknown>) => { aiTask = value },
    setSourceTask: (value: Record<string, unknown> | null) => { sourceTask = value },
    setThreadRow: (value: Record<string, unknown> | null) => { threadRow = value },
    getAiTaskUpdates: () => aiTaskUpdates,
    getSourceTaskUpdates: () => sourceTaskUpdates,
    resetState: () => {
      aiTask = null
      sourceTask = null
      threadRow = null
      sourceTaskUpdateId = null
      aiTaskUpdates.length = 0
      sourceTaskUpdates.length = 0
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

function postRequest() {
  return new NextRequest('http://localhost:3001/api/codex/sync-node', {
    method: 'POST',
    body: JSON.stringify({ ai_task_id: 'ai-task-1' }),
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
})
