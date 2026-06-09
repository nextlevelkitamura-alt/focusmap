import { describe, expect, test } from 'vitest'
import { hasPendingCodexArchiveRequest, shouldReturnCodexMonitorTask } from './route'

describe('shouldReturnCodexMonitorTask', () => {
  test('returns tasks that already have a Codex thread id', () => {
    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      codex_thread_id: '019ea7d8-8e53-7413-a548-739b19820e6c',
      result: null,
    })).toBe(true)

    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      result: { codex_thread_id: '019ea7d8-8e53-7413-a548-739b19820e6c' },
    })).toBe(true)
  })

  test('returns recent manual handoff tasks so the Mac agent can discover the first thread', () => {
    const recentIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()

    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      prompt: 'あなまたけに',
      started_at: recentIso,
      created_at: recentIso,
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'prompt_waiting',
      },
    })).toBe(true)
  })

  test('does not scan stale or non-manual tasks without a thread id', () => {
    const recentIso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      prompt: '古い送信待ち',
      started_at: oldIso,
      created_at: oldIso,
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'prompt_waiting',
      },
    })).toBe(false)

    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      prompt: '自動実行待ち',
      started_at: recentIso,
      created_at: recentIso,
      result: {
        codex_manual_handoff: false,
        codex_run_state: 'prompt_waiting',
      },
    })).toBe(false)
  })

  test('does not keep scanning closed threads that should stay in review', () => {
    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      codex_thread_id: 'thread-deleted',
      result: {
        codex_review_reason: 'thread_deleted',
      },
    })).toBe(false)

    expect(shouldReturnCodexMonitorTask({
      executor: 'codex_app',
      codex_thread_id: 'thread-archived',
      result: {
        codex_review_reason: 'archived',
        codex_source_task_completion_suppressed: true,
      },
    })).toBe(false)
  })

  test('only returns completed tasks when a Codex archive request is pending', () => {
    const pendingRequest = {
      status: 'completed',
      executor: 'codex_app',
      source_task_id: 'task-1',
      codex_thread_id: 'thread-1',
      result: {
        codex_source_task_completed: true,
        codex_archive_request_state: 'pending',
        codex_archive_requested_at: '2026-06-10T00:00:00.000Z',
      },
    }

    expect(hasPendingCodexArchiveRequest(pendingRequest)).toBe(true)
    expect(shouldReturnCodexMonitorTask(pendingRequest)).toBe(true)

    expect(shouldReturnCodexMonitorTask({
      ...pendingRequest,
      result: {
        ...pendingRequest.result,
        codex_archive_request_state: 'waiting_for_grace',
      },
    })).toBe(false)

    expect(shouldReturnCodexMonitorTask({
      ...pendingRequest,
      result: {
        ...pendingRequest.result,
        codex_archive_request_cancelled_at: '2026-06-10T00:00:03.000Z',
      },
    })).toBe(false)
  })
})
