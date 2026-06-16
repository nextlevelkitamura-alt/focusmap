import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { changedMeta, compactText, isRecord } from '../../_lib/external-ai'

export async function OPTIONS() {
  return handleCors()
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'projects:read')
  if (isAuthError(auth)) return auth

  const { id } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data, error } = await serviceClient
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle()
  if (error) return apiError('QUERY_ERROR', error.message, 500)
  if (!data) return apiError('NOT_FOUND', 'Project not found', 404)
  return apiSuccess(data)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, 'projects:write')
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
  if ('description' in body) updates.description = compactText(body.description, 3000)
  if ('purpose' in body) updates.purpose = compactText(body.purpose, 1200) || null
  if ('status' in body) updates.status = compactText(body.status, 80)
  if ('category_tag' in body) updates.category_tag = compactText(body.category_tag, 80) || null
  if ('color_theme' in body) updates.color_theme = compactText(body.color_theme, 80) || null
  if ('repo_path' in body) updates.repo_path = compactText(body.repo_path, 500) || null
  if ('priority' in body && typeof body.priority === 'number' && Number.isFinite(body.priority)) {
    updates.priority = Math.round(body.priority)
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
    .from('projects')
    .update(updates)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .select('*')
    .single()
  if (error) return apiError('UPDATE_ERROR', error.message, 500)
  return apiSuccess(data, 200, changedMeta(['projects']))
}
