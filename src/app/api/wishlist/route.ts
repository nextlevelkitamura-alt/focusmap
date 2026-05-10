import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('user_id', user.id)
    .in('status', ['wishlist', 'memo'])
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
  const {
    title,
    description,
    category,
    scheduled_at,
    duration_minutes,
    tags,
    memo_status,
    ai_source_payload,
    subtask_suggestions,
  } = body

  if (!title?.trim()) return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })

  const { count } = await supabase
    .from('ideal_goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['wishlist', 'memo'])

  const insertPayload = {
    user_id: user.id,
    title: title.trim(),
    description: description ?? null,
    category: category ?? null,
    scheduled_at: scheduled_at ?? null,
    duration_minutes: duration_minutes ?? null,
    tags: Array.isArray(tags) ? tags : [],
    memo_status: memo_status ?? (scheduled_at ? 'time_candidates' : 'unsorted'),
    ai_source_payload: ai_source_payload ?? null,
    status: 'memo',
    color: '#6366f1',
    display_order: (count ?? 0) + 1,
  }

  const { data, error } = await supabase
    .from('ideal_goals')
    .insert(insertPayload)
    .select('*, ideal_items(*)')
    .single()

  let savedItem = data
  if (error) {
    const canRetryWithoutAiPayload =
      error.message.includes('ai_source_payload') ||
      error.message.includes("Could not find the 'ai_source_payload' column")

    if (!canRetryWithoutAiPayload) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const fallbackPayload: Omit<typeof insertPayload, 'ai_source_payload'> = {
      user_id: insertPayload.user_id,
      title: insertPayload.title,
      description: insertPayload.description,
      category: insertPayload.category,
      scheduled_at: insertPayload.scheduled_at,
      duration_minutes: insertPayload.duration_minutes,
      tags: insertPayload.tags,
      memo_status: insertPayload.memo_status,
      status: insertPayload.status,
      color: insertPayload.color,
      display_order: insertPayload.display_order,
    }
    const retry = await supabase
      .from('ideal_goals')
      .insert(fallbackPayload)
      .select('*, ideal_items(*)')
      .single()

    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 })
    savedItem = retry.data
  }

  if (savedItem?.id && Array.isArray(subtask_suggestions) && subtask_suggestions.length > 0) {
    const rows = subtask_suggestions
      .filter((sub: { title?: string }) => sub?.title?.trim())
      .slice(0, 8)
      .map((sub: { title: string; estimated_minutes?: number; reason?: string }, index: number) => ({
        ideal_id: savedItem.id,
        user_id: user.id,
        title: sub.title.trim(),
        item_type: 'task',
        frequency_type: 'once',
        frequency_value: 1,
        session_minutes: sub.estimated_minutes ?? 0,
        daily_minutes: 0,
        description: sub.reason ?? null,
        display_order: index,
      }))
    if (rows.length > 0) {
      await supabase.from('ideal_items').insert(rows)
    }
  }

  const { data: item } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('id', savedItem.id)
    .single()

  return NextResponse.json({ item: item ?? savedItem }, { status: 201 })
}
