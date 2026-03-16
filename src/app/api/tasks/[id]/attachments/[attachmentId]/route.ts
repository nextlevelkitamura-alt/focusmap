import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'task-attachments'

/**
 * DELETE /api/tasks/[id]/attachments/[attachmentId]
 * 添付ファイルを削除（Storage + DB）
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: taskId, attachmentId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 添付ファイルの所有権確認と storage_path 取得
  const { data: attachment, error: fetchError } = await supabase
    .from('task_attachments')
    .select('id, storage_path')
    .eq('id', attachmentId)
    .eq('task_id', taskId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  // Storage から削除
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.storage_path])

  if (storageError) {
    console.error('[attachments/delete] Storage error:', storageError)
    // Storage削除失敗でもDBは削除する（孤立レコード防止）
  }

  // DB から削除
  const { error: dbError } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('user_id', user.id)

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
