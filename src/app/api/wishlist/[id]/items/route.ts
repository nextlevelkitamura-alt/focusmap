import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })

  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!goal) return NextResponse.json({ error: 'Memo not found' }, { status: 404 })

  const { data: lastItem } = await supabase
    .from('ideal_items')
    .select('display_order')
    .eq('ideal_id', id)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('ideal_items')
    .insert({
      ideal_id: id,
      user_id: user.id,
      title,
      item_type: 'task',
      frequency_type: 'once',
      frequency_value: 1,
      session_minutes: body.estimated_minutes ?? body.session_minutes ?? 0,
      daily_minutes: 0,
      description: body.reason ?? body.description ?? null,
      reference_url: body.reference_url ?? null,
      display_order: (lastItem?.display_order ?? -1) + 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 201 })
}
