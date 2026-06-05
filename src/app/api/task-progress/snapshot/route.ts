import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { listTursoAiTaskSnapshots } from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

const VALID_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'])

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '100', 10)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 100, 1), 500)
}

function validIsoCursor(value: string | null) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function parseSnapshotCursor(value: string | null) {
  if (!value) return null
  const [updatedAtRaw, idRaw] = value.split('|')
  const updatedAt = validIsoCursor(updatedAtRaw)
  const id = typeof idRaw === 'string' ? idRaw.trim() : null
  return updatedAt && id !== null ? { updatedAt, id } : null
}

function encodeSnapshotCursor(updatedAt: string, id: string) {
  return `${updatedAt}|${id}`
}

function unavailable() {
  return NextResponse.json(
    { error: 'Turso is not configured', code: 'turso_not_configured' },
    { status: 503 },
  )
}

function emptySnapshot(source = 'turso_not_configured') {
  const serverTime = new Date().toISOString()
  return NextResponse.json({
    source,
    server_time: serverTime,
    cursor: `${serverTime}|`,
    tasks: [],
  })
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return emptySnapshot()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')?.trim() || null
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  const cursorParam = searchParams.get('cursor') || searchParams.get('updated_after')
  const parsedCursor = parseSnapshotCursor(cursorParam)
  const updatedAfter = parsedCursor ? null : validIsoCursor(cursorParam)
  const limit = parseLimit(searchParams.get('limit'))

  try {
    const tasks = await listTursoAiTaskSnapshots({
      userId: auth.userId,
      spaceId: auth.spaceId,
      status,
      cursor: parsedCursor,
      updatedAfter,
      limit,
    })
    const serverTime = new Date().toISOString()
    const responseCursor = tasks.length > 0
      ? encodeSnapshotCursor(tasks[tasks.length - 1]!.updated_at, tasks[tasks.length - 1]!.id)
      : cursorParam ?? (updatedAfter ? `${updatedAfter}|` : `${serverTime}|`)

    return NextResponse.json({
      source: 'turso',
      server_time: serverTime,
      cursor: responseCursor,
      tasks,
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable()
    console.error('[task-progress/snapshot GET]', error)
    return NextResponse.json({ error: 'Task progress snapshot fetch failed' }, { status: 500 })
  }
}
