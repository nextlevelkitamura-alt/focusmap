import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { upsertMemoTags } from '@/lib/memo-tags-server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  if (body.project_id) {
    const { error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', body.project_id)
      .eq('user_id', user.id)
      .single()

    if (projectError) {
      return NextResponse.json({ error: 'プロジェクトを確認できませんでした' }, { status: 400 })
    }
  }
  const updates = {
    ...body,
    tags: Array.isArray(body.tags) ? body.tags : body.tags,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('ideal_goals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, ideal_items(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await upsertMemoTags(supabase, user.id, data.category, data.tags)
  return NextResponse.json({ item: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('ideal_goals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
