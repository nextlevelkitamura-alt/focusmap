import { describe, expect, test } from 'vitest'
import {
  importedThreadResult,
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
      title: '  Codex   thread\nfrom app  ',
    })).toBe('Codex thread from app')
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

  test('uses fallback timestamp when thread updated_at_ms is missing', () => {
    expect(threadUpdatedAtIso({
      ...thread,
      updated_at_ms: null,
    }, new Date('2026-06-10T10:02:00.000Z'))).toBe('2026-06-10T10:02:00.000Z')
  })
})
