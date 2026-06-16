import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { changedMeta, compactText, isRecord, nullableText, numberField } from '../../_lib/external-ai'

function priorityValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null
  const map: Record<string, number> = { high: 3, medium: 2, low: 1 }
  return map[value] ?? null
}

export async function OPTIONS() {
  return handleCors()
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'mindmap:write')
  if (isAuthError(auth)) return auth

  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)

  const projectId = nullableText(body.project_id ?? body.projectId, 120)
  const title = compactText(body.title, 300)
  if (!projectId) return apiError('VALIDATION_ERROR', 'project_id is required', 400)
  if (!title) return apiError('VALIDATION_ERROR', 'title is required', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data: project, error: projectError } = await serviceClient
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', auth.userId)
    .maybeSingle()
  if (projectError) return apiError('QUERY_ERROR', projectError.message, 500)
  if (!project) return apiError('NOT_FOUND', 'Project not found', 404)

  const { data, error } = await serviceClient
    .from('tasks')
    .insert({
      user_id: auth.userId,
      project_id: projectId,
      parent_task_id: nullableText(body.parent_task_id ?? body.parentTaskId, 120),
      title,
      memo: nullableText(body.memo, 5000),
      is_group: typeof body.is_group === 'boolean'
        ? body.is_group
        : typeof body.isGroup === 'boolean'
          ? body.isGroup
          : false,
      status: compactText(body.status, 80) || 'todo',
      stage: compactText(body.stage, 80) || 'plan',
      priority: priorityValue(body.priority),
      order_index: numberField(body, 'order_index', 'orderIndex') ?? 0,
      estimated_time: numberField(body, 'estimated_time', 'estimatedTime') ?? 0,
      scheduled_at: nullableText(body.scheduled_at ?? body.scheduledAt, 80),
      calendar_id: nullableText(body.calendar_id ?? body.calendarId, 255),
      source: 'manual',
    })
    .select('*')
    .single()

  if (error) return apiError('INSERT_ERROR', error.message, 500)
  return apiSuccess({ node: data }, 201, changedMeta(['tasks']))
}
