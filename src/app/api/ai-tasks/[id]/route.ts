import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// GET /api/ai-tasks/:id — 単一AIタスク取得
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ai_tasks')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error) {
    console.error('[ai-tasks/id]', error.message)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

// PATCH /api/ai-tasks/:id — AIタスク更新（承認・却下・修正指示）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { status, result, error: taskError, prompt, scheduled_at, recurrence_cron, cwd, approval_type } = body

  const updates: Record<string, unknown> = {}

  if (status) {
    const validStatuses = ['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = status
    if (status === 'completed') updates.completed_at = new Date().toISOString()
    if (status === 'running') updates.started_at = new Date().toISOString()
  }

  if (result !== undefined) updates.result = result
  if (taskError !== undefined) updates.error = taskError
  if (prompt !== undefined) updates.prompt = prompt
  if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at
  if (recurrence_cron !== undefined) updates.recurrence_cron = recurrence_cron
  if (cwd !== undefined) updates.cwd = cwd
  if (approval_type !== undefined) updates.approval_type = approval_type

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data, error: dbError } = await supabase
    .from('ai_tasks')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (dbError) {
    console.error('[ai-tasks/id]', dbError.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/ai-tasks/:id — AIタスク削除（スケジュール削除）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('ai_tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[ai-tasks/id DELETE]', error.message)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
  return new NextResponse(null, { status: 204 })
}
