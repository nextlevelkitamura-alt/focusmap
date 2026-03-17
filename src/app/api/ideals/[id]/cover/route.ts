import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'ideal-attachments'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/ideals/[id]/cover
 * カバー画像をアップロード（既存は上書き削除）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 所有権確認 & 既存カバー画像パス取得
  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('id, cover_image_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: '画像ファイルのみアップロードできます' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'ファイルサイズは10MB以内にしてください' }, { status: 400 })
  }

  // 既存カバー画像を削除
  if (goal.cover_image_path) {
    await supabase.storage.from(BUCKET).remove([goal.cover_image_path])
  }

  // アップロード
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${id}/cover_${timestamp}_${safeName}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // 署名付きURL（1年間有効）
  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

  if (signedError || !signedData) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
  }

  // DB 更新
  const { data, error } = await supabase
    .from('ideal_goals')
    .update({
      cover_image_url: signedData.signedUrl,
      cover_image_path: storagePath,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, cover_image_url, cover_image_path')
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideal: data }, { status: 201 })
}

/**
 * DELETE /api/ideals/[id]/cover
 * カバー画像を削除
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

  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('cover_image_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (goal.cover_image_path) {
    await supabase.storage.from(BUCKET).remove([goal.cover_image_path])
  }

  await supabase
    .from('ideal_goals')
    .update({ cover_image_url: null, cover_image_path: null })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}
