import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { listRunnerHeartbeats, upsertRunnerHeartbeat } from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest, type MonitoringRequestAuth } from '@/lib/turso/request-auth'

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function uuidLike(value: string | null) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function nowIso() {
  return new Date().toISOString()
}

function currentTaskIdFrom(metadata: Record<string, unknown>) {
  return compactString(metadata.current_task_id, 160) ?? compactString(metadata.currentTaskId, 160)
}

function versionFrom(metadata: Record<string, unknown>) {
  return compactString(metadata.version, 80) ?? compactString(metadata.app_version, 80)
}

function statusFrom(metadata: Record<string, unknown>) {
  return compactString(metadata.runner_status, 40) ??
    compactString(metadata.status, 40) ??
    compactString(metadata.agent_state, 40) ??
    'online'
}

function supabaseRunnerHeartbeat(row: Record<string, unknown>) {
  const metadata = isRecord(row.metadata) ? row.metadata : {}
  const timestamp = compactString(row.last_heartbeat_at, 80) ?? compactString(row.updated_at, 80) ?? nowIso()
  return {
    runner_id: String(row.id),
    user_id: String(row.user_id),
    device_id: compactString(row.hostname, 160),
    status: statusFrom(metadata),
    last_seen_at: timestamp,
    current_task_id: currentTaskIdFrom(metadata),
    version: versionFrom(metadata),
    metadata_json: metadata,
    created_at: compactString(row.created_at, 80) ?? timestamp,
    updated_at: compactString(row.updated_at, 80) ?? timestamp,
  }
}

async function listSupabaseRunnerHeartbeats(auth: MonitoringRequestAuth, limit: number) {
  const { data, error } = await auth.supabase
    .from('ai_runners')
    .select('id,user_id,hostname,metadata,last_heartbeat_at,created_at,updated_at')
    .eq('user_id', auth.userId)
    .order('last_heartbeat_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []).map(row => supabaseRunnerHeartbeat(row as Record<string, unknown>))
}

async function upsertSupabaseRunnerHeartbeat(
  auth: MonitoringRequestAuth,
  body: Record<string, unknown>,
  runnerId: string,
  hasCurrentTaskId: boolean,
) {
  const timestamp = nowIso()
  const hostname = compactString(body.hostname, 120) ?? compactString(body.device_id, 120) ?? 'focusmap-lite-mac'
  const metadata: Record<string, unknown> = {
    ...(isRecord(body.metadata) ? body.metadata : {}),
    last_runner_heartbeat_at: timestamp,
  }
  const status = compactString(body.status, 40) ?? statusFrom(metadata)
  metadata.runner_status = status
  if (hasCurrentTaskId) metadata.current_task_id = compactString(body.current_task_id, 160)
  const version = compactString(body.version, 80) ?? versionFrom(metadata)
  if (version) metadata.version = version

  const fields = 'id,user_id,hostname,metadata,last_heartbeat_at,created_at,updated_at'
  let row: Record<string, unknown> | null = null

  if (uuidLike(runnerId)) {
    const { data, error } = await auth.supabase
      .from('ai_runners')
      .update({
        metadata,
        last_heartbeat_at: timestamp,
        updated_at: timestamp,
      })
      .eq('user_id', auth.userId)
      .eq('id', runnerId)
      .select(fields)
      .maybeSingle()
    if (error) throw error
    row = data as Record<string, unknown> | null
  }

  if (!row) {
    const executors = stringArray(body.executors).length
      ? stringArray(body.executors)
      : stringArray(metadata.executors).length
        ? stringArray(metadata.executors)
        : ['playwright', 'simple', 'browser', 'terminal', 'codex_app']
    const { data, error } = await auth.supabase
      .from('ai_runners')
      .upsert({
        user_id: auth.userId,
        hostname,
        display_name: compactString(body.display_name, 160) ?? `${hostname} (Focusmap Lite)`,
        executors,
        available_repo_keys: stringArray(body.available_repo_keys),
        available_secret_names: stringArray(body.available_secret_names),
        repo_paths: isRecord(body.repo_paths) ? body.repo_paths : {},
        metadata,
        last_heartbeat_at: timestamp,
        updated_at: timestamp,
      }, { onConflict: 'user_id,hostname' })
      .select(fields)
      .single()
    if (error) throw error
    row = data as Record<string, unknown>
  }

  if (auth.source === 'agent' && auth.spaceId) {
    await auth.supabase
      .from('ai_runner_spaces')
      .upsert({ runner_id: String(row.id), space_id: auth.spaceId, enabled: true }, { onConflict: 'runner_id,space_id' })
  }

  return supabaseRunnerHeartbeat(row)
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100)

  if (!isTursoConfigured()) {
    try {
      const heartbeats = await listSupabaseRunnerHeartbeats(auth, limit)
      return NextResponse.json({ source: 'supabase', heartbeats })
    } catch (error) {
      console.error('[runner-heartbeats GET supabase]', error)
      return NextResponse.json({ error: 'Runner heartbeat fetch failed' }, { status: 500 })
    }
  }

  try {
    const heartbeats = await listRunnerHeartbeats(auth.userId, limit)
    return NextResponse.json({ source: 'turso', heartbeats })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      const heartbeats = await listSupabaseRunnerHeartbeats(auth, limit)
      return NextResponse.json({ source: 'supabase', heartbeats })
    }
    console.error('[runner-heartbeats GET]', error)
    return NextResponse.json({ error: 'Runner heartbeat fetch failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const runnerId = compactString(body.runner_id, 160) ?? compactString(body.hostname, 120)
  if (!runnerId) return NextResponse.json({ error: 'runner_id or hostname is required' }, { status: 400 })
  const hasCurrentTaskId = Object.prototype.hasOwnProperty.call(body, 'current_task_id')

  if (isTursoConfigured()) {
    try {
      const heartbeat = await upsertRunnerHeartbeat({
        runner_id: runnerId,
        user_id: auth.userId,
        device_id: compactString(body.device_id, 160),
        status: compactString(body.status, 40) ?? 'online',
        ...(hasCurrentTaskId ? { current_task_id: compactString(body.current_task_id, 160) } : {}),
        version: compactString(body.version, 80),
        metadata_json: isRecord(body.metadata) ? body.metadata : {},
      })
      return NextResponse.json({ ok: true, source: 'turso', heartbeat })
    } catch (error) {
      if (!(error instanceof TursoConfigurationError)) {
        console.error('[runner-heartbeats POST]', error)
        return NextResponse.json({ error: 'Runner heartbeat update failed' }, { status: 500 })
      }
    }
  }

  try {
    const heartbeat = await upsertSupabaseRunnerHeartbeat(auth, body, runnerId, hasCurrentTaskId)
    return NextResponse.json({ ok: true, source: 'supabase', heartbeat })
  } catch (error) {
    console.error('[runner-heartbeats POST supabase]', error)
    return NextResponse.json({ error: 'Runner heartbeat update failed' }, { status: 500 })
  }
}
