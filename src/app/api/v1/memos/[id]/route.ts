import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { changedMeta, compactText, isRecord, nullableText } from '../../_lib/external-ai'

export async function OPTIONS() {
  return handleCors()
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['memos:write', 'notes:write'])
  if (isAuthError(auth)) return auth

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)

  const updates: Record<string, unknown> = {}
  if ('title' in body) {
    const title = compactText(body.title, 160)
    if (!title) return apiError('VALIDATION_ERROR', 'title cannot be empty', 400)
    updates.title = title
  }
  if ('body' in body || 'description' in body) updates.description = nullableText(body.body ?? body.description, 5000)
  if ('project_id' in body || 'projectId' in body) updates.project_id = nullableText(body.project_id ?? body.projectId, 120)
  if ('scheduled_at' in body || 'scheduledAt' in body) updates.scheduled_at = nullableText(body.scheduled_at ?? body.scheduledAt, 80)
  if ('duration_minutes' in body && typeof body.duration_minutes === 'number') updates.duration_minutes = Math.max(0, Math.round(body.duration_minutes))
  if ('durationMinutes' in body && typeof body.durationMinutes === 'number') updates.duration_minutes = Math.max(0, Math.round(body.durationMinutes))
  if ('memo_status' in body) updates.memo_status = compactText(body.memo_status, 80) || null
  if ('is_completed' in body && typeof body.is_completed === 'boolean') updates.is_completed = body.is_completed
  if ('tags' in body && Array.isArray(body.tags)) updates.tags = body.tags.filter((tag): tag is string => typeof tag === 'string')

  if (Object.keys(updates).length === 0) return apiError('VALIDATION_ERROR', 'No updatable fields provided', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('ideal_goals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .in('status', ['wishlist', 'memo'])
    .select('*')
    .single()

  if (error) return apiError('UPDATE_ERROR', error.message, 500)
  return apiSuccess({ memo: data }, 200, changedMeta(['ideal_goals']))
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['memos:write', 'notes:write'])
  if (isAuthError(auth)) return auth

  const { id } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('ideal_goals')
    .update({ status: 'archived', memo_status: 'archived', is_completed: true })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .select('id, status, memo_status, is_completed')
    .single()

  if (error) return apiError('UPDATE_ERROR', error.message, 500)
  return apiSuccess({ memo: data }, 200, changedMeta(['ideal_goals']))
}
