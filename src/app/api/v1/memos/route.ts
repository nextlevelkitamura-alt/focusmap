import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import {
  arrayField,
  changedMeta,
  compactText,
  idempotencyKey,
  isRecord,
  jsonValue,
  normalizeLimit,
  normalizeOffset,
  nullableText,
  titleFromBody,
} from '../_lib/external-ai'

function isDuplicateKeyError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '23505' || /duplicate key/i.test(error?.message ?? '')
}

export async function OPTIONS() {
  return handleCors()
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['memos:read', 'notes:read'])
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const status = searchParams.get('status')
  const q = searchParams.get('q')
  const includeCompleted = searchParams.get('include_completed') === 'true'
  const includeStructured = searchParams.get('include_structured') !== 'false'
  const limit = normalizeLimit(searchParams.get('limit'), 50, 200)
  const offset = normalizeOffset(searchParams.get('offset'))

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  let query = serviceClient
    .from('ideal_goals')
    .select('id, title, description, project_id, status, memo_status, scheduled_at, duration_minutes, is_completed, is_today, tags, ai_source_payload, created_at, updated_at')
    .eq('user_id', auth.userId)
    .in('status', ['wishlist', 'memo'])
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (projectId === '__unassigned__') query = query.is('project_id', null)
  else if (projectId) query = query.eq('project_id', projectId)
  if (status) query = query.eq('memo_status', status)
  if (!includeCompleted) query = query.eq('is_completed', false)
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`)

  const { data: memos, error } = await query
  if (error) return apiError('QUERY_ERROR', error.message, 500)

  let memoItems: unknown[] = []
  if (includeStructured) {
    let itemQuery = serviceClient
      .from('memo_items')
      .select('id, source_type, source_id, parent_item_id, project_id, title, body, item_kind, status, order_index, metadata, created_at, updated_at')
      .eq('user_id', auth.userId)
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (projectId === '__unassigned__') itemQuery = itemQuery.is('project_id', null)
    else if (projectId) itemQuery = itemQuery.eq('project_id', projectId)
    const { data, error: itemError } = await itemQuery
    if (itemError) return apiError('QUERY_ERROR', itemError.message, 500)
    memoItems = data ?? []
  }

  return apiSuccess({ memos: memos ?? [], memo_items: memoItems })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['memos:write', 'notes:write'])
  if (isAuthError(auth)) return auth

  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)

  const title = titleFromBody(body.title, body.body ?? body.description, '')
  const description = nullableText(body.body ?? body.description, 5000)
  if (!title && !description) {
    return apiError('VALIDATION_ERROR', 'title or body is required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const projectId = nullableText(body.project_id ?? body.projectId, 120)
  if (projectId) {
    const { data: project, error: projectError } = await serviceClient
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .maybeSingle()
    if (projectError) return apiError('QUERY_ERROR', projectError.message, 500)
    if (!project) return apiError('VALIDATION_ERROR', 'project_id not found', 400)
  }

  const { count } = await serviceClient
    .from('ideal_goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .in('status', ['wishlist', 'memo'])

  const key = idempotencyKey(request.headers)
  const insertPayload: Record<string, unknown> = {
    user_id: auth.userId,
    title: title || titleFromBody(null, description, 'Untitled'),
    description,
    project_id: projectId,
    scheduled_at: nullableText(body.scheduled_at ?? body.scheduledAt, 80),
    duration_minutes: typeof body.duration_minutes === 'number'
      ? Math.max(0, Math.round(body.duration_minutes))
      : typeof body.durationMinutes === 'number'
        ? Math.max(0, Math.round(body.durationMinutes))
        : null,
    tags: arrayField(body, 'tags').filter((tag): tag is string => typeof tag === 'string'),
    memo_status: body.scheduled_at || body.scheduledAt ? 'time_candidates' : 'unsorted',
    status: 'memo',
    color: '#6366f1',
    display_order: (count ?? 0) + 1,
    total_daily_minutes: 0,
    is_completed: false,
    is_today: false,
    ai_source_payload: jsonValue({
      external_api: {
        source: 'api_v1_memos',
        idempotency_key: key,
        source_context: body.source_context ?? body.sourceContext ?? null,
      },
    }),
  }

  const { data, error } = await serviceClient
    .from('ideal_goals')
    .insert(insertPayload)
    .select('*, ideal_items(*)')
    .single()

  if (error) {
    if (isDuplicateKeyError(error)) return apiError('CONFLICT', error.message, 409)
    return apiError('INSERT_ERROR', error.message, 500)
  }

  const suggestions = arrayField(body, 'subtask_suggestions', 'subtaskSuggestions')
    .filter(isRecord)
    .filter(item => compactText(item.title, 160))
    .slice(0, 8)
  if (data?.id && suggestions.length > 0) {
    const rows = suggestions.map((item, index) => ({
      ideal_id: data.id,
      user_id: auth.userId,
      title: compactText(item.title, 160),
      item_type: 'task',
      frequency_type: 'once',
      frequency_value: 1,
      session_minutes: typeof item.estimated_minutes === 'number' ? Math.round(item.estimated_minutes) : 0,
      daily_minutes: 0,
      description: nullableText(item.reason, 1000),
      display_order: index,
    }))
    await serviceClient.from('ideal_items').insert(rows)
  }

  return apiSuccess({ memo: data }, 201, changedMeta(['ideal_goals', ...(suggestions.length > 0 ? ['ideal_items'] : [])]))
}
