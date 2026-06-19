import { describe, expect, test } from 'vitest'
import {
  normalizeAiTaskStartedAt,
  resolveRunningStartedAt,
  shouldInitializeRunningStartedAt,
} from './ai-task-run-timing'

describe('ai-task-run-timing', () => {
  test('keeps the first valid started_at while a task remains running', () => {
    const startedAt = '2026-06-19T01:00:00.000Z'
    const nowIso = '2026-06-19T01:03:00.000Z'

    expect(resolveRunningStartedAt(startedAt, nowIso)).toBe(startedAt)
    expect(shouldInitializeRunningStartedAt(startedAt)).toBe(false)
  })

  test('initializes started_at when a running task does not have one', () => {
    const nowIso = '2026-06-19T01:03:00.000Z'

    expect(resolveRunningStartedAt(null, nowIso)).toBe(nowIso)
    expect(resolveRunningStartedAt('', nowIso)).toBe(nowIso)
    expect(shouldInitializeRunningStartedAt(null)).toBe(true)
    expect(shouldInitializeRunningStartedAt('')).toBe(true)
  })

  test('treats invalid started_at as missing', () => {
    const nowIso = '2026-06-19T01:03:00.000Z'

    expect(normalizeAiTaskStartedAt('not-a-date')).toBeNull()
    expect(resolveRunningStartedAt('not-a-date', nowIso)).toBe(nowIso)
    expect(shouldInitializeRunningStartedAt('not-a-date')).toBe(true)
  })
})
