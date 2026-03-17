import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'ideal-attachments'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/ideals/[id]/items/[itemId]/images
 * アイテムに画像をアップロード
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id: idealId, itemId } = await params
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
    .eq('ideal_id', idealId)
    .eq('user_id', user.id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const caption = formData.get('caption') as string | null

  if (!file) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: '画像ファイルのみアップロードできます' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'ファイルサイズは10MB以内にしてください' }, { status: 400 })
  }

  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${idealId}/items/${itemId}/${timestamp}_${safeName}`

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

  // 最大 display_order 取得
  const { data: lastImg } = await supabase
    .from('ideal_item_images')
    .select('display_order')
    .eq('item_id', itemId)
    .order('display_order', { ascending: false })
    .limit(1)
    .single()

  const { data: image, error: insertError } = await supabase
    .from('ideal_item_images')
    .insert({
      item_id: itemId,
      user_id: user.id,
      image_url: signedData.signedUrl,
      storage_path: storagePath,
      caption: caption || null,
      display_order: (lastImg?.display_order ?? -1) + 1,
    })
    .select()
    .single()

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // 最初の画像をサムネイルとして設定
  const { count } = await supabase
    .from('ideal_item_images')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', itemId)

  if (count === 1) {
    await supabase
      .from('ideal_items')
      .update({ thumbnail_url: signedData.signedUrl, thumbnail_path: storagePath })
      .eq('id', itemId)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ image }, { status: 201 })
}
