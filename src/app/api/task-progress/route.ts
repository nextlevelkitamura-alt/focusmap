import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  getTursoTaskForAuth,
  insertTaskEvent,
  insertTaskProgress,
  listTaskEvents,
  listTaskProgress,
  upsertTursoAiTask,
} from '@/lib/turso/codex-monitoring'
import { boundedTaskProgressJson } from '@/lib/turso/task-progress-payload'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

const VALID_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'])
const MAX_MESSAGE_CHARS = 1_200
const MAX_CURRENT_STEP_CHARS = 600
const MAX_SUMMARY_CHARS = 1_200
const MAX_PHASE_CHARS = 80
const MAX_EVENT_TYPE_CHARS = 80
const ALLOWED_EVENT_TYPES = new Set([
  'thread_detected',
  'running',
  'resumed',
  'awaiting_approval',
  'needs_input',
  'completed',
  'failed',
  'status:pending',
  'status:running',
  'status:awaiting_approval',
  'status:needs_input',
  'status:completed',
  'status:failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null
}

function allowedEventType(value: string | null) {
  if (!value) return null
  return ALLOWED_EVENT_TYPES.has(value) ? value : null
}

function boundedProgressPercent(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function tursoUnavailableResponse() {
  return NextResponse.json(
    { error: 'Turso is not configured', code: 'turso_not_configured' },
    { status: 503 },
  )
}

async function supabaseFallback(
  auth: NonNullable<Awaited<ReturnType<typeof authenticateMonitoringRequest>>>,
  taskId: string,
) {
  const { data, error } = await auth.supabase
    .from('ai_tasks')
    .select('id, user_id, status, error, started_at, completed_at, result_current_step:result->>current_step, result_live_log:result->>live_log, result_progress_summary:result->progress_summary, result_last_activity_at:result->>last_activity_at')
    .eq('id', taskId)
    .eq('user_id', auth.userId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const row = data as Record<string, unknown>
  const message = typeof row.result_live_log === 'string'
    ? row.result_live_log.slice(-MAX_MESSAGE_CHARS)
    : typeof row.result_current_step === 'string'
      ? row.result_current_step
      : null

  return NextResponse.json({
    source: 'supabase_fallback',
    task: {
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      error_message: row.error,
      current_step: row.result_current_step ?? null,
      summary: row.result_progress_summary ?? null,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      last_activity_at: row.result_last_activity_at ?? null,
    },
    progress: message
      ? [{
          id: `supabase:${taskId}`,
          task_id: taskId,
          user_id: auth.userId,
          phase: 'supabase_result',
          message,
          progress_json: row.result_progress_summary ?? null,
          created_at: row.result_last_activity_at ?? null,
        }]
      : [],
    events: [],
  })
}

export async function GET(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get('task_id')?.trim()
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100)

  if (!isTursoConfigured()) return supabaseFallback(auth, taskId)

  try {
    const task = await getTursoTaskForAuth(taskId, {
      userId: auth.userId,
      spaceId: auth.spaceId,
      supabase: auth.supabase,
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const [progress, events] = await Promise.all([
      listTaskProgress(task.id, task.user_id, limit),
      listTaskEvents(task.id, task.user_id, limit),
    ])

    return NextResponse.json({
      source: 'turso',
      task,
      progress,
      events,
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return tursoUnavailableResponse()
    console.error('[task-progress GET]', error)
    return NextResponse.json({ error: 'Task progress fetch failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return tursoUnavailableResponse()

  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const taskId = compactString(body.task_id, 120)
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })

  try {
    const task = await getTursoTaskForAuth(taskId, {
      userId: auth.userId,
      spaceId: auth.spaceId,
      supabase: auth.supabase,
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const phase = compactString(body.phase, MAX_PHASE_CHARS)
    const message = compactString(body.message, MAX_MESSAGE_CHARS)
    const progressJson = boundedTaskProgressJson(body.progress_json)
    const status = compactString(body.status, 40)
    const currentStep = compactString(body.current_step, MAX_CURRENT_STEP_CHARS)
    const summary = compactString(body.summary, MAX_SUMMARY_CHARS)
    const errorMessage = compactString(body.error_message, MAX_SUMMARY_CHARS)
    const progressPercent = boundedProgressPercent(body.progress_percent)
    const codexThreadId = compactString(body.codex_thread_id, 200)
    const executor = compactString(body.executor, 80)
    const lastActivityAt = compactString(body.last_activity_at, 80)
    const eventType = allowedEventType(compactString(body.event_type, MAX_EVENT_TYPE_CHARS))
    const eventPayload = boundedTaskProgressJson(body.event_payload)
    const snapshotOnly = body.snapshot_only === true
    const forceEvent = body.force_event === true

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    if (
      !phase && !message && !progressJson && !eventType && !status && !currentStep &&
      !summary && !errorMessage && !codexThreadId && !executor && progressPercent === null
    ) {
      return NextResponse.json({ error: 'progress payload is empty' }, { status: 400 })
    }

    await upsertTursoAiTask({
      id: task.id,
      user_id: task.user_id,
      space_id: task.space_id,
      status: status ?? task.status,
      executor,
      codex_thread_id: codexThreadId,
      current_step: currentStep,
      progress_percent: progressPercent,
      summary,
      error_message: errorMessage,
      updated_at: lastActivityAt && !Number.isNaN(Date.parse(lastActivityAt))
        ? new Date(lastActivityAt).toISOString()
        : null,
      started_at: status === 'running' ? new Date().toISOString() : null,
      completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
    })

    const statusChanged = Boolean(status && status !== task.status)
    const progress = !snapshotOnly && (phase || message || progressJson)
      ? await insertTaskProgress({
          task_id: task.id,
          user_id: task.user_id,
          phase,
          message,
          progress_json: progressJson,
        })
      : null

    const event = eventType
      ? await insertTaskEvent({
          task_id: task.id,
          user_id: task.user_id,
          event_type: eventType,
            payload_json: eventPayload,
          })
        : status && (statusChanged || forceEvent)
        ? await insertTaskEvent({
            task_id: task.id,
            user_id: task.user_id,
            event_type: status,
            payload_json: { status, current_step: currentStep, progress_percent: progressPercent },
          })
        : null

    return NextResponse.json({ ok: true, source: 'turso', progress, event })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return tursoUnavailableResponse()
    const message = error instanceof Error ? error.message : 'Task progress update failed'
    if (message.includes('json payload')) return NextResponse.json({ error: message }, { status: 413 })
    console.error('[task-progress POST]', error)
    return NextResponse.json({ error: 'Task progress update failed' }, { status: 500 })
  }
}
