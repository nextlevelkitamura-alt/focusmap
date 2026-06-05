import type { NextRequest } from 'next/server'
import { authenticateAgent, type AgentAuthContext } from '@/lib/agent-auth'
import { authenticateSupabaseRequest, type SupabaseRequestAuth } from '@/lib/auth/verify-supabase-jwt'
import { createClient } from '@/utils/supabase/server'

export type MonitoringRequestAuth =
  | {
      source: 'supabase'
      userId: string
      email: string | null
      spaceId: null
      supabase: Awaited<ReturnType<typeof createClient>>
      agent: null
      claims: SupabaseRequestAuth['claims']
    }
  | {
      source: 'agent'
      userId: string
      email: null
      spaceId: string | null
      supabase: AgentAuthContext['supabase']
      agent: AgentAuthContext
      claims: null
    }

function bearerToken(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? ''
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
}

function isJwtLike(value: string) {
  return value.split('.').length === 3
}

export async function authenticateMonitoringRequest(request: NextRequest): Promise<MonitoringRequestAuth | null> {
  const bearer = bearerToken(request)
  if (bearer && !isJwtLike(bearer)) {
    try {
      const agent = await authenticateAgent(request)
      return {
        source: 'agent',
        userId: agent.token.user_id,
        email: null,
        spaceId: agent.token.space_id,
        supabase: agent.supabase,
        agent,
        claims: null,
      }
    } catch {
      return null
    }
  }

  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(request, supabase)
  if (auth) {
    return {
      source: 'supabase',
      userId: auth.user.id,
      email: auth.user.email,
      spaceId: null,
      supabase,
      agent: null,
      claims: auth.claims,
    }
  }

  try {
    const agent = await authenticateAgent(request)
    return {
      source: 'agent',
      userId: agent.token.user_id,
      email: null,
      spaceId: agent.token.space_id,
      supabase: agent.supabase,
      agent,
      claims: null,
    }
  } catch {
    return null
  }
}
