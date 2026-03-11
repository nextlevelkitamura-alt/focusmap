import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/spaces — List spaces
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'spaces:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  let query = serviceClient
    .from('spaces')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}
