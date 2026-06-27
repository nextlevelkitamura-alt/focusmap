import { describe, expect, test } from 'vitest'
import {
  codexGeneratedTitleFromImportedThread,
  importedThreadResult,
  isDirectCodexThreadImportable,
  isImportedThreadMatchingManualHandoff,
  isThreadWithinProjectImportScope,
  linkedManualHandoffThreadResult,
  memoFromImportedThread,
  promptFromImportedThread,
  threadUpdatedAtIso,
  titleFromImportedThread,
  type ImportedCodexThread,
} from './route'

const thread: ImportedCodexThread = {
  id: '019ea7d8-8e53-7413-a548-739b19820e6c',
  title: '  Codexが作ったスレッド  ',
  preview: 'preview',
  first_user_message: '最初の依頼です\n詳細',
  cwd: '/Users/me/project',
  updated_at_ms: Date.parse('2026-06-10T10:00:00.000Z'),
}

describe('codex orphan thread import helpers', () => {
  test('uses thread title first and normalizes whitespace', () => {
    expect(titleFromImportedThread({
      ...thread,
      title: '  Codex   thread from app  ',
    })).toBe('Codex thread from app')
  })

  test('uses the Codex sidebar first line when title contains raw multiline prompt text', () => {
    const rawPromptThread = {
      ...thread,
      title: 'AI要約が見づらいんだけど\nどうするのがいいのかな\nその辺を考えたい\n[$grill-me]',
      first_user_message: '短い要約タイトル\n本文です',
    }

    expect(codexGeneratedTitleFromImportedThread(rawPromptThread)).toBe('AI要約が見づらいんだけど')
    expect(titleFromImportedThread(rawPromptThread)).toBe('AI要約が見づらいんだけど')
  })

  test('uses a truncated prompt prefix when it is the Codex sidebar title', () => {
    const firstUserMessage = 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももうちょっと整えてほしい。詳細も続きます。'
    const promptPrefixThread = {
      ...thread,
      title: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう',
      first_user_message: firstUserMessage,
    }

    expect(codexGeneratedTitleFromImportedThread(promptPrefixThread)).toBe('このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう')
    expect(titleFromImportedThread(promptPrefixThread)).toBe('このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう')

    expect(codexGeneratedTitleFromImportedThread({
      ...thread,
      title: 'メモ下部をコンパクト化して予約ボタンを整理',
      first_user_message: firstUserMessage,
    })).toBe('メモ下部をコンパクト化して予約ボタンを整理')
  })

  test('does not use first user message for display title but keeps it as prompt', () => {
    const untitledThread = {
      ...thread,
      title: null,
      first_user_message: '\n未分類のCodex依頼\n本文',
    }

    expect(titleFromImportedThread(untitledThread)).toBe('Codex thread 019ea7d8')
    expect(isDirectCodexThreadImportable(untitledThread)).toBe(true)

    expect(promptFromImportedThread({
      ...thread,
      first_user_message: null,
      preview: 'preview body',
    })).toBe('preview body')
  })

  test('can import direct Codex threads before a generated title is available', () => {
    const firstUserMessage = 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももうちょっと整えてほしい。詳細も続きます。'

    expect(isDirectCodexThreadImportable({
      ...thread,
      title: null,
      first_user_message: firstUserMessage,
    })).toBe(true)
    expect(isDirectCodexThreadImportable({
      ...thread,
      title: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう',
      first_user_message: firstUserMessage,
    })).toBe(true)
    expect(isDirectCodexThreadImportable({
      ...thread,
      title: null,
      first_user_message: '# AGENTS.md instructions\n<environment_context>',
    })).toBe(false)
    expect(isDirectCodexThreadImportable({
      ...thread,
      title: null,
      first_user_message: null,
    })).toBe(false)
  })

  test('stores imported thread state with codex thread id and source task id', () => {
    const result = importedThreadResult(thread, 'source-task-1', '2026-06-10T10:01:00.000Z')

    expect(result.codex_thread_id).toBe(thread.id)
    expect(result.codex_source_task_id).toBe('source-task-1')
    expect(result.codex_review_reason).toBe('external_thread_import')
    expect(result.codex_run_state).toBe('running')
    expect(result.last_activity_at).toBe('2026-06-10T10:00:00.000Z')
    expect(result.meta.thread_updated_at_ms).toBe(thread.updated_at_ms)
  })

  test('marks archived imported thread results so history UI can hide them', () => {
    const result = importedThreadResult({
      ...thread,
      archived: true,
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'archived',
    }, 'source-task-1', '2026-06-10T10:01:00.000Z')

    expect(result.codex_run_state).toBe('awaiting_approval')
    expect(result.codex_review_reason).toBe('archived')
    expect(result.codex_thread_archived).toBe(true)
    expect(result.current_step).toBe('Codex thread はアーカイブ済みです')
    expect(result.meta.thread_archived).toBe(true)
  })

  test('stores completed imported threads as awaiting approval immediately', () => {
    const result = importedThreadResult({
      ...thread,
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'completed',
      current_step: 'Codexが実行完了し確認待ちです',
      last_activity_at: '2026-06-10T10:03:00.000Z',
    }, 'source-task-1', '2026-06-10T10:04:00.000Z')

    expect(result.codex_run_state).toBe('awaiting_approval')
    expect(result.codex_review_reason).toBe('completed')
    expect(result.current_step).toBe('Codexが実行完了し確認待ちです')
    expect(result.last_activity_at).toBe('2026-06-10T10:03:00.000Z')
    expect(result.awaiting_approval_at).toBe('2026-06-10T10:03:00.000Z')
  })

  test('builds task memo with thread metadata, first request, and preview', () => {
    const memo = memoFromImportedThread(thread)

    expect(memo).toContain('# Codexが作ったスレッド')
    expect(memo).toContain(`Thread ID: ${thread.id}`)
    expect(memo).toContain('Repository: /Users/me/project')
    expect(memo).toContain('## 初回依頼')
    expect(memo).toContain('最初の依頼です\n詳細')
    expect(memo).toContain('## 最新プレビュー')
    expect(memo).toContain('preview')
  })

  test('uses fallback timestamp when thread updated_at_ms is missing', () => {
    expect(threadUpdatedAtIso({
      ...thread,
      updated_at_ms: null,
    }, new Date('2026-06-10T10:02:00.000Z'))).toBe('2026-06-10T10:02:00.000Z')
  })

  test('matches project import scope by cwd and enabled time', () => {
    expect(isThreadWithinProjectImportScope(thread, {
      id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/project',
      codex_thread_import_enabled_since: '2026-06-10T09:59:00.000Z',
    })).toBe(true)

    expect(isThreadWithinProjectImportScope(thread, {
      id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/project',
      codex_thread_import_enabled_since: '2026-06-10T10:01:00.000Z',
    })).toBe(false)

    expect(isThreadWithinProjectImportScope(thread, {
      id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/other',
      codex_thread_import_enabled_since: '2026-06-10T09:59:00.000Z',
    })).toBe(false)

    expect(isThreadWithinProjectImportScope({
      ...thread,
      cwd: '/Users/me/project-worktree',
      scope_project_id: 'project-1',
      scope_repo_path: '/Users/me/project',
    }, {
      id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/project',
      codex_thread_import_enabled_since: '2026-06-10T09:59:00.000Z',
    }, Date.now(), true)).toBe(true)

    expect(isThreadWithinProjectImportScope({
      ...thread,
      cwd: '/Users/me/project-worktree',
      scope_project_id: 'project-1',
      scope_repo_path: '/Users/me/project',
    }, {
      id: 'project-1',
      space_id: 'space-1',
      repo_path: '/Users/me/other',
      codex_thread_import_enabled_since: '2026-06-10T09:59:00.000Z',
    }, Date.now(), true)).toBe(false)
  })

  test('matches Focusmap manual handoff tasks so repo import can skip them', () => {
    const handoffTask = {
      id: 'ai-task-1',
      source_task_id: 'mindmap-node-1',
      source_note_id: null,
      source_ideal_goal_id: null,
      prompt: '最初の依頼です\n詳細',
      cwd: '/Users/me/project',
      executor: 'codex_app',
      codex_thread_id: null,
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'prompt_waiting',
      },
      created_at: '2026-06-10T09:58:00.000Z',
      started_at: '2026-06-10T09:58:00.000Z',
    }

    expect(isImportedThreadMatchingManualHandoff(thread, handoffTask)).toBe(true)
    expect(isImportedThreadMatchingManualHandoff(thread, {
      ...handoffTask,
      source_task_id: null,
    })).toBe(false)
    expect(isImportedThreadMatchingManualHandoff(thread, {
      ...handoffTask,
      source_task_id: null,
      source_ideal_goal_id: 'ideal-goal-1',
    })).toBe(true)
    expect(isImportedThreadMatchingManualHandoff(thread, {
      ...handoffTask,
      cwd: '/Users/me/other',
    })).toBe(false)
    expect(isImportedThreadMatchingManualHandoff(thread, {
      ...handoffTask,
      result: { codex_manual_handoff: false },
    })).toBe(false)
    expect(isImportedThreadMatchingManualHandoff(thread, {
      ...handoffTask,
      codex_thread_id: 'other-thread-id',
    })).toBe(false)

    const linkedResult = linkedManualHandoffThreadResult(thread, {
      result: {
        codex_manual_handoff: true,
        codex_handoff_token: 'FM-token',
        codex_run_state: 'prompt_waiting',
      },
      source_task_id: 'mindmap-node-1',
    }, '2026-06-10T10:01:00.000Z')
    expect(linkedResult.codex_manual_handoff).toBe(true)
    expect(linkedResult.codex_handoff_token).toBe('FM-token')
    expect(linkedResult.codex_thread_id).toBe(thread.id)
    expect(linkedResult.codex_run_state).toBe('running')
    expect(linkedResult.codex_source_task_id).toBe('mindmap-node-1')

    const linkedIdealGoalResult = linkedManualHandoffThreadResult(thread, {
      result: {
        codex_manual_handoff: true,
        codex_handoff_token: 'FM-token',
        codex_run_state: 'prompt_waiting',
      },
      source_ideal_goal_id: 'ideal-goal-1',
    }, '2026-06-10T10:01:00.000Z')
    expect(linkedIdealGoalResult.codex_source_ideal_goal_id).toBe('ideal-goal-1')
  })

  test('keeps manual handoff linked completed thread in awaiting approval', () => {
    const linkedResult = linkedManualHandoffThreadResult({
      ...thread,
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'completed',
      current_step: 'Codexが実行完了し確認待ちです',
      last_activity_at: '2026-06-10T10:03:00.000Z',
    }, {
      result: {
        codex_manual_handoff: true,
        codex_handoff_token: 'FM-token',
        codex_run_state: 'prompt_waiting',
      },
      source_task_id: 'mindmap-node-1',
    }, '2026-06-10T10:04:00.000Z')

    expect(linkedResult.codex_run_state).toBe('awaiting_approval')
    expect(linkedResult.codex_review_reason).toBe('completed')
    expect(linkedResult.awaiting_approval_at).toBe('2026-06-10T10:03:00.000Z')
    expect(linkedResult.codex_source_task_id).toBe('mindmap-node-1')
    expect(linkedResult.meta.thread_updated_at_ms).toBe(thread.updated_at_ms)
  })

  test('marks archived manual handoff thread results so history UI can hide them', () => {
    const linkedResult = linkedManualHandoffThreadResult({
      ...thread,
      archived: true,
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'archived',
    }, {
      result: {
        codex_manual_handoff: true,
      },
      source_task_id: 'mindmap-node-1',
    }, '2026-06-10T10:04:00.000Z')

    expect(linkedResult.codex_review_reason).toBe('archived')
    expect(linkedResult.codex_thread_archived).toBe(true)
    expect(linkedResult.meta.thread_archived).toBe(true)
  })
})
