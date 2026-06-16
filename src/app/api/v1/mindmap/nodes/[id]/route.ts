import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { syncTaskToCalendarV1 } from '../../../_lib/calendar-sync'
import { changedMeta, compactText, isRecord, nullableText, numberField } from '../../../_lib/external-ai'

function priorityValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null
  const map: Record<string, number> = { high: 3, medium: 2, low: 1 }
  return map[value] ?? null
}

export async function OPTIONS() {
  return handleCors()
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'mindmap:write')
  if (isAuthError(auth)) return auth

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)

  const updates: Record<string, unknown> = {}
  if ('title' in body) {
    const title = compactText(body.title, 300)
    if (!title) return apiError('VALIDATION_ERROR', 'title cannot be empty', 400)
    updates.title = title
  }
  if ('memo' in body) updates.memo = nullableText(body.memo, 5000)
  if ('status' in body) updates.status = compactText(body.status, 80)
  if ('stage' in body) updates.stage = compactText(body.stage, 80)
  if ('priority' in body) updates.priority = priorityValue(body.priority)
  if ('project_id' in body || 'projectId' in body) updates.project_id = nullableText(body.project_id ?? body.projectId, 120)
  if ('parent_task_id' in body || 'parentTaskId' in body) updates.parent_task_id = nullableText(body.parent_task_id ?? body.parentTaskId, 120)
  if ('calendar_id' in body || 'calendarId' in body) updates.calendar_id = nullableText(body.calendar_id ?? body.calendarId, 255)
  if ('scheduled_at' in body || 'scheduledAt' in body) updates.scheduled_at = nullableText(body.scheduled_at ?? body.scheduledAt, 80)
  if ('order_index' in body || 'orderIndex' in body) updates.order_index = numberField(body, 'order_index', 'orderIndex') ?? 0
  if ('estimated_time' in body || 'estimatedTime' in body) updates.estimated_time = numberField(body, 'estimated_time', 'estimatedTime') ?? 0
  if ('is_group' in body && typeof body.is_group === 'boolean') updates.is_group = body.is_group
  if ('isGroup' in body && typeof body.isGroup === 'boolean') updates.is_group = body.isGroup
  updates.updated_at = new Date().toISOString()

  if (Object.keys(updates).length <= 1) return apiError('VALIDATION_ERROR', 'No updatable fields provided', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .select('*')
    .single()
  if (error || !data) return apiError('NOT_FOUND', 'Mindmap node not found or update failed', 404)

  if ((body.sync_calendar || body.syncCalendar) && data.scheduled_at) {
    syncTaskToCalendarV1(serviceClient, auth.userId, {
      id: data.id,
      title: data.title,
      scheduled_at: data.scheduled_at,
      estimated_time: data.estimated_time ?? 30,
      google_event_id: data.google_event_id,
      calendar_id: data.calendar_id ?? undefined,
    }).catch(() => {})
  }

  return apiSuccess({ node: data }, 200, changedMeta(['tasks']))
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'mindmap:write')
  if (isAuthError(auth)) return auth

  const { id } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .select('id, deleted_at')
    .single()
  if (error || !data) return apiError('NOT_FOUND', 'Mindmap node not found or already deleted', 404)

  return apiSuccess({ node: data }, 200, changedMeta(['tasks']))
}
