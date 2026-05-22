import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'

// GET /api/ai-tasks — 自分のAIタスク一覧取得
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const executor = searchParams.get('executor')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const spaceId = searchParams.get('space_id')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 500)

  let query = supabase
    .from('ai_tasks')
    .select('*')
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }
  if (executor && ['claude', 'codex', 'codex_app'].includes(executor)) {
    query = query.eq('executor', executor)
  }
  if (spaceId === '__unassigned__') {
    query = query.is('space_id', null)
  } else if (spaceId) {
    query = query.eq('space_id', spaceId)
  }

  // scheduled=true のとき recurrence_cron が設定されたタスクのみ返す
  const scheduled = searchParams.get('scheduled')
  if (scheduled === 'true') {
    query = query.not('recurrence_cron', 'is', null)
  }
  if (from && !Number.isNaN(Date.parse(from))) {
    query = query.gte('scheduled_at', new Date(from).toISOString())
  }
  if (to && !Number.isNaN(Date.parse(to))) {
    query = query.lt('scheduled_at', new Date(to).toISOString())
  }

  query = from || to
    ? query.order('scheduled_at', { ascending: true, nullsFirst: false })
    : query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    console.error('[ai-tasks]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/ai-tasks — AIタスク作成（壁打ち・スキル実行）
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    prompt,
    skill_id,
    approval_type,
    parent_task_id,
    scheduled_at,
    recurrence_cron,
    cwd,
    executor,
    space_id,
    run_visibility,
  } = body

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  const selectedExecutor = executor ?? 'claude'
  if (!['claude', 'codex', 'codex_app'].includes(selectedExecutor)) {
    return NextResponse.json({ error: 'Invalid executor' }, { status: 400 })
  }

  const resolved = await resolveAiTaskSpaceId(supabase, user.id, {
    space_id: typeof space_id === 'string' ? space_id : null,
    parent_task_id: typeof parent_task_id === 'string' ? parent_task_id : null,
  })
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      space_id: resolved.spaceId,
      prompt: prompt.trim(),
      skill_id: skill_id || null,
      approval_type: approval_type || 'auto',
      parent_task_id: parent_task_id || null,
      status: 'pending',
      scheduled_at: scheduled_at ?? null,
      recurrence_cron: recurrence_cron ?? null,
      cwd: cwd ?? null,
      executor: selectedExecutor,
      run_visibility: normalizeVisibility(run_visibility, resolved.spaceId ? 'space' : 'private'),
    })
    .select()
    .single()

  if (error) {
    console.error('[ai-tasks]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
