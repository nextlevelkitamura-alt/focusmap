import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/tasks/[id] — Get a single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'tasks:read')
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
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Task not found', 404)
  }

  return apiSuccess(data)
}

// PATCH /api/v1/tasks/[id] — Update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'tasks:write')
  if (isAuthError(auth)) return auth

  const { id } = await params

  let body: {
    title?: string
    status?: string
    stage?: string
    priority?: string
    scheduled_at?: string | null
    estimated_time?: number | null
    memo?: string | null
    order_index?: number
    project_id?: string | null
    parent_task_id?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  const allowedFields = [
    'title', 'status', 'stage', 'priority',
    'scheduled_at', 'estimated_time', 'memo',
    'order_index', 'project_id', 'parent_task_id',
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) {
      updateData[field] = (body as Record<string, unknown>)[field]
    }
  }

  if (Object.keys(updateData).length === 0) {
    return apiError('VALIDATION_ERROR', 'No updatable fields provided', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('tasks')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Task not found or update failed', 404)
  }

  return apiSuccess(data)
}

// DELETE /api/v1/tasks/[id] — Soft delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'tasks:write')
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
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .select('id, deleted_at')
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Task not found or already deleted', 404)
  }

  return apiSuccess(data)
}
