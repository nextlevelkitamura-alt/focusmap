import { describe, expect, test } from 'vitest'
import type { UIMessage } from 'ai'
import {
  agentProgressText,
  agentToolLabel,
  createAgentProgressMessage,
  getAgentProgressMetadata,
  isAgentProgressMessage,
  upsertAgentProgressMessage,
  withoutAgentProgressMessages,
} from './agent-chat-progress'

describe('agent-chat-progress', () => {
  test('creates Japanese progress text from tool labels', () => {
    const message = createAgentProgressMessage({
      id: 'progress-1',
      state: 'running',
      label: agentToolLabel('listCalendarEvents'),
      toolName: 'listCalendarEvents',
      startedAt: '2026-06-12T13:00:00.000Z',
    })

    const metadata = getAgentProgressMetadata(message)
    expect(metadata).toMatchObject({
      state: 'running',
      label: '予定確認',
      toolName: 'listCalendarEvents',
    })
    expect(metadata && agentProgressText(metadata)).toBe('予定確認中')
    expect(message.parts).toEqual([{ type: 'text', text: '予定確認中' }])
  })

  test('labels calendar deletion progress', () => {
    const message = createAgentProgressMessage({
      id: 'progress-delete',
      state: 'done',
      label: agentToolLabel('deleteCalendarEvent'),
      toolName: 'deleteCalendarEvent',
      startedAt: '2026-06-15T12:59:00.000Z',
      completedAt: '2026-06-15T12:59:01.000Z',
    })

    const metadata = getAgentProgressMetadata(message)
    expect(metadata).toMatchObject({
      state: 'done',
      label: '予定削除',
      toolName: 'deleteCalendarEvent',
    })
    expect(metadata && agentProgressText(metadata)).toBe('予定削除完了')
  })

  test('labels bulk memo creation progress', () => {
    const message = createAgentProgressMessage({
      id: 'progress-bulk-memo',
      state: 'done',
      label: agentToolLabel('bulkAddMemos'),
      toolName: 'bulkAddMemos',
      startedAt: '2026-06-14T12:00:00.000Z',
      completedAt: '2026-06-14T12:00:01.000Z',
    })

    const metadata = getAgentProgressMetadata(message)
    expect(metadata).toMatchObject({
      state: 'done',
      label: 'メモ一括追加',
      toolName: 'bulkAddMemos',
    })
    expect(metadata && agentProgressText(metadata)).toBe('メモ一括追加完了')
  })

  test('labels mindmap draft save progress', () => {
    const message = createAgentProgressMessage({
      id: 'progress-map-draft',
      state: 'done',
      label: agentToolLabel('saveMindmapDraft'),
      toolName: 'saveMindmapDraft',
      startedAt: '2026-06-16T12:00:00.000Z',
      completedAt: '2026-06-16T12:00:01.000Z',
    })

    const metadata = getAgentProgressMetadata(message)
    expect(metadata).toMatchObject({
      state: 'done',
      label: 'AI案保存',
      toolName: 'saveMindmapDraft',
    })
    expect(metadata && agentProgressText(metadata)).toBe('AI案保存完了')
  })

  test('filters progress messages out of model replay history', () => {
    const userMessage: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '予定を見て' }] }
    const progressMessage = createAgentProgressMessage({
      id: 'p1',
      state: 'done',
      label: '予定確認',
      startedAt: '2026-06-12T13:00:00.000Z',
      completedAt: '2026-06-12T13:00:01.000Z',
    })
    const assistantMessage: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '確認しました' }] }

    expect(withoutAgentProgressMessages([userMessage, progressMessage, assistantMessage])).toEqual([userMessage, assistantMessage])
    expect(isAgentProgressMessage(userMessage)).toBe(false)
    expect(isAgentProgressMessage(progressMessage)).toBe(true)
  })

  test('upserts progress messages by id without changing order', () => {
    const first = createAgentProgressMessage({
      id: 'p1',
      state: 'running',
      label: 'マップ全体確認',
      startedAt: '2026-06-12T13:00:00.000Z',
    })
    const done = createAgentProgressMessage({
      id: 'p1',
      state: 'done',
      label: 'マップ全体確認',
      startedAt: '2026-06-12T13:00:00.000Z',
      completedAt: '2026-06-12T13:00:02.000Z',
      durationMs: 2000,
    })
    const finalMessage: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '整理しました' }] }

    const inserted = upsertAgentProgressMessage([finalMessage], first)
    const updated = upsertAgentProgressMessage(inserted, done)

    expect(updated.map(message => message.id)).toEqual(['a1', 'p1'])
    expect(getAgentProgressMetadata(updated[1])?.state).toBe('done')
    expect(getAgentProgressMetadata(updated[1])?.durationMs).toBe(2000)
  })
})
