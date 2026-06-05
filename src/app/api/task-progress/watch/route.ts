import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  closeTaskProgressWatch,
  deleteExpiredTaskProgressWatches,
  getTursoTaskForAuth,
  listActiveTaskProgressWatches,
  upsertTaskProgressWatch,
} from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

const VALID_ACTIONS = new Set(['open', 'close', 'ping'])
const EXPIRED_WATCH_RETENTION_SECONDS = 24 * 60 * 60
const WATCH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

let lastWatchCleanupAttemptMs = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function unavailable() {
  return NextResponse.json(
    { error: 'Turso is not configured', code: 'turso_not_configured' },
    { status: 503 },
  )
}

function emptyWatches(source = 'turso_not_configured') {
  return NextResponse.json({
    source,
    server_time: new Date().toISOString(),
    active_task_ids: [],
    watches: [],
  })
}

function noopWatchResponse(action: string | null, watcherId: string | null, source = 'turso_not_configured') {
  return NextResponse.json({
    ok: true,
    source,
    active: action !== 'close',
    watch_id: watcherId,
  })
}

function defaultWatcherId(auth: NonNullable<Awaited<ReturnType<typeof authenticateMonitoringRequest>>>) {
  if (auth.source === 'agent') return `agent:${auth.agent.token.id}`
  return `web:${auth.userId}`
}

async function cleanupExpiredWatchesIfDue() {
  const now = Date.now()
  if (now - lastWatchCleanupAttemptMs < WATCH_CLEANUP_INTERVAL_MS) return
  lastWatchCleanupAttemptMs = now
  try {
    await deleteExpiredTaskProgressWatches({
      olderThanSeconds: EXPIRED_WATCH_RETENTION_SECONDS,
      now: new Date(now).toISOString(),
    })
  } catch (error) {
    console.error('[task-progress/watch cleanup]', error)
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return emptyWatches()

  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get('task_id')?.trim() || null
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 500)

  try {
    await cleanupExpiredWatchesIfDue()
    const watches = await listActiveTaskProgressWatches({
      userId: auth.userId,
      taskId,
      limit,
    })
    const activeTaskIds = [...new Set(watches.map(watch => watch.task_id))]
    return NextResponse.json({
      source: 'turso',
      server_time: new Date().toISOString(),
      active_task_ids: activeTaskIds,
      watches,
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable()
    console.error('[task-progress/watch GET]', error)
    return NextResponse.json({ error: 'Task progress watches fetch failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const taskId = compactString(body.task_id, 120)
  const action = compactString(body.action, 20)
  const watcherId = compactString(body.watch_id, 160) ?? defaultWatcherId(auth)
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  if (!action || !VALID_ACTIONS.has(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  if (!isTursoConfigured()) return noopWatchResponse(action, watcherId)

  try {
    await cleanupExpiredWatchesIfDue()
    const task = await getTursoTaskForAuth(taskId, {
      userId: auth.userId,
      spaceId: auth.spaceId,
      supabase: auth.supabase,
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    if (action === 'close') {
      await closeTaskProgressWatch({
        task_id: task.id,
        user_id: task.user_id,
        watcher_id: watcherId,
      })
      return NextResponse.json({ ok: true, source: 'turso', active: false })
    }

    const ttlSeconds = typeof body.ttl_seconds === 'number' && Number.isFinite(body.ttl_seconds)
      ? body.ttl_seconds
      : 20
    const watch = await upsertTaskProgressWatch({
      task_id: task.id,
      user_id: task.user_id,
      watcher_id: watcherId,
      watcher_type: auth.source,
      ttl_seconds: ttlSeconds,
    })
    return NextResponse.json({
      ok: true,
      source: 'turso',
      active: true,
      watch_id: watcherId,
      ...watch,
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable()
    console.error('[task-progress/watch POST]', error)
    return NextResponse.json({ error: 'Task progress watch update failed' }, { status: 500 })
  }
}
