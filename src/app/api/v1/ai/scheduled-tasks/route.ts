import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { canViewSpace, normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'

export async function OPTIONS() {
  return handleCors()
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scheduled-tasks — AI実行タスクの一覧取得
// クエリ: status (pending|running|completed|...), executor, from, to, scheduled (true で recurring のみ), limit, offset
// ─────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['ai:tasks:read', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const executor = searchParams.get('executor')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const scheduled = searchParams.get('scheduled') // 'true' で recurring_cron IS NOT NULL のみ
  const spaceId = searchParams.get('space_id')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  let query = serviceClient
    .from('ai_tasks')
    .select('*')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (spaceId === '__unassigned__') {
    query = query.eq('user_id', auth.userId).is('space_id', null)
  } else if (spaceId) {
    if (!(await canViewSpace(serviceClient, auth.userId, spaceId))) {
      return apiError('FORBIDDEN', 'No access to the selected space', 403)
    }
    query = query
      .eq('space_id', spaceId)
      .or(`user_id.eq.${auth.userId},run_visibility.eq.space`)
  } else {
    query = query.eq('user_id', auth.userId)
  }

  if (status) query = query.eq('status', status)
  if (executor) {
    if (!['claude', 'codex', 'codex_app'].includes(executor)) {
      return apiError('VALIDATION_ERROR', 'executor must be claude|codex|codex_app', 400)
    }
    query = query.eq('executor', executor)
  }
  if (from) {
    if (Number.isNaN(Date.parse(from))) {
      return apiError('VALIDATION_ERROR', 'from must be a valid ISO8601 datetime', 400)
    }
    query = query.gte('scheduled_at', new Date(from).toISOString())
  }
  if (to) {
    if (Number.isNaN(Date.parse(to))) {
      return apiError('VALIDATION_ERROR', 'to must be a valid ISO8601 datetime', 400)
    }
    query = query.lt('scheduled_at', new Date(to).toISOString())
  }
  if (scheduled === 'true') query = query.not('recurrence_cron', 'is', null)

  const { data, error } = await query
  if (error) return apiError('QUERY_ERROR', error.message, 500)

  return apiSuccess(data)
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scheduled-tasks — AI実行タスクの新規作成
// ボディ:
//   prompt (必須)            — 実行するプロンプト or スキル名
//   cwd                      — 作業ディレクトリ（絶対パス）
//   scheduled_at             — 実行時刻（ISO8601、単発）
//   recurrence_cron          — 繰り返し cron（5フィールド、JST）
//   approval_type            — 'auto' | 'confirm' | 'interactive'（既定: interactive）
//   executor                 — 'claude' | 'codex' | 'codex_app'（既定: claude）
//   skill_id                 — 任意のスキル識別子
//   parent_task_id           — 親タスクへの紐付け（任意）
// ─────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['ai:tasks:write', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  let body: {
    prompt?: string
    cwd?: string | null
    scheduled_at?: string | null
    recurrence_cron?: string | null
    approval_type?: string
    executor?: string
    skill_id?: string | null
    parent_task_id?: string | null
    status?: string
    result?: Record<string, unknown> | null
    error?: string | null
    started_at?: string | null
    completed_at?: string | null
    space_id?: string | null
    run_visibility?: string
  }
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return apiError('VALIDATION_ERROR', 'prompt is required', 400)
  }

  const approval = body.approval_type ?? 'interactive'
  if (!['auto', 'confirm', 'interactive'].includes(approval)) {
    return apiError('VALIDATION_ERROR', 'approval_type must be auto|confirm|interactive', 400)
  }
  const executor = body.executor ?? 'claude'
  if (!['claude', 'codex', 'codex_app'].includes(executor)) {
    return apiError('VALIDATION_ERROR', 'executor must be claude|codex|codex_app', 400)
  }
  const status = body.status ?? 'pending'
  if (!['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'].includes(status)) {
    return apiError('VALIDATION_ERROR', 'Invalid status', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const resolvedSpace = await resolveAiTaskSpaceId(serviceClient, auth.userId, {
    space_id: body.space_id ?? null,
    parent_task_id: body.parent_task_id ?? null,
  })
  if (resolvedSpace.error) {
    return apiError('FORBIDDEN', resolvedSpace.error, 403)
  }

  const insertPayload = {
    user_id: auth.userId,
    space_id: resolvedSpace.spaceId,
    prompt,
    skill_id: body.skill_id ?? null,
    approval_type: approval,
    status,
    result: body.result ?? null,
    error: body.error ?? null,
    scheduled_at: body.scheduled_at ?? (body.recurrence_cron ? null : new Date().toISOString()),
    recurrence_cron: body.recurrence_cron ?? null,
    cwd: body.cwd ?? null,
    parent_task_id: body.parent_task_id ?? null,
    executor,
    started_at: body.started_at ?? null,
    completed_at: body.completed_at ?? null,
    run_visibility: normalizeVisibility(body.run_visibility, resolvedSpace.spaceId ? 'space' : 'private'),
  }

  const { data, error } = await serviceClient
    .from('ai_tasks')
    .insert(insertPayload)
    .select()
    .single()

  if (error) return apiError('INSERT_ERROR', error.message, 500)

  return apiSuccess(data, 201)
}
