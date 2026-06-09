import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

const BUCKET = 'ideal-attachments'

function createAdminClientOrNull() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    return createServiceClient()
  } catch (error) {
    console.error('[wishlist/attachments/delete] Service client unavailable:', error)
    return null
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal } = await supabase
    .from('ideal_goals')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!goal) return NextResponse.json({ error: 'Memo not found' }, { status: 404 })

  const attachmentClient = createAdminClientOrNull() ?? supabase
  const { data: attachment, error: fetchError } = await attachmentClient
    .from('ideal_attachments')
    .select('id, storage_path')
    .eq('id', attachmentId)
    .eq('ideal_id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const { error: storageError } = await attachmentClient.storage
    .from(BUCKET)
    .remove([attachment.storage_path])

  if (storageError) console.error('[wishlist/attachments/delete] Storage error:', storageError)

  const { error: dbError } = await attachmentClient
    .from('ideal_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('user_id', user.id)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
