import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

const NOTE_STATUSES = ['pending', 'processed', 'archived'] as const
const INPUT_TYPES = ['text', 'voice'] as const

type NoteStatus = typeof NOTE_STATUSES[number]
type NoteInputType = typeof INPUT_TYPES[number]

export async function OPTIONS() {
  return handleCors()
}

function normalizeLimit(value: string | null) {
  const parsed = parseInt(value ?? '50', 10)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(Math.max(parsed, 1), 200)
}

function isNoteStatus(value: unknown): value is NoteStatus {
  return typeof value === 'string' && NOTE_STATUSES.includes(value as NoteStatus)
}

function isInputType(value: unknown): value is NoteInputType {
  return typeof value === 'string' && INPUT_TYPES.includes(value as NoteInputType)
}

async function resolveProjectId(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  projectId?: string | null,
  projectTitle?: string | null,
) {
  if (projectId) return { projectId }
  if (!projectTitle) return { projectId: null }

  const { data, error } = await serviceClient
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .eq('title', projectTitle)
    .maybeSingle()

  if (error) return { error: error.message }
  return { projectId: data?.id ?? null }
}

// GET /api/v1/notes?project_id=...&status=pending
// GET /api/v1/notes?project_title=SNS投稿&status=pending
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'notes:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const projectIdParam = searchParams.get('project_id')
  const projectTitle = searchParams.get('project_title')
  const status = searchParams.get('status')
  const inputType = searchParams.get('input_type')
  const q = searchParams.get('q')
  const includeArchived = searchParams.get('include_archived') === 'true'
  const limit = normalizeLimit(searchParams.get('limit'))
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0

  if (status && !isNoteStatus(status)) {
    return apiError('VALIDATION_ERROR', 'status must be pending, processed, or archived', 400)
  }
  if (inputType && !isInputType(inputType)) {
    return apiError('VALIDATION_ERROR', 'input_type must be text or voice', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const resolved = await resolveProjectId(serviceClient, auth.userId, projectIdParam, projectTitle)
  if (resolved.error) return apiError('QUERY_ERROR', resolved.error, 500)
  if (projectTitle && !resolved.projectId) return apiSuccess([])

  let query = serviceClient
    .from('notes')
    .select('*')
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (projectIdParam === '__unassigned__') {
    query = query.is('project_id', null)
  } else if (resolved.projectId) {
    query = query.eq('project_id', resolved.projectId)
  }

  if (status) {
    query = query.eq('status', status)
  } else if (!includeArchived) {
    query = query.neq('status', 'archived')
  }

  if (inputType) query = query.eq('input_type', inputType)
  if (q) query = query.ilike('content', `%${q}%`)

  const { data, error } = await query
  if (error) return apiError('QUERY_ERROR', error.message, 500)

  return apiSuccess(data)
}

// POST /api/v1/notes — Create a note. project_title can be used instead of project_id.
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'notes:write')
  if (isAuthError(auth)) return auth

  let body: {
    content?: string
    raw_input?: string | null
    input_type?: string
    project_id?: string | null
    project_title?: string | null
    status?: string
    ai_analysis?: unknown
  }

  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.content || typeof body.content !== 'string' || body.content.trim() === '') {
    return apiError('VALIDATION_ERROR', 'content is required', 400)
  }
  if (body.status !== undefined && !isNoteStatus(body.status)) {
    return apiError('VALIDATION_ERROR', 'status must be pending, processed, or archived', 400)
  }
  if (body.input_type !== undefined && !isInputType(body.input_type)) {
    return apiError('VALIDATION_ERROR', 'input_type must be text or voice', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const resolved = await resolveProjectId(serviceClient, auth.userId, body.project_id, body.project_title)
  if (resolved.error) return apiError('QUERY_ERROR', resolved.error, 500)
  if (body.project_title && !resolved.projectId) {
    return apiError('VALIDATION_ERROR', `project_title not found: ${body.project_title}`, 400)
  }

  const { data, error } = await serviceClient
    .from('notes')
    .insert({
      user_id: auth.userId,
      content: body.content.trim(),
      raw_input: body.raw_input ?? null,
      input_type: body.input_type ?? 'text',
      project_id: resolved.projectId,
      status: body.status ?? 'pending',
      ...(body.ai_analysis !== undefined && { ai_analysis: body.ai_analysis }),
    })
    .select('*')
    .single()

  if (error) return apiError('INSERT_ERROR', error.message, 500)
  return apiSuccess(data, 201)
}

// PATCH /api/v1/notes — Update project/status. used=true maps to status=archived.
export async function PATCH(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'notes:write')
  if (isAuthError(auth)) return auth

  let body: {
    id?: string
    project_id?: string | null
    project_title?: string | null
    status?: string
    used?: boolean
    content?: string
    ai_analysis?: unknown
  }

  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.id) return apiError('VALIDATION_ERROR', 'id is required', 400)
  if (body.status !== undefined && !isNoteStatus(body.status)) {
    return apiError('VALIDATION_ERROR', 'status must be pending, processed, or archived', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const updates: Record<string, unknown> = {}
  if (body.content !== undefined) updates.content = body.content.trim()
  if (body.used === true) updates.status = 'archived'
  if (body.used === false) updates.status = 'pending'
  if (body.status !== undefined) updates.status = body.status
  if (body.ai_analysis !== undefined) updates.ai_analysis = body.ai_analysis

  if (body.project_id !== undefined || body.project_title !== undefined) {
    const resolved = await resolveProjectId(serviceClient, auth.userId, body.project_id, body.project_title)
    if (resolved.error) return apiError('QUERY_ERROR', resolved.error, 500)
    if (body.project_title && !resolved.projectId) {
      return apiError('VALIDATION_ERROR', `project_title not found: ${body.project_title}`, 400)
    }
    updates.project_id = resolved.projectId
  }

  if (Object.keys(updates).length === 0) {
    return apiError('VALIDATION_ERROR', 'No updates provided', 400)
  }

  const { data, error } = await serviceClient
    .from('notes')
    .update(updates)
    .eq('id', body.id)
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error) return apiError('UPDATE_ERROR', error.message, 500)
  return apiSuccess(data)
}
