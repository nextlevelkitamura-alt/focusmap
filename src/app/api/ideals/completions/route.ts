import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/ideals/completions?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 期間内の理想アイテム完了記録を取得（リンク済みアイテムのデータもマージ）
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
  }

  // 未リンクアイテムの直接完了記録
  const { data: directCompletions, error: dcError } = await supabase
    .from('ideal_item_completions')
    .select('*')
    .eq('user_id', user.id)
    .gte('completed_date', from)
    .lte('completed_date', to)

  if (dcError) {
    return NextResponse.json({ error: dcError.message }, { status: 500 })
  }

  // リンク済みハビットの完了記録
  const { data: habitCompletions, error: hcError } = await supabase
    .from('habit_completions')
    .select('*')
    .eq('user_id', user.id)
    .gte('completed_date', from)
    .lte('completed_date', to)

  if (hcError) {
    return NextResponse.json({ error: hcError.message }, { status: 500 })
  }

  return NextResponse.json({
    directCompletions: directCompletions ?? [],
    habitCompletions: habitCompletions ?? [],
  })
}

/**
 * POST /api/ideals/completions
 * 理想アイテムの完了を記録（UPSERT）
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ideal_item_id, completed_date, is_completed, elapsed_minutes, note } = await request.json()

  if (!ideal_item_id || !completed_date) {
    return NextResponse.json({ error: 'ideal_item_id and completed_date are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ideal_item_completions')
    .upsert(
      {
        ideal_item_id,
        user_id: user.id,
        completed_date,
        is_completed: is_completed ?? true,
        elapsed_minutes: elapsed_minutes ?? 0,
        note: note ?? null,
      },
      { onConflict: 'ideal_item_id,user_id,completed_date' }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ completion: data }, { status: 201 })
}

/**
 * DELETE /api/ideals/completions
 * 完了記録を削除
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ideal_item_id, completed_date } = await request.json()

  if (!ideal_item_id || !completed_date) {
    return NextResponse.json({ error: 'ideal_item_id and completed_date are required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('ideal_item_completions')
    .delete()
    .eq('ideal_item_id', ideal_item_id)
    .eq('user_id', user.id)
    .eq('completed_date', completed_date)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
