import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BUCKET = 'ideal-attachments'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: attachment, error: fetchError } = await supabase
    .from('ideal_attachments')
    .select('id, storage_path')
    .eq('id', attachmentId)
    .eq('ideal_id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.storage_path])

  if (storageError) console.error('[wishlist/attachments/delete] Storage error:', storageError)

  const { error: dbError } = await supabase
    .from('ideal_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('user_id', user.id)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
