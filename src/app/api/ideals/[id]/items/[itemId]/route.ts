import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { calcDailyMinutes, calcMonthlyCost, calcAnnualCost, FrequencyType, CostType } from '@/types/database'

/**
 * PATCH /api/ideals/[id]/items/[itemId]
 * アイテムを更新し、daily_minutes を再計算
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id: idealId, itemId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const allowedFields = [
    'title', 'item_type', 'frequency_type', 'frequency_value',
    'session_minutes', 'item_cost', 'cost_type', 'is_done',
    'linked_task_id', 'linked_habit_id', 'display_order',
    'description', 'scheduled_date', 'reference_url',
  ]
  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field]
  }

  // 時間負荷フィールドが変わった場合は daily_minutes を再計算
  const needsRecalc = ['frequency_type', 'frequency_value', 'session_minutes'].some(f => f in body)
  if (needsRecalc) {
    // 現在の値を取得して上書き分と合成
    const { data: current } = await supabase
      .from('ideal_items')
      .select('frequency_type, frequency_value, session_minutes')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single()

    if (current) {
      const ft = (updates.frequency_type ?? current.frequency_type) as FrequencyType
      const fv = (updates.frequency_value ?? current.frequency_value) as number
      const sm = (updates.session_minutes ?? current.session_minutes) as number
      updates.daily_minutes = calcDailyMinutes(ft, fv, sm)
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '更新するフィールドがありません' }, { status: 400 })
  }

  const { data: item, error } = await supabase
    .from('ideal_items')
    .update(updates)
    .eq('id', itemId)
    .eq('ideal_id', idealId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // total_daily_minutes を再集計
  if (needsRecalc) {
    await recalcTotalDailyMinutes(supabase, idealId, user.id)
  }

  // コスト関連フィールドが変わった場合はコスト再集計
  const needsCostRecalc = ['item_cost', 'cost_type'].some(f => f in body)
  if (needsCostRecalc) {
    await recalcCostSummary(supabase, idealId, user.id)
  }

  return NextResponse.json({ item })
}

/**
 * DELETE /api/ideals/[id]/items/[itemId]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id: idealId, itemId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('ideal_items')
    .delete()
    .eq('id', itemId)
    .eq('ideal_id', idealId)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // total_daily_minutes + コストを再集計
  await recalcTotalDailyMinutes(supabase, idealId, user.id)
  await recalcCostSummary(supabase, idealId, user.id)

  return NextResponse.json({ success: true })
}

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

async function recalcCostSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  idealId: string,
  userId: string
) {
  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('duration_months')
    .eq('id', idealId)
    .single()

  const { data: items } = await supabase
    .from('ideal_items')
    .select('item_cost, cost_type')
    .eq('ideal_id', idealId)
    .eq('user_id', userId)
    .not('item_cost', 'is', null)

  let costMonthly = 0
  let costTotal = 0

  for (const item of items ?? []) {
    if (item.item_cost && item.cost_type) {
      costMonthly += calcMonthlyCost(item.cost_type as CostType, item.item_cost, goal?.duration_months ?? null)
      costTotal += calcAnnualCost(item.cost_type as CostType, item.item_cost)
    }
  }

  await supabase
    .from('ideal_goals')
    .update({ cost_total: costTotal, cost_monthly: costMonthly })
    .eq('id', idealId)
    .eq('user_id', userId)
}
