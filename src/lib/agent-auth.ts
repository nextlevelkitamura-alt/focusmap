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

  return { supabase, token }
}
