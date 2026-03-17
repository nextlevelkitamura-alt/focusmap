import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/ideals
 * 自分の理想一覧を ideal_items と共に取得
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })
    .order('created_at', { referencedTable: 'ideal_items', ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideals: data })
}

/**
 * POST /api/ideals
 * 理想を作成（active は最大3件）
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // active な理想の件数チェック
  const { count } = await supabase
    .from('ideal_goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'active')

  if ((count ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'アクティブな理想は最大3件までです' },
      { status: 400 }
    )
  }

  const body = await request.json()
  const { title, description, category, color, duration_months, start_date, target_date, cost_total, cost_monthly } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })
  }

  // 最大 display_order を取得して末尾に追加
  const { data: lastItem } = await supabase
    .from('ideal_goals')
    .select('display_order')
    .eq('user_id', user.id)
    .order('display_order', { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (lastItem?.display_order ?? -1) + 1

  const { data, error } = await supabase
    .from('ideal_goals')
    .insert({
      user_id: user.id,
      title: title.trim(),
      description: description?.trim() || null,
      category: category || null,
      color: color || 'blue',
      duration_months: duration_months || null,
      start_date: start_date || null,
      target_date: target_date || null,
      cost_total: cost_total || null,
      cost_monthly: cost_monthly || null,
      display_order: nextOrder,
    })
    .select('*, ideal_items(*)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideal: data }, { status: 201 })
}
