import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  listActiveAiHistoryMonitorTargets,
  toAiHistoryMonitorTarget,
} from '@/lib/turso/ai-history'

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

const VALID_EXECUTORS = ['codex_app', 'codex'] as const

function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value || '100', 10)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 100, 1), 200)
}

function parseLimitValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.floor(value), 1), 200)
  }
  return parseLimit(typeof value === 'string' ? value : null)
}

function parseProvider(value: unknown) {
  return compactString(value, 80) ?? 'codex_app'
}

async function assertRunnerCanSync(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  runnerId: string,
) {
  const { data, error } = await supabase
    .from('ai_runners')
    .select('id, user_id, executors')
    .eq('id', runnerId)
    .eq('user_id', token.user_id)
    .maybeSingle()
  if (error) throw error
  if (!data) return { ok: false as const, status: 404, error: 'Runner not found' }
  const executors = Array.isArray(data.executors) ? data.executors.map(value => String(value)) : []
  if (!executors.some(executor => VALID_EXECUTORS.includes(executor as (typeof VALID_EXECUTORS)[number]))) {
    return { ok: false as const, status: 403, error: 'Runner is not allowed to monitor AI history' }
  }
  return { ok: true as const }
}

async function handleRequest(request: NextRequest, input: { runnerId: string | null; provider: string; limit: number }) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const runnerId = compactString(input.runnerId, 120)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    const runnerCheck = await assertRunnerCanSync(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    if (!isTursoConfigured()) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }

    const targets = await listActiveAiHistoryMonitorTargets({
      userId: token.user_id,
      provider: input.provider,
      limit: input.limit,
    })

    return NextResponse.json({
      ok: true,
      source: 'turso',
      targets: targets.map(toAiHistoryMonitorTarget),
      policy: {
        provider: input.provider,
        activeStatuses: ['running', 'awaiting_approval', 'needs_input'],
        idField: 'historyItemId',
        metadataOnly: true,
        rawBodiesIncluded: false,
      },
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[agents/ai-history active monitor targets]', error)
    const message = error instanceof Error ? error.message : 'AI history active monitor targets fetch failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json({ error: message }, { status: authFailure ? 401 : 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, {
    runnerId: request.nextUrl.searchParams.get('runner_id'),
    provider: parseProvider(request.nextUrl.searchParams.get('provider')),
    limit: parseLimit(request.nextUrl.searchParams.get('limit')),
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return handleRequest(request, {
    runnerId: compactString(body.runner_id, 120),
    provider: parseProvider(body.provider),
    limit: parseLimitValue(body.limit),
  })
}
