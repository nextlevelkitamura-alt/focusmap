import { describe, expect, test } from 'vitest'
import { AI_TASK_LIST_SELECT, AI_TASK_STATUS_SELECT, compactAiTask } from './route'

describe('/api/ai-tasks compact result fields', () => {
  test('selects Codex turn timing fields in both list and status views', () => {
    expect(AI_TASK_LIST_SELECT).toContain('result_codex_turn_started_at:result->>codex_turn_started_at')
    expect(AI_TASK_LIST_SELECT).toContain('result_codex_turn_completed_at:result->>codex_turn_completed_at')
    expect(AI_TASK_STATUS_SELECT).toContain('result_codex_turn_started_at:result->>codex_turn_started_at')
    expect(AI_TASK_STATUS_SELECT).toContain('result_codex_turn_completed_at:result->>codex_turn_completed_at')
  })

  test('compacts Codex turn timing into result for UI consumers', () => {
    const compacted = compactAiTask({
      id: 'task-1',
      source_task_id: 'node-1',
      result_codex_turn_started_at: '2026-06-19T00:00:00.000Z',
      result_codex_turn_completed_at: '2026-06-19T00:02:45.000Z',
      result_last_activity_at: '2026-06-19T00:03:00.000Z',
    })

    expect(compacted).toEqual({
      id: 'task-1',
      source_task_id: 'node-1',
      result: {
        codex_turn_started_at: '2026-06-19T00:00:00.000Z',
        codex_turn_completed_at: '2026-06-19T00:02:45.000Z',
        last_activity_at: '2026-06-19T00:03:00.000Z',
      },
    })
  })
})
