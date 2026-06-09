import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import {
  insertAiTaskActivityMessage,
  type AiTaskActivityImportance,
  type AiTaskActivityKind,
  type AiTaskActivityRole,
} from '@/lib/ai-task-activity'
import { isTursoConfigured } from '@/lib/turso/client'
import { insertTaskEvent, insertTaskProgress, upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

const VALID_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'])
const MAX_CURRENT_STEP_CHARS = 600
const MAX_SUMMARY_CHARS = 1_200
const MAX_ACTIVITY_MESSAGES_PER_UPDATE = 12

const VALID_ACTIVITY_ROLES = new Set<AiTaskActivityRole>(['system', 'codex', 'user', 'status'])
const VALID_ACTIVITY_KINDS = new Set<AiTaskActivityKind>([
  'prompt_waiting',
  'sent',
  'progress',
  'question',
  'approval',
  'resumed',
  'completed',
  'failed',
  'user_answer',
])
const VALID_ACTIVITY_IMPORTANCE = new Set<AiTaskActivityImportance>(['normal', 'important'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function parseTimeMs(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function isClaimedByOtherActiveRunner(
  task: { claimed_runner_id?: unknown; claim_expires_at?: unknown },
  runnerId: string,
  nowMs = Date.now(),
) {
  const claimedRunnerId = compactString(task.claimed_runner_id, 120)
  if (!claimedRunnerId || claimedRunnerId === runnerId) return false
  const claimExpiresAtMs = parseTimeMs(task.claim_expires_at)
  return claimExpiresAtMs == null || claimExpiresAtMs > nowMs
}

export function shouldCompleteSourceTaskFromAgentState(input: {
  status: string
  result?: Record<string, unknown> | null
  sourceTaskId?: unknown
}) {
  const sourceTaskId = compactString(input.sourceTaskId, 120)
  if (!sourceTaskId) return false
  if (input.status !== 'completed') return false
  const result = isRecord(input.result) ? input.result : {}
  return result.codex_review_reason === 'archived' &&
    result.codex_source_task_completed === true &&
    result.codex_source_task_completion_suppressed !== true
}

function compactLatestLine(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const latest = value
    .split(/\n{2,}|\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
  return compactString(latest, max)
}

function compactActivityMessages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ACTIVITY_MESSAGES_PER_UPDATE).flatMap((item) => {
    if (!isRecord(item)) return []
    const role = typeof item.role === 'string' && VALID_ACTIVITY_ROLES.has(item.role as AiTaskActivityRole)
      ? item.role as AiTaskActivityRole
      : null
    const kind = typeof item.kind === 'string' && VALID_ACTIVITY_KINDS.has(item.kind as AiTaskActivityKind)
      ? item.kind as AiTaskActivityKind
      : null
    const body = compactString(item.body, 2_000)
    if (!role || !kind || !body) return []

    const importance = typeof item.importance === 'string' && VALID_ACTIVITY_IMPORTANCE.has(item.importance as AiTaskActivityImportance)
      ? item.importance as AiTaskActivityImportance
      : undefined
    const dedupeKey = compactString(item.dedupe_key ?? item.dedupeKey, 240) ?? undefined
    const createdAtRaw = compactString(item.created_at ?? item.createdAt, 80)
    const createdAt = createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw).toISOString()
      : undefined

    return [{
      role,
      kind,
      body,
      importance,
      dedupeKey,
      createdAt,
      metadata: isRecord(item.metadata) ? item.metadata : undefined,
    }]
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
    const status = typeof body.status === 'string' ? body.status : ''
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })

    const { data: task } = await supabase
      .from('ai_tasks')
          .select('id, user_id, space_id, claimed_runner_id, claim_expires_at, status, source_task_id')
      .eq('id', id)
      .maybeSingle()
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.user_id !== token.user_id && task.space_id !== token.space_id) {
      return NextResponse.json({ error: 'Task is outside this agent token scope' }, { status: 403 })
    }
    if (isClaimedByOtherActiveRunner(task, runnerId)) {
      return NextResponse.json({ error: 'Task is claimed by another runner' }, { status: 409 })
    }

    const updates: Record<string, unknown> = {
      status,
    }
    if (body.result && typeof body.result === 'object') updates.result = body.result
    if (typeof body.error === 'string') updates.error = body.error
    if (status === 'running') updates.started_at = new Date().toISOString()
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date().toISOString()
      updates.claim_expires_at = null
    }

    const resultForSourceCompletion = isRecord(body.result) ? body.result : null
    if (shouldCompleteSourceTaskFromAgentState({
      status,
      result: resultForSourceCompletion,
      sourceTaskId: task.source_task_id,
    })) {
      const { error: sourceUpdateError } = await supabase
        .from('tasks')
        .update({
          status: 'done',
          stage: 'done',
          updated_at: new Date().toISOString(),
        })
        .eq('id', String(task.source_task_id))
        .eq('user_id', String(task.user_id))
        .is('deleted_at', null)

      if (sourceUpdateError) return NextResponse.json({ error: sourceUpdateError.message }, { status: 500 })
    }

    const { data, error } = await supabase
      .from('ai_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (isTursoConfigured()) {
      try {
        const resultJson = isRecord(body.result) ? body.result : {}
        const currentStep = compactString(resultJson.current_step, MAX_CURRENT_STEP_CHARS)
          ?? compactLatestLine(resultJson.message, MAX_CURRENT_STEP_CHARS)
          ?? compactLatestLine(resultJson.live_log, MAX_CURRENT_STEP_CHARS)
        const summary = isRecord(resultJson.progress_summary)
          ? JSON.stringify(resultJson.progress_summary).slice(0, MAX_SUMMARY_CHARS)
          : compactString(resultJson.summary, MAX_SUMMARY_CHARS)
            ?? compactLatestLine(resultJson.message, MAX_SUMMARY_CHARS)
        const statusChanged = status !== task.status
        await upsertTursoAiTask({
          id,
          user_id: String(task.user_id),
          space_id: typeof task.space_id === 'string' ? task.space_id : null,
          status,
          current_step: currentStep,
          summary,
          error_message: typeof body.error === 'string' ? body.error : null,
          started_at: status === 'running' ? new Date().toISOString() : null,
          completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
        })
        if (statusChanged) {
          await insertTaskEvent({
            task_id: id,
            user_id: String(task.user_id),
            event_type: status,
            payload_json: {
              runner_id: runnerId,
              status,
              error: typeof body.error === 'string' ? body.error : null,
            },
          })
        }
        if (statusChanged && (currentStep || summary)) {
          await insertTaskProgress({
            task_id: id,
            user_id: String(task.user_id),
            phase: status,
            message: currentStep,
            progress_json: isRecord(resultJson.progress_summary) ? resultJson.progress_summary : null,
          })
        }
      } catch (tursoError) {
        console.error('[agents/tasks/state turso]', tursoError)
      }
    }
    const activityMessages = compactActivityMessages(body.activity_messages)
    if (activityMessages.length > 0) {
      await Promise.all(activityMessages.map(message => insertAiTaskActivityMessage(supabase, {
        taskId: id,
        userId: String(task.user_id),
        role: message.role,
        kind: message.kind,
        body: message.body,
        importance: message.importance,
        metadata: {
          ...(message.metadata ?? {}),
          runner_id: runnerId,
          source: 'focusmap-agent',
        },
        dedupeKey: message.dedupeKey,
        createdAt: message.createdAt,
      }))).catch((activityError: unknown) => {
        console.error('[agents/tasks/state activity]', activityError)
      })
    }
    return NextResponse.json({ task: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
