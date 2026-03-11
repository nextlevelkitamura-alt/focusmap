import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/tasks — List tasks
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'tasks:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const project_id = searchParams.get('project_id')
  const status = searchParams.get('status')
  const parent_task_id = searchParams.get('parent_task_id')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  let query = serviceClient
    .from('tasks')
    .select('*')
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true })
    .range(offset, offset + limit - 1)

  if (project_id) query = query.eq('project_id', project_id)
  if (status) query = query.eq('status', status)
  if (parent_task_id) query = query.eq('parent_task_id', parent_task_id)

  const { data, error } = await query

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}

// POST /api/v1/tasks — Create a task
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'tasks:write')
  if (isAuthError(auth)) return auth

  let body: {
    title?: string
    project_id?: string
    parent_task_id?: string
    scheduled_at?: string
    estimated_time?: number
    priority?: string
    is_group?: boolean
    memo?: string
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return apiError('VALIDATION_ERROR', 'title is required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('tasks')
    .insert({
      user_id: auth.userId,
      title: body.title.trim(),
      ...(body.project_id !== undefined && { project_id: body.project_id }),
      ...(body.parent_task_id !== undefined && { parent_task_id: body.parent_task_id }),
      ...(body.scheduled_at !== undefined && { scheduled_at: body.scheduled_at }),
      ...(body.estimated_time !== undefined && { estimated_time: body.estimated_time }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.is_group !== undefined && { is_group: body.is_group }),
      ...(body.memo !== undefined && { memo: body.memo }),
    })
    .select('*')
    .single()

  if (error) {
    return apiError('INSERT_ERROR', error.message, 500)
  }

  return apiSuccess(data, 201)
}
