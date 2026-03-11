import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/projects — List projects
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'projects:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const space_id = searchParams.get('space_id')
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
    .from('projects')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (space_id) query = query.eq('space_id', space_id)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}

// POST /api/v1/projects — Create a project
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'projects:write')
  if (isAuthError(auth)) return auth

  let body: {
    title?: string
    space_id?: string
    purpose?: string
    category_tag?: string
    priority?: string
    color_theme?: string
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return apiError('VALIDATION_ERROR', 'title is required', 400)
  }

  if (!body.space_id || typeof body.space_id !== 'string' || body.space_id.trim() === '') {
    return apiError('VALIDATION_ERROR', 'space_id is required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('projects')
    .insert({
      user_id: auth.userId,
      title: body.title.trim(),
      space_id: body.space_id.trim(),
      ...(body.purpose !== undefined && { purpose: body.purpose }),
      ...(body.category_tag !== undefined && { category_tag: body.category_tag }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.color_theme !== undefined && { color_theme: body.color_theme }),
    })
    .select('*')
    .single()

  if (error) {
    return apiError('INSERT_ERROR', error.message, 500)
  }

  return apiSuccess(data, 201)
}
