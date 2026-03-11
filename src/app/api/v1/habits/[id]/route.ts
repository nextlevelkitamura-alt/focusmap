import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/habits/[id] — Get a single habit with completions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'habits:read')
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
    .eq('is_habit', true)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Habit not found', 404)
  }

  return apiSuccess(data)
}

// PATCH /api/v1/habits/[id] — Update a habit
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'habits:write')
  if (isAuthError(auth)) return auth

  const { id } = await params

  let body: {
    title?: string
    habit_frequency?: string
    habit_icon?: string
    habit_start_date?: string | null
    habit_end_date?: string | null
    project_id?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  const allowedFields = [
    'title', 'habit_frequency', 'habit_icon',
    'habit_start_date', 'habit_end_date', 'project_id',
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
    .eq('is_habit', true)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Habit not found or update failed', 404)
  }

  return apiSuccess(data)
}

// DELETE /api/v1/habits/[id] — Soft delete a habit
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'habits:write')
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
    .eq('is_habit', true)
    .is('deleted_at', null)
    .select('id, deleted_at')
    .single()

  if (error || !data) {
    return apiError('NOT_FOUND', 'Habit not found or already deleted', 404)
  }

  return apiSuccess(data)
}
