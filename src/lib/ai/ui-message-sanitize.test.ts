import { convertToModelMessages, type UIMessage } from 'ai'
import { describe, expect, test } from 'vitest'
import { sanitizeUIMessagesForModel } from './ui-message-sanitize'

function assistantMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts,
  }
}

describe('sanitizeUIMessagesForModel tool parts', () => {
  test('replaces interrupted tool calls before model conversion', async () => {
    const sanitized = sanitizeUIMessagesForModel([
      assistantMessage([
        {
          type: 'dynamic-tool',
          toolName: 'webResearch',
          toolCallId: 'call_1',
          state: 'input-available',
          input: { query: 'Focusmap' },
        },
      ]),
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '続けて' }],
      },
    ])

    expect(sanitized[0].parts).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('webResearch'),
      }),
    ])

    const modelMessages = await convertToModelMessages(sanitized, {
      ignoreIncompleteToolCalls: true,
    })
    expect(JSON.stringify(modelMessages)).not.toContain('"tool-call"')
    expect(JSON.stringify(modelMessages)).not.toContain('call_1')
  })

  test('keeps completed tool calls paired with their result', async () => {
    const sanitized = sanitizeUIMessagesForModel([
      assistantMessage([
        {
          type: 'dynamic-tool',
          toolName: 'webResearch',
          toolCallId: 'call_2',
          state: 'output-available',
          input: { query: 'Focusmap' },
          output: { success: true, result: 'ok' },
        },
      ]),
    ])

    const modelMessages = await convertToModelMessages(sanitized)

    expect(modelMessages).toHaveLength(2)
    expect(modelMessages[0].role).toBe('assistant')
    expect(JSON.stringify(modelMessages[0])).toContain('"tool-call"')
    expect(modelMessages[1].role).toBe('tool')
    expect(JSON.stringify(modelMessages[1])).toContain('"tool-result"')
    expect(JSON.stringify(modelMessages[1])).toContain('call_2')
  })
})
