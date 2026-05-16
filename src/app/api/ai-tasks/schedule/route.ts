import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// cronのバリデーション（5フィールド形式）
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const rangeCheck = (part: string, min: number, max: number) => {
    if (part === '*') return true
    const n = parseInt(part, 10)
    return !isNaN(n) && n >= min && n <= max
  }
  return (
    rangeCheck(parts[0], 0, 59) && // 分
    rangeCheck(parts[1], 0, 23) && // 時
    rangeCheck(parts[2], 1, 31) && // 日
    rangeCheck(parts[3], 1, 12) && // 月
    rangeCheck(parts[4], 0, 6)     // 曜日
  )
}

// POST /api/ai-tasks/schedule — スケジュール付きAIタスクを作成
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { prompt, skill_id, scheduled_at, recurrence_cron, approval_type, cwd, source_note_id, source_ideal_goal_id, executor } = body as {
    prompt?: string
    skill_id?: string
    scheduled_at?: string
    recurrence_cron?: string
    approval_type?: string
    cwd?: string
    source_note_id?: string
    source_ideal_goal_id?: string
    executor?: 'claude' | 'codex' | 'codex_app'
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  if (!scheduled_at || isNaN(Date.parse(scheduled_at))) {
    return NextResponse.json({ error: 'scheduled_at must be a valid ISO8601 datetime' }, { status: 400 })
  }

  // 過去日時は拒否（5分のバッファを許容、繰り返しタスクは過去でもOK）
  if (!recurrence_cron && new Date(scheduled_at).getTime() < Date.now() - 5 * 60_000) {
    return NextResponse.json({ error: 'scheduled_at must be in the future' }, { status: 400 })
  }

  if (recurrence_cron && !isValidCron(recurrence_cron)) {
    return NextResponse.json({ error: 'recurrence_cron must be a valid 5-field cron expression' }, { status: 400 })
  }

  const validApprovalTypes = ['auto', 'confirm', 'interactive']
  const resolvedApprovalType = validApprovalTypes.includes(approval_type ?? '')
    ? approval_type
    : 'auto'

  // 同一メモ（notes / ideal_goals）から pending/running のタスクが既にある場合は重複として拒否
  const dupeColumn = source_ideal_goal_id ? 'source_ideal_goal_id' : source_note_id ? 'source_note_id' : null
  const dupeValue = source_ideal_goal_id || source_note_id || null
  if (dupeColumn && dupeValue) {
    const { data: existing } = await supabase
      .from('ai_tasks')
      .select('id, status')
      .eq(dupeColumn, dupeValue)
      .eq('user_id', user.id)
      .in('status', ['pending', 'running'])
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'このメモは既に実行中または実行待ちです', existing_task_id: existing.id },
        { status: 409 },
      )
    }
  }

  const resolvedExecutor =
    executor === 'codex_app' ? 'codex_app' :
    executor === 'codex' ? 'codex' :
    'claude'

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      prompt: prompt.trim(),
      skill_id: skill_id || null,
      approval_type: resolvedApprovalType,
      status: 'pending',
      scheduled_at,
      recurrence_cron: recurrence_cron || null,
      cwd: cwd || null,
      source_note_id: source_note_id || null,
      source_ideal_goal_id: source_ideal_goal_id || null,
      executor: resolvedExecutor,
    })
    .select()
    .single()

  if (error) {
    console.error('[ai-tasks/schedule]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
