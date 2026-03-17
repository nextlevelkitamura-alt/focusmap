import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * PATCH /api/ideals/[id]/items/[itemId]/candidates/[candId]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; candId: string }> }
) {
  const { candId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const allowedFields = ['title', 'url', 'price', 'pros', 'cons', 'rating', 'status', 'display_order']
  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '更新するフィールドがありません' }, { status: 400 })
  }

  const { data: candidate, error } = await supabase
    .from('ideal_candidates')
    .update(updates)
    .eq('id', candId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ candidate })
}

/**
 * DELETE /api/ideals/[id]/items/[itemId]/candidates/[candId]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; candId: string }> }
) {
  const { candId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 画像があればStorage削除
  const { data: candidate } = await supabase
    .from('ideal_candidates')
    .select('image_path')
    .eq('id', candId)
    .eq('user_id', user.id)
    .single()

  if (candidate?.image_path) {
    await supabase.storage.from('ideal-attachments').remove([candidate.image_path])
  }

  const { error } = await supabase
    .from('ideal_candidates')
    .delete()
    .eq('id', candId)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
