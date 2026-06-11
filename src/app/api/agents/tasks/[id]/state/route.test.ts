import { describe, expect, test } from 'vitest'
import {
  isClaimedByOtherActiveRunner,
  memoWithUpdatedImportedThreadTitle,
  shouldApplyCodexThreadTitleToSourceTask,
  shouldCompleteSourceTaskFromAgentState,
} from './route'

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

describe('shouldApplyCodexThreadTitleToSourceTask', () => {
  test('updates imported thread titles that still match the first prompt line', () => {
    expect(shouldApplyCodexThreadTitleToSourceTask({
      currentTitle: 'データベース取り込みを直して',
      nextTitle: 'Codex取り込み見出しの改善',
      prompt: 'データベース取り込みを直して\n詳細本文',
      previousResult: {
        codex_thread_id: '019ea7d8-8e53-7413-a548-739b19820e6c',
      },
    })).toBe(true)
  })

  test('updates titles that match the previously applied Codex suggestion', () => {
    expect(shouldApplyCodexThreadTitleToSourceTask({
      currentTitle: 'Codex取り込み見出しの改善',
      nextTitle: 'Codexスレッド見出し同期',
      prompt: 'データベース取り込みを直して',
      previousResult: {
        meta: {
          source_task_title: 'Codex取り込み見出しの改善',
        },
      },
    })).toBe(true)
  })

  test('does not overwrite a custom source task title', () => {
    expect(shouldApplyCodexThreadTitleToSourceTask({
      currentTitle: '自分で付けた見出し',
      nextTitle: 'Codexスレッド見出し同期',
      prompt: 'データベース取り込みを直して',
      previousResult: {
        meta: {
          source_task_title: 'データベース取り込みを直して',
        },
      },
    })).toBe(false)
  })

  test('updates markdown memo heading only when it mirrors the current title', () => {
    expect(memoWithUpdatedImportedThreadTitle({
      memo: '# データベース取り込みを直して\n\n## 初回依頼\n本文',
      currentTitle: 'データベース取り込みを直して',
      nextTitle: 'Codex取り込み見出しの改善',
    })).toBe('# Codex取り込み見出しの改善\n\n## 初回依頼\n本文')

    expect(memoWithUpdatedImportedThreadTitle({
      memo: '# 自分の見出し\n\n本文',
      currentTitle: 'データベース取り込みを直して',
      nextTitle: 'Codex取り込み見出しの改善',
    })).toBeNull()
  })
})
