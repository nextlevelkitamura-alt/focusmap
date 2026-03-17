import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'ideal-attachments'

/**
 * DELETE /api/ideals/[id]/items/[itemId]/images/[imgId]
 * アイテム画像を削除
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; imgId: string }> }
) {
  const { itemId, imgId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: image } = await supabase
    .from('ideal_item_images')
    .select('id, storage_path, image_url')
    .eq('id', imgId)
    .eq('item_id', itemId)
    .eq('user_id', user.id)
    .single()

  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  // Storage から削除
  if (image.storage_path) {
    await supabase.storage.from(BUCKET).remove([image.storage_path])
  }

  // DB から削除
  await supabase
    .from('ideal_item_images')
    .delete()
    .eq('id', imgId)
    .eq('user_id', user.id)

  // サムネイルが削除された画像だった場合、次の画像に更新
  const { data: currentItem } = await supabase
    .from('ideal_items')
    .select('thumbnail_path')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .single()

  if (currentItem?.thumbnail_path === image.storage_path) {
    const { data: nextImg } = await supabase
      .from('ideal_item_images')
      .select('image_url, storage_path')
      .eq('item_id', itemId)
      .order('display_order', { ascending: true })
      .limit(1)
      .single()

    await supabase
      .from('ideal_items')
      .update({
        thumbnail_url: nextImg?.image_url ?? null,
        thumbnail_path: nextImg?.storage_path ?? null,
      })
      .eq('id', itemId)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ success: true })
}
