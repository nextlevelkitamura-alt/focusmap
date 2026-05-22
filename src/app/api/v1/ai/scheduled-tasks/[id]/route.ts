import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { canEditSpace, canViewSpace, normalizeVisibility } from '@/lib/space-access'

export async function OPTIONS() {
  return handleCors()
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scheduled-tasks/[id]
// ─────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['ai:tasks:read', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  const { id } = await params

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('ai_tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return apiError('NOT_FOUND', 'Task not found', 404)
  if (data.user_id !== auth.userId && !(data.space_id && data.run_visibility === 'space' && await canViewSpace(serviceClient, auth.userId, data.space_id))) {
    return apiError('NOT_FOUND', 'Task not found', 404)
  }
  return apiSuccess(data)
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/ai/scheduled-tasks/[id]
// 任意フィールド: prompt, scheduled_at, recurrence_cron, cwd, approval_type, executor, status,
// started_at, completed_at, result, error, skill_id
// ─────────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['ai:tasks:write', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data: existing } = await serviceClient
    .from('ai_tasks')
    .select('user_id, space_id, run_visibility')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return apiError('NOT_FOUND', 'Task not found', 404)
  const ownsTask = existing.user_id === auth.userId
  if (!ownsTask && !(existing.space_id && existing.run_visibility === 'space' && await canEditSpace(serviceClient, auth.userId, existing.space_id))) {
    return apiError('FORBIDDEN', 'No edit access to this task', 403)
  }

  const updates: Record<string, unknown> = {}
  const allowedFields = [
    'prompt', 'scheduled_at', 'recurrence_cron', 'cwd',
    'approval_type', 'executor', 'status', 'started_at', 'completed_at',
    'result', 'error', 'skill_id', 'space_id', 'run_visibility',
  ] as const

  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (updates.approval_type !== undefined) {
    const v = updates.approval_type
    if (!['auto', 'confirm', 'interactive'].includes(v as string)) {
      return apiError('VALIDATION_ERROR', 'approval_type must be auto|confirm|interactive', 400)
    }
  }

  if (updates.status !== undefined) {
    const validStatuses = ['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed']
    if (!validStatuses.includes(updates.status as string)) {
      return apiError('VALIDATION_ERROR', 'Invalid status', 400)
    }
  }

  if (updates.executor !== undefined) {
    const validExecutors = ['claude', 'codex', 'codex_app']
    if (!validExecutors.includes(updates.executor as string)) {
      return apiError('VALIDATION_ERROR', 'executor must be claude|codex|codex_app', 400)
    }
  }

  if (updates.run_visibility !== undefined) {
    updates.run_visibility = normalizeVisibility(updates.run_visibility)
    if (!ownsTask && updates.run_visibility === 'private') {
      return apiError('FORBIDDEN', 'Only the task owner can make a shared run private', 403)
    }
  }

  if (!ownsTask && updates.space_id === null) {
    return apiError('FORBIDDEN', 'Only the task owner can remove a run from its space', 403)
  }

  if (updates.space_id !== undefined && updates.space_id !== null) {
    if (typeof updates.space_id !== 'string' || !(await canEditSpace(serviceClient, auth.userId, updates.space_id))) {
      return apiError('FORBIDDEN', 'No edit access to the selected space', 403)
    }
  }

  if (Object.keys(updates).length === 0) {
    return apiError('VALIDATION_ERROR', 'No updatable fields provided', 400)
  }

  const { data, error } = await serviceClient
    .from('ai_tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiError('UPDATE_ERROR', error.message, 500)
  if (!data) return apiError('NOT_FOUND', 'Task not found', 404)

  return apiSuccess(data)
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/ai/scheduled-tasks/[id]
// 繰り返しタスクの場合、これ1件の削除で今後の実行もすべて停止する
// （task-runner は同じ行の scheduled_at を更新する設計のため）
// ─────────────────────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['ai:tasks:write', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  const { id } = await params

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data: existing } = await serviceClient
    .from('ai_tasks')
    .select('user_id, space_id, run_visibility')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return apiError('NOT_FOUND', 'Task not found', 404)
  if (existing.user_id !== auth.userId && !(existing.space_id && existing.run_visibility === 'space' && await canEditSpace(serviceClient, auth.userId, existing.space_id))) {
    return apiError('FORBIDDEN', 'No edit access to this task', 403)
  }

  const { error } = await serviceClient
    .from('ai_tasks')
    .delete()
    .eq('id', id)

  if (error) return apiError('DELETE_ERROR', error.message, 500)

  return apiSuccess({ deleted: true })
}
