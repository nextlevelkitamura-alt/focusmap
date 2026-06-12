import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('agent_chat_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[agent/sessions] delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete chat session' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
