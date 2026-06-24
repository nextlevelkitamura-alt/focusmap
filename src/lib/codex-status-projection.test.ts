import { describe, expect, test } from 'vitest'
import {
  isUsableCodexSourceTaskRecord,
  taskCodexStatusFromAiHistory,
  taskCodexStatusFromAiTaskState,
} from './codex-status-projection'

describe('codex-status-projection', () => {
  test('maps a finished Codex turn to review instead of source task done', () => {
    expect(taskCodexStatusFromAiHistory({ status: 'completed' })).toBe('awaiting_approval')
    expect(taskCodexStatusFromAiTaskState({ status: 'completed' })).toBe('awaiting_approval')
  })

  test('projects running, review, failed, and archived states', () => {
    expect(taskCodexStatusFromAiHistory({ status: 'running' })).toBe('running')
    expect(taskCodexStatusFromAiHistory({ status: 'needs_input' })).toBe('awaiting_approval')
    expect(taskCodexStatusFromAiHistory({ status: 'failed' })).toBe('failed')
    expect(taskCodexStatusFromAiHistory({ status: 'running', archived: true })).toBe('archived')

    expect(taskCodexStatusFromAiTaskState({
      status: 'running',
      result: { codex_run_state: 'stale_no_terminal_event' },
    })).toBe('awaiting_approval')
    expect(taskCodexStatusFromAiTaskState({
      status: 'running',
      result: { codex_thread_archived: true },
    })).toBe('archived')
  })

  test('skips deleted and legacy Codex Inbox source tasks', () => {
    expect(isUsableCodexSourceTaskRecord({ id: 'task-1', source: 'codex_app_thread', deleted_at: null })).toBe(true)
    expect(isUsableCodexSourceTaskRecord({ id: 'task-1', source: 'codex_inbox', deleted_at: null })).toBe(false)
    expect(isUsableCodexSourceTaskRecord({ id: 'task-1', source: 'codex_app_thread', deleted_at: '2026-06-25' })).toBe(false)
  })
})
