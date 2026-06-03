import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
