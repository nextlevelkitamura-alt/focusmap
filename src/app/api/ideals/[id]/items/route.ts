import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { calcDailyMinutes, FrequencyType } from '@/types/database'

/**
 * GET /api/ideals/[id]/items
 * 理想のアイテム一覧を取得
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('ideal_items')
    .select('*')
    .eq('ideal_id', id)
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data })
}

/**
 * POST /api/ideals/[id]/items
 * アイテムを作成し、ideal_goals の total_daily_minutes を更新
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idealId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 所有権確認
  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('id')
    .eq('id', idealId)
    .eq('user_id', user.id)
    .single()

  if (!goal) {
    return NextResponse.json({ error: 'Ideal not found' }, { status: 404 })
  }

  const body = await request.json()
  const {
    title,
    item_type = 'habit',
    frequency_type = 'daily',
    frequency_value = 1,
    session_minutes = 0,
    item_cost,
    cost_type = 'once',
    linked_task_id,
    linked_habit_id,
  } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })
  }

  const daily_minutes = calcDailyMinutes(
    frequency_type as FrequencyType,
    frequency_value,
    session_minutes
  )

  // 最大 display_order を取得
  const { data: lastItem } = await supabase
    .from('ideal_items')
    .select('display_order')
    .eq('ideal_id', idealId)
    .order('display_order', { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (lastItem?.display_order ?? -1) + 1

  const { data: item, error } = await supabase
    .from('ideal_items')
    .insert({
      ideal_id: idealId,
      user_id: user.id,
      title: title.trim(),
      item_type,
      frequency_type,
      frequency_value,
      session_minutes,
      daily_minutes,
      item_cost: item_cost || null,
      cost_type,
      linked_task_id: linked_task_id || null,
      linked_habit_id: linked_habit_id || null,
      display_order: nextOrder,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ideal_goals の total_daily_minutes を再集計して更新
  await recalcTotalDailyMinutes(supabase, idealId, user.id)

  return NextResponse.json({ item }, { status: 201 })
}

/** ideal_goals.total_daily_minutes を ideal_items の合計から再計算して更新 */
async function recalcTotalDailyMinutes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  idealId: string,
  userId: string
) {
  const { data: items } = await supabase
    .from('ideal_items')
    .select('daily_minutes')
    .eq('ideal_id', idealId)
    .eq('user_id', userId)

  const total = (items ?? []).reduce((sum, it) => sum + (it.daily_minutes ?? 0), 0)

  await supabase
    .from('ideal_goals')
    .update({ total_daily_minutes: total })
    .eq('id', idealId)
    .eq('user_id', userId)
}
