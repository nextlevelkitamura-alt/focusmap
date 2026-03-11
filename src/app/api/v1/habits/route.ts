import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/habits — List habits (tasks where is_habit = true)
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'habits:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const project_id = searchParams.get('project_id')
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
    .eq('is_habit', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (project_id) query = query.eq('project_id', project_id)

  const { data, error } = await query

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}
