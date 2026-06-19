import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { canEditSpace, canViewSpace, normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { resolveRunningStartedAt, shouldInitializeRunningStartedAt } from '@/lib/ai-task-run-timing'

// GET /api/ai-tasks/:id — 単一AIタスク取得
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(_req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const { data, error } = await supabase
    .from('ai_tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[ai-tasks/id]', error.message)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const ownsTask = data.user_id === user.id
  const canViewSharedTask =
    !ownsTask &&
    data.run_visibility === 'space' &&
    typeof data.space_id === 'string' &&
    await canViewSpace(supabase, user.id, data.space_id)
  if (!ownsTask && !canViewSharedTask) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

// PATCH /api/ai-tasks/:id — AIタスク更新（承認・却下・修正指示）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const body = await req.json()
  const {
    status,
    result,
    error: taskError,
    prompt,
    scheduled_at,
    recurrence_cron,
    cwd,
    approval_type,
    completed_at,
    started_at,
    executor,
    skill_id,
    space_id,
    run_visibility,
  } = body

  const { data: existingTask } = await supabase
    .from('ai_tasks')
    .select('user_id, space_id, run_visibility, started_at')
    .eq('id', id)
    .maybeSingle()

  if (!existingTask) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const ownsTask = existingTask.user_id === user.id
  const canEditSharedTask =
    !ownsTask &&
    existingTask.run_visibility === 'space' &&
    typeof existingTask.space_id === 'string' &&
    await canEditSpace(supabase, user.id, existingTask.space_id)
  if (!ownsTask && !canEditSharedTask) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}

  if (status) {
    const validStatuses = ['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = status
    if (status === 'completed') updates.completed_at = new Date().toISOString()
    if (status === 'running' && shouldInitializeRunningStartedAt(existingTask.started_at)) {
      updates.started_at = resolveRunningStartedAt(existingTask.started_at)
    }
  }

  // 繰り返しタスク用: completed_at を直接更新（status は維持）
  // null を渡すとチェック解除、ISO文字列なら完了時刻を書き込み
  if (completed_at !== undefined) updates.completed_at = completed_at

  if (result !== undefined) updates.result = result
  if (taskError !== undefined) updates.error = taskError
  if (prompt !== undefined) updates.prompt = prompt
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at
  if (recurrence_cron !== undefined) updates.recurrence_cron = recurrence_cron
  if (cwd !== undefined) updates.cwd = cwd
  if (approval_type !== undefined) updates.approval_type = approval_type
  if (started_at !== undefined) updates.started_at = started_at
  if (skill_id !== undefined) updates.skill_id = skill_id
  if (space_id !== undefined) {
    if (!ownsTask && (space_id === null || space_id === '')) {
      return NextResponse.json({ error: 'Only the task owner can remove a run from its space' }, { status: 403 })
    }
    const resolved = await resolveAiTaskSpaceId(supabase, user.id, {
      space_id: typeof space_id === 'string' ? space_id : null,
    })
    if (resolved.error) {
      return NextResponse.json({ error: resolved.error }, { status: 403 })
    }
    updates.space_id = resolved.spaceId
  }
  if (run_visibility !== undefined) {
    updates.run_visibility = normalizeVisibility(run_visibility)
    if (!ownsTask && updates.run_visibility === 'private') {
      return NextResponse.json({ error: 'Only the task owner can make a shared run private' }, { status: 403 })
    }
  }
  if (executor !== undefined) {
    if (!['claude', 'codex', 'codex_app'].includes(executor)) {
      return NextResponse.json({ error: 'Invalid executor' }, { status: 400 })
    }
    updates.executor = executor
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data, error: dbError } = await supabase
    .from('ai_tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (dbError) {
    console.error('[ai-tasks/id]', dbError.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/ai-tasks/:id — AIタスク削除（スケジュール削除）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(_req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const { error } = await supabase
    .from('ai_tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[ai-tasks/id DELETE]', error.message)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
  return new NextResponse(null, { status: 204 })
}
