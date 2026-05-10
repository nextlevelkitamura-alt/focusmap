import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('user_id', user.id)
    .eq('status', 'wishlist')
    .order('display_order', { ascending: true })
    .order('created_at', { referencedTable: 'ideal_items', ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, description, category, scheduled_at, duration_minutes } = body

  if (!title?.trim()) return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })

  const { count } = await supabase
    .from('ideal_goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'wishlist')

  const { data, error } = await supabase
    .from('ideal_goals')
    .insert({
      user_id: user.id,
      title: title.trim(),
      description: description ?? null,
      category: category ?? null,
      scheduled_at: scheduled_at ?? null,
      duration_minutes: duration_minutes ?? null,
      status: 'wishlist',
      color: '#6366f1',
      display_order: (count ?? 0) + 1,
    })
    .select('*, ideal_items(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 201 })
}
