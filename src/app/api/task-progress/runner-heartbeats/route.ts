import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { listRunnerHeartbeats, upsertRunnerHeartbeat } from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function unavailable() {
  return NextResponse.json(
    { error: 'Turso is not configured', code: 'turso_not_configured' },
    { status: 503 },
  )
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable()

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100)

  try {
    const heartbeats = await listRunnerHeartbeats(auth.userId, limit)
    return NextResponse.json({ source: 'turso', heartbeats })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable()
    console.error('[runner-heartbeats GET]', error)
    return NextResponse.json({ error: 'Runner heartbeat fetch failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable()

  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const runnerId = compactString(body.runner_id, 160) ?? compactString(body.hostname, 120)
  if (!runnerId) return NextResponse.json({ error: 'runner_id or hostname is required' }, { status: 400 })

  try {
    const heartbeat = await upsertRunnerHeartbeat({
      runner_id: runnerId,
      user_id: auth.userId,
      device_id: compactString(body.device_id, 160),
      status: compactString(body.status, 40) ?? 'online',
      current_task_id: compactString(body.current_task_id, 160),
      version: compactString(body.version, 80),
      metadata_json: isRecord(body.metadata) ? body.metadata : {},
    })
    return NextResponse.json({ ok: true, source: 'turso', heartbeat })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable()
    console.error('[runner-heartbeats POST]', error)
    return NextResponse.json({ error: 'Runner heartbeat update failed' }, { status: 500 })
  }
}
