import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/ideals/[id]/items/[itemId]/candidates
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('ideal_candidates')
    .select('*')
    .eq('item_id', itemId)
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ candidates: data })
}

/**
 * POST /api/ideals/[id]/items/[itemId]/candidates
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // アイテム所有権確認
  const { data: item } = await supabase
    .from('ideal_items')
    .select('id')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const body = await request.json()
  const { title, url, price, pros, cons, rating } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })
  }

  // 最大 display_order
  const { data: last } = await supabase
    .from('ideal_candidates')
    .select('display_order')
    .eq('item_id', itemId)
    .order('display_order', { ascending: false })
    .limit(1)
    .single()

  const { data: candidate, error } = await supabase
    .from('ideal_candidates')
    .insert({
      item_id: itemId,
      user_id: user.id,
      title: title.trim(),
      url: url || null,
      price: price || null,
      pros: pros || null,
      cons: cons || null,
      rating: rating || null,
      display_order: (last?.display_order ?? -1) + 1,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ candidate }, { status: 201 })
}
