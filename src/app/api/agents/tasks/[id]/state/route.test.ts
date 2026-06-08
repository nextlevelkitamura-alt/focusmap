import { describe, expect, test } from 'vitest'
import { isClaimedByOtherActiveRunner } from './route'

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
