import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// GET /api/ai-tasks — 自分のAIタスク一覧取得
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 500)

  let query = supabase
    .from('ai_tasks')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }

  // scheduled=true のとき recurrence_cron が設定されたタスクのみ返す
  const scheduled = searchParams.get('scheduled')
  if (scheduled === 'true') {
    query = query.not('recurrence_cron', 'is', null)
  }

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
  const { prompt, skill_id, approval_type, parent_task_id } = body

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      prompt: prompt.trim(),
      skill_id: skill_id || null,
      approval_type: approval_type || 'auto',
      parent_task_id: parent_task_id || null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    console.error('[ai-tasks]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
