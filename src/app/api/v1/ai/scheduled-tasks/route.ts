import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scheduled-tasks — AI実行タスクの一覧取得
// クエリ: status (pending|running|completed|...), scheduled (true で recurring のみ), limit, offset
// ─────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['ai:tasks:read', 'ai:scheduling'])
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const scheduled = searchParams.get('scheduled') // 'true' で recurring_cron IS NOT NULL のみ
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
    .eq('user_id', auth.userId)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
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
    skill_id?: string | null
    parent_task_id?: string | null
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

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const insertPayload = {
    user_id: auth.userId,
    prompt,
    skill_id: body.skill_id ?? null,
    approval_type: approval,
    status: 'pending' as const,
    scheduled_at: body.scheduled_at ?? (body.recurrence_cron ? null : new Date().toISOString()),
    recurrence_cron: body.recurrence_cron ?? null,
    cwd: body.cwd ?? null,
    parent_task_id: body.parent_task_id ?? null,
  }

  const { data, error } = await serviceClient
    .from('ai_tasks')
    .insert(insertPayload)
    .select()
    .single()

  if (error) return apiError('INSERT_ERROR', error.message, 500)

  return apiSuccess(data, 201)
}
