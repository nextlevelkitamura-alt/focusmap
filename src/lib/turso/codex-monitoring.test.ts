import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(() => Promise.resolve({ rows: [] })),
}))

vi.mock('./client', () => ({
  getTursoClient: () => ({ execute: mockExecute }),
  jsonOrNull: (value: unknown) => value == null ? null : JSON.stringify(value),
  parseJsonRecord: (value: unknown) => {
    if (typeof value !== 'string' || !value) return null
    return JSON.parse(value) as Record<string, unknown>
  },
}))

describe('upsertTursoAiTask', () => {
  beforeEach(() => {
    mockExecute.mockClear()
  })

  test('keeps the first started_at once the Turso row has one', async () => {
    const { upsertTursoAiTask } = await import('./codex-monitoring')

    await upsertTursoAiTask({
      id: 'task-1',
      user_id: 'user-1',
      status: 'running',
      started_at: '2026-06-19T00:00:05.000Z',
    })

    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining('started_at = COALESCE(ai_tasks.started_at, excluded.started_at)'),
    }))
  })
})
