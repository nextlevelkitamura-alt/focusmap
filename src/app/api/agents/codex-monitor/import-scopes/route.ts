import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

async function assertRunnerCanImport(
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
  if (!executors.some(executor => executor === 'codex_app' || executor === 'codex')) {
    return { ok: false as const, status: 403, error: 'Runner is not allowed to import Codex threads' }
  }
  return { ok: true as const }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({}))
    const runnerId = compactString(isRecord(body) ? body.runner_id : null, 120)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })

    const runnerCheck = await assertRunnerCanImport(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    let query = supabase
      .from('projects')
      .select('id, space_id, repo_path, codex_thread_import_enabled_since')
      .eq('user_id', token.user_id)
      .neq('status', 'archived')
      .eq('codex_thread_import_enabled', true)
      .not('repo_path', 'is', null)
      .order('created_at', { ascending: true })

    if (token.space_id) query = query.eq('space_id', token.space_id)

    const { data, error } = await query
    if (error) throw error

    const scopes = (Array.isArray(data) ? data : [])
      .map(row => ({
        project_id: compactString(row.id, 120),
        space_id: compactString(row.space_id, 120),
        repo_path: compactString(row.repo_path, 500),
        enabled_since: compactString(row.codex_thread_import_enabled_since, 80),
      }))
      .filter(scope => scope.project_id && scope.repo_path)

    return NextResponse.json({ scopes })
  } catch (error) {
    console.error('[codex-monitor/import-scopes]', error)
    const message = error instanceof Error ? error.message : 'Codex thread import scopes failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json(
      { error: message },
      { status: authFailure ? 401 : 500 },
    )
  }
}
