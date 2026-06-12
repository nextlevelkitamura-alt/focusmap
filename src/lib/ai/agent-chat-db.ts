export const AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE =
  'チャット履歴DBの準備がまだです。agent_chat_sessions migrationを適用してください。'

export function isMissingAgentChatSessionsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const text = `${message}\n${details}`
  if (code === 'PGRST205' || code === '42P01') return /agent_chat_sessions/u.test(text)
  return /agent_chat_sessions/u.test(text) &&
    /(schema cache|does not exist|could not find|relation)/iu.test(text)
}
