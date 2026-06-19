import { describe, expect, test } from 'vitest'
import {
  isClaimedByOtherActiveRunner,
  memoWithUpdatedImportedThreadTitle,
  normalizeAgentStateForLegacyThreadMissing,
  shouldApplyCodexThreadTitleToSourceTask,
  shouldCompleteSourceTaskFromAgentState,
  shouldMarkSourceTaskArchivedFromAgentState,
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

    expect(shouldCompleteSourceTaskFromAgentState({
      status: 'completed',
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'thread_unavailable',
        codex_source_task_completed: true,
      },
    })).toBe(false)
  })
})

describe('shouldMarkSourceTaskArchivedFromAgentState', () => {
  test('marks a source task archived when the agent records archived thread state', () => {
    expect(shouldMarkSourceTaskArchivedFromAgentState({
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'archived',
      },
    })).toBe(true)

    expect(shouldMarkSourceTaskArchivedFromAgentState({
      sourceTaskId: 'task-1',
      result: {
        codex_thread_archived: true,
      },
    })).toBe(true)

    expect(shouldMarkSourceTaskArchivedFromAgentState({
      sourceTaskId: 'task-1',
      result: {
        meta: {
          thread_archived: true,
        },
      },
    })).toBe(true)

    expect(shouldMarkSourceTaskArchivedFromAgentState({
      sourceTaskId: null,
      result: {
        codex_review_reason: 'archived',
      },
    })).toBe(false)

    expect(shouldMarkSourceTaskArchivedFromAgentState({
      sourceTaskId: 'task-1',
      result: {
        codex_review_reason: 'completed',
      },
    })).toBe(false)
  })
})

describe('normalizeAgentStateForLegacyThreadMissing', () => {
  test('keeps a running task running when a legacy agent reports thread_deleted', () => {
    expect(normalizeAgentStateForLegacyThreadMissing({
      previousStatus: 'running',
      status: 'awaiting_approval',
      result: {
        codex_review_reason: 'thread_deleted',
        codex_run_state: 'awaiting_approval',
        message: 'Codex thread が見つからないため監視を停止しました。',
        awaiting_approval_at: '2026-06-16T00:00:00.000Z',
      },
    })).toEqual({
      status: 'running',
      result: {
        codex_review_reason: 'thread_unavailable',
        codex_run_state: 'running',
        message: 'Codex thread を一時的に確認できません。実行中として監視を継続します。',
        current_step: 'Codex thread を一時確認中です',
      },
    })
  })

  test('normalizes thread_deleted to thread_unavailable for non-running tasks', () => {
    expect(normalizeAgentStateForLegacyThreadMissing({
      previousStatus: 'awaiting_approval',
      status: 'awaiting_approval',
      result: {
        codex_review_reason: 'thread_deleted',
        message: 'Codex thread が見つからないため監視を停止しました。',
      },
    })).toEqual({
      status: 'awaiting_approval',
      result: {
        codex_review_reason: 'thread_unavailable',
        message: 'Codex thread が一時的に見つからないため、監視を継続します。',
      },
    })
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

  test('updates imported thread titles that are truncated from a long first prompt', () => {
    expect(shouldApplyCodexThreadTitleToSourceTask({
      currentTitle: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう',
      nextTitle: 'メモ下部をコンパクト化して予約ボタンを整理',
      prompt: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももうちょっと整えてほしい。詳細も続きます。',
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

  test('updates fallback short-id titles once Codex generates a title', () => {
    expect(shouldApplyCodexThreadTitleToSourceTask({
      currentTitle: 'Codex thread 019ea7d8',
      nextTitle: 'リポ監視の安定化',
      prompt: 'リポ監視が安定しないので直して',
      previousResult: {
        codex_thread_id: '019ea7d8-8e53-7413-a548-739b19820e6c',
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
