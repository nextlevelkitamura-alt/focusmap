import { describe, expect, test } from 'vitest'
import { isMissingAgentChatSessionsTable } from './agent-chat-db'

describe('agent-chat-db', () => {
  test('detects Supabase schema-cache misses for agent_chat_sessions', () => {
    expect(isMissingAgentChatSessionsTable({
      code: 'PGRST205',
      message: "Could not find the table 'public.agent_chat_sessions' in the schema cache",
    })).toBe(true)
  })

  test('does not treat unrelated database errors as missing chat sessions table', () => {
    expect(isMissingAgentChatSessionsTable({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    })).toBe(false)
  })
})
