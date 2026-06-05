import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/utils/supabase/service'

export interface AgentTokenRecord {
  id: string
  user_id: string
  space_id: string | null
  name: string | null
  expires_at: string | null
  revoked_at: string | null
}

export interface AgentAuthContext {
  supabase: ReturnType<typeof createServiceClient>
  token: AgentTokenRecord
}

type CachedAgentToken = {
  token: AgentTokenRecord
  expiresAt: number
  lastUsedWriteAt: number
}

const AGENT_TOKEN_CACHE_TTL_MS = 5 * 60_000
const AGENT_TOKEN_LAST_USED_WRITE_TTL_MS = 5 * 60_000
const agentTokenCache = new Map<string, CachedAgentToken>()

export function hashAgentToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function readBearerToken(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return request.headers.get('x-focusmap-agent-token')?.trim() ?? ''
}

export async function authenticateAgent(request: NextRequest): Promise<AgentAuthContext> {
  const rawToken = readBearerToken(request)
  if (!rawToken) throw new Error('agent token is required')

  const supabase = createServiceClient()
  const tokenHash = hashAgentToken(rawToken)
  const now = Date.now()
  const cached = agentTokenCache.get(tokenHash)
  if (cached && cached.expiresAt > now) {
    if (cached.token.expires_at && new Date(cached.token.expires_at).getTime() <= now) {
      agentTokenCache.delete(tokenHash)
      throw new Error('agent token is expired')
    }

    if (now - cached.lastUsedWriteAt > AGENT_TOKEN_LAST_USED_WRITE_TTL_MS) {
      cached.lastUsedWriteAt = now
      await supabase
        .from('agent_tokens')
        .update({ last_used_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
        .eq('id', cached.token.id)
    }

    return { supabase, token: cached.token }
  }

  const { data, error } = await supabase
    .from('agent_tokens')
    .select('id, user_id, space_id, name, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) throw new Error(`agent token lookup failed: ${error.message}`)
  if (!data) throw new Error('invalid agent token')

  const token = data as AgentTokenRecord
  if (token.revoked_at) throw new Error('agent token is revoked')
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    throw new Error('agent token is expired')
  }

  await supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', token.id)

  agentTokenCache.set(tokenHash, {
    token,
    expiresAt: now + AGENT_TOKEN_CACHE_TTL_MS,
    lastUsedWriteAt: now,
  })

  return { supabase, token }
}
