import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

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
    .eq('user_id', auth.userId)
    .single()

  if (error || !data) return apiError('NOT_FOUND', 'Task not found', 404)
  return apiSuccess(data)
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/ai/scheduled-tasks/[id]
// 任意フィールド: prompt, scheduled_at, recurrence_cron, cwd, approval_type, status, completed_at
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

  const updates: Record<string, unknown> = {}
  const allowedFields = [
    'prompt', 'scheduled_at', 'recurrence_cron', 'cwd',
    'approval_type', 'status', 'completed_at', 'skill_id',
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

  if (Object.keys(updates).length === 0) {
    return apiError('VALIDATION_ERROR', 'No updatable fields provided', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('ai_tasks')
    .update(updates)
    .eq('id', id)
    .eq('user_id', auth.userId)
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

  const { error } = await serviceClient
    .from('ai_tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId)

  if (error) return apiError('DELETE_ERROR', error.message, 500)

  return apiSuccess({ deleted: true })
}
