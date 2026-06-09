import { describe, expect, test } from 'vitest'
import { isClaimedByOtherActiveRunner, shouldCompleteSourceTaskFromAgentState } from './route'

describe('isClaimedByOtherActiveRunner', () => {
  test('allows unclaimed tasks and tasks claimed by the same runner', () => {
    expect(isClaimedByOtherActiveRunner({}, 'runner-a')).toBe(false)
    expect(isClaimedByOtherActiveRunner({
      claimed_runner_id: 'runner-a',
      claim_expires_at: '2030-01-01T00:00:00.000Z',
    }, 'runner-a')).toBe(false)
  })

  test('blocks active claims from another runner', () => {
    const nowMs = Date.parse('2026-06-09T00:00:00.000Z')
    expect(isClaimedByOtherActiveRunner({
      claimed_runner_id: 'runner-b',
      claim_expires_at: '2026-06-09T00:05:00.000Z',
    }, 'runner-a', nowMs)).toBe(true)
  })

  test('allows expired claims from another runner so monitors can recover stale Codex tasks', () => {
    const nowMs = Date.parse('2026-06-09T00:00:00.000Z')
    expect(isClaimedByOtherActiveRunner({
      claimed_runner_id: 'runner-b',
      claim_expires_at: '2026-06-08T23:55:00.000Z',
    }, 'runner-a', nowMs)).toBe(false)
  })
})

describe('shouldCompleteSourceTaskFromAgentState', () => {
  test('only lets archived Codex thread completion check the source node', () => {
    expect(shouldCompleteSourceTaskFromAgentState({
      status: 'completed',
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'archived',
        codex_source_task_completed: true,
      },
    })).toBe(true)

    expect(shouldCompleteSourceTaskFromAgentState({
      status: 'completed',
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'completed',
        codex_source_task_completed: true,
      },
    })).toBe(false)

    expect(shouldCompleteSourceTaskFromAgentState({
      status: 'completed',
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'thread_deleted',
        codex_source_task_completed: true,
      },
    })).toBe(false)
  })
})
