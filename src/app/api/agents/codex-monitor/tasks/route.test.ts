import { describe, expect, test } from 'vitest'
import { shouldReturnCodexMonitorTask } from './route'

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
})
