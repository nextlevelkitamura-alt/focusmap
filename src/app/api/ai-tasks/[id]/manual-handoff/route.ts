import { NextRequest, NextResponse } from 'next/server'
import { insertAiTaskActivityMessage } from '@/lib/ai-task-activity'
import {
  buildManualCodexHandoffConfirmedResult,
  isPassiveManualCodexHandoffEvent,
  isManualCodexHandoffWaiting,
  MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
  MANUAL_CODEX_HANDOFF_CONFIRMED_STEP,
  type ManualCodexHandoffEvent,
} from '@/lib/codex-manual-handoff'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { canEditSpace } from '@/lib/space-access'
import { isTursoConfigured } from '@/lib/turso/client'
import { insertTaskEvent, upsertTursoAiTask } from '@/lib/turso/codex-monitoring'
import { createClient } from '@/utils/supabase/server'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function taskProgressSource(input: {
  source_task_id?: string | null
  source_note_id?: string | null
  source_ideal_goal_id?: string | null
}) {
  if (input.source_task_id) return { source_type: 'mindmap', source_id: input.source_task_id }
  if (input.source_note_id) return { source_type: 'note', source_id: input.source_note_id }
  if (input.source_ideal_goal_id) return { source_type: 'ideal_goal', source_id: input.source_ideal_goal_id }
  return { source_type: null, source_id: null }
}

function handoffEvent(value: unknown): ManualCodexHandoffEvent {
  return value === 'external_app_opened' || value === 'external_app_returned' || value === 'screen_switched'
    ? value
    : 'screen_switched'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const body = await req.json().catch(() => ({})) as unknown
  const event = handoffEvent(isRecord(body) ? body.event : null)
  const nowIso = new Date().toISOString()

  const { data: task, error: taskError } = await supabase
    .from('ai_tasks')
    .select('id, user_id, space_id, run_visibility, prompt, status, result, executor, cwd, codex_thread_id, source_task_id, source_note_id, source_ideal_goal_id, created_at, started_at, completed_at')
    .eq('id', id)
    .maybeSingle()

  if (taskError) {
    console.error('[ai-tasks/manual-handoff] fetch', taskError.message)
    return NextResponse.json({ error: 'Task fetch failed' }, { status: 500 })
  }
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ownsTask = task.user_id === user.id
  const canEditSharedTask =
    !ownsTask &&
    task.run_visibility === 'space' &&
    typeof task.space_id === 'string' &&
    await canEditSpace(supabase, user.id, task.space_id)

  if (!ownsTask && !canEditSharedTask) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (task.executor !== 'codex_app') {
    return NextResponse.json({ error: 'Not a Codex.app task' }, { status: 400 })
  }

  const currentResult = isRecord(task.result) ? task.result : {}
  if (currentResult.codex_manual_handoff !== true) {
    return NextResponse.json({ error: 'Not a manual Codex handoff task' }, { status: 400 })
  }

  if (!isManualCodexHandoffWaiting(task)) {
    return NextResponse.json(task)
  }

  if (isPassiveManualCodexHandoffEvent(event)) {
    return NextResponse.json(task)
  }

  const nextResult = buildManualCodexHandoffConfirmedResult(currentResult, {
    nowIso,
    event,
  })

  const { data: updated, error: updateError } = await supabase
    .from('ai_tasks')
    .update({
      status: 'awaiting_approval',
      result: nextResult,
      started_at: task.started_at || nowIso,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    console.error('[ai-tasks/manual-handoff] update', updateError.message)
    return NextResponse.json({ error: 'Manual handoff update failed' }, { status: 500 })
  }

  await insertAiTaskActivityMessage(supabase, {
    taskId: updated.id,
    userId: updated.user_id,
    role: 'codex',
    kind: 'approval',
    body: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
    metadata: {
      source: 'focusmap_manual_handoff',
      event,
    },
    dedupeKey: `task:${updated.id}:manual-handoff-confirmed`,
    createdAt: nowIso,
  }).catch((activityError: unknown) => {
    console.error('[ai-tasks/manual-handoff] activity', activityError)
  })

  if (isTursoConfigured()) {
    try {
      const source = taskProgressSource({
        source_task_id: stringValue(updated.source_task_id),
        source_note_id: stringValue(updated.source_note_id),
        source_ideal_goal_id: stringValue(updated.source_ideal_goal_id),
      })
      const nextResultRecord = nextResult as Record<string, unknown>
      await upsertTursoAiTask({
        id: String(updated.id),
        user_id: String(updated.user_id),
        space_id: typeof updated.space_id === 'string' ? updated.space_id : null,
        title: stringValue(updated.prompt).slice(0, 140),
        status: 'awaiting_approval',
        executor: 'codex_app',
        dispatch_mode: 'manual',
        source_type: source.source_type,
        source_id: source.source_id,
        codex_thread_id: stringValue(updated.codex_thread_id) || stringValue(nextResultRecord.codex_thread_id),
        current_step: MANUAL_CODEX_HANDOFF_CONFIRMED_STEP,
        summary: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
        created_at: typeof updated.created_at === 'string' ? updated.created_at : nowIso,
        updated_at: nowIso,
        started_at: typeof updated.started_at === 'string' ? updated.started_at : nowIso,
        completed_at: typeof updated.completed_at === 'string' ? updated.completed_at : null,
      })
      await insertTaskEvent({
        id: `manual-handoff:${updated.id}:awaiting_approval`,
        task_id: String(updated.id),
        user_id: String(updated.user_id),
        event_type: 'status:awaiting_approval',
        payload_json: {
          source: 'focusmap_manual_handoff',
          event,
          codex_run_state: 'awaiting_approval',
          current_step: MANUAL_CODEX_HANDOFF_CONFIRMED_STEP,
        },
        created_at: nowIso,
      })
    } catch (tursoError) {
      console.error('[ai-tasks/manual-handoff] turso', tursoError)
    }
  }

  return NextResponse.json(updated)
}
