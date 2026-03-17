import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/ideals/[id]
 * 理想の詳細を ideal_items と共に取得
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
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ideal: data })
}

/**
 * PATCH /api/ideals/[id]
 * 理想を更新
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const allowedFields = [
    'title', 'description', 'category', 'color', 'status',
    'display_order', 'duration_months', 'start_date', 'target_date',
    'cost_total', 'cost_monthly', 'total_daily_minutes', 'ai_summary',
  ]
  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '更新するフィールドがありません' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ideal_goals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, ideal_items(*)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideal: data })
}

/**
 * DELETE /api/ideals/[id]
 * 理想を削除（Storage ファイルも削除）
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // カバー画像と添付ファイルのパスを取得
  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('cover_image_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 添付ファイルの storage_path を取得
  const { data: attachments } = await supabase
    .from('ideal_attachments')
    .select('storage_path')
    .eq('ideal_id', id)
    .eq('user_id', user.id)

  // Storage からカバー画像を削除
  if (goal.cover_image_path) {
    await supabase.storage.from('ideal-attachments').remove([goal.cover_image_path])
  }

  // Storage から添付ファイルを削除
  if (attachments && attachments.length > 0) {
    const paths = attachments.map(a => a.storage_path)
    await supabase.storage.from('ideal-attachments').remove(paths)
  }

  // DB から削除（CASCADE で ideal_items / ideal_attachments も削除される）
  const { error } = await supabase
    .from('ideal_goals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
