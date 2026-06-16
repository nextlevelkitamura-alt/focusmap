import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { changedMeta, compactText, isRecord } from '../../../_lib/external-ai'

const PROGRESS_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'done', 'archived'])

export async function OPTIONS() {
  return handleCors()
}

async function ensureProject(serviceClient: ReturnType<typeof createServiceClient>, userId: string, projectId: string) {
  const { data, error } = await serviceClient
    .from('projects')
    .select('id, title, description')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['project:context:read', 'projects:read'])
  if (isAuthError(auth)) return auth

  const { id } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const project = await ensureProject(serviceClient, auth.userId, id)
    if (!project) return apiError('NOT_FOUND', 'Project not found', 404)

    const { data: context, error } = await serviceClient
      .from('project_contexts')
      .select('id, project_id, heading, details, progress, progress_status, progress_updated_at, updated_at')
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .maybeSingle()
    if (error) return apiError('QUERY_ERROR', error.message, 500)
    return apiSuccess({ project, context: context ?? null })
  } catch (error) {
    return apiError('QUERY_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiKey(request, ['project:context:write', 'projects:write'])
  if (isAuthError(auth)) return auth

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const project = await ensureProject(serviceClient, auth.userId, id)
    if (!project) return apiError('NOT_FOUND', 'Project not found', 404)

    const changed: string[] = []
    if ('project_description' in body || 'projectDescription' in body || 'description' in body) {
      const description = compactText(body.project_description ?? body.projectDescription ?? body.description, 3000)
      const { error } = await serviceClient
        .from('projects')
        .update({ description })
        .eq('id', id)
        .eq('user_id', auth.userId)
      if (error) return apiError('UPDATE_ERROR', error.message, 500)
      changed.push('projects')
    }

    const payload: Record<string, unknown> = {
      user_id: auth.userId,
      project_id: id,
    }
    if ('heading' in body) payload.heading = compactText(body.heading, 160)
    if ('details' in body) payload.details = compactText(body.details, 3000)
    if ('progress' in body) payload.progress = compactText(body.progress, 2000)
    const progressStatus = body.progress_status ?? body.progressStatus
    if (typeof progressStatus === 'string' && PROGRESS_STATUSES.has(progressStatus)) {
      payload.progress_status = progressStatus
      payload.progress_updated_at = new Date().toISOString()
    }

    const hasContextUpdate = ['heading', 'details', 'progress', 'progress_status'].some(key => key in payload)
    let context = null
    if (hasContextUpdate) {
      const { data, error } = await serviceClient
        .from('project_contexts')
        .upsert(payload, { onConflict: 'project_id,user_id' })
        .select('id, project_id, heading, details, progress, progress_status, progress_updated_at, updated_at')
        .single()
      if (error) return apiError('UPDATE_ERROR', error.message, 500)
      context = data
      changed.push('project_contexts')
    }

    if (changed.length === 0) return apiError('VALIDATION_ERROR', 'No context fields provided', 400)
    return apiSuccess({ project_id: id, context }, 200, changedMeta(Array.from(new Set(changed))))
  } catch (error) {
    return apiError('UPDATE_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}
