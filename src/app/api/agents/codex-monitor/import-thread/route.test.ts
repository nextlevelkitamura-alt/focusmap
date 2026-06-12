import { describe, expect, test } from 'vitest'
import {
  importedThreadResult,
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

  test('uses first prompt line when Codex title is a raw long prompt', () => {
    expect(titleFromImportedThread({
      ...thread,
      title: 'これは長すぎるプロンプトの見出しです。Codex Desktopのsidebar titleではなく、ユーザーが入力した本文全体がそのまま入ってしまっているケースを想定します。さらに長くします。',
      first_user_message: '短い要約タイトル\n本文です',
    })).toBe('短い要約タイトル')
  })

  test('falls back to first user message and preview for display title and prompt', () => {
    expect(titleFromImportedThread({
      ...thread,
      title: null,
      first_user_message: '\n未分類のCodex依頼\n本文',
    })).toBe('未分類のCodex依頼')

    expect(promptFromImportedThread({
      ...thread,
      first_user_message: null,
      preview: 'preview body',
    })).toBe('preview body')
  })

  test('stores imported thread state with codex thread id and source task id', () => {
    const result = importedThreadResult(thread, 'source-task-1', '2026-06-10T10:01:00.000Z')

    expect(result.codex_thread_id).toBe(thread.id)
    expect(result.codex_source_task_id).toBe('source-task-1')
    expect(result.codex_review_reason).toBe('external_thread_import')
    expect(result.last_activity_at).toBe('2026-06-10T10:00:00.000Z')
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
  })

  test('matches Focusmap manual handoff tasks so repo import can skip them', () => {
    const handoffTask = {
      id: 'ai-task-1',
      source_task_id: 'mindmap-node-1',
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
  })
})
