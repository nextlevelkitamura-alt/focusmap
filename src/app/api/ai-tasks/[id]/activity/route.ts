import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const { data: task } = await supabase
    .from('ai_tasks')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('ai_task_activity_messages')
    .select('id, task_id, user_id, role, kind, body, importance, metadata, created_at')
    .eq('task_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[ai-tasks/activity]', error.message)
    return NextResponse.json({ error: 'Activity query failed' }, { status: 500 })
  }

  return NextResponse.json({ messages: [...(data ?? [])].reverse() })
}
