import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'

const VALID_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
    const status = typeof body.status === 'string' ? body.status : ''
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })

    const { data: task } = await supabase
      .from('ai_tasks')
      .select('id, user_id, space_id, claimed_runner_id')
      .eq('id', id)
      .maybeSingle()
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.user_id !== token.user_id && task.space_id !== token.space_id) {
      return NextResponse.json({ error: 'Task is outside this agent token scope' }, { status: 403 })
    }
    if (task.claimed_runner_id && task.claimed_runner_id !== runnerId) {
      return NextResponse.json({ error: 'Task is claimed by another runner' }, { status: 409 })
    }

    const updates: Record<string, unknown> = {
      status,
    }
    if (body.result && typeof body.result === 'object') updates.result = body.result
    if (typeof body.error === 'string') updates.error = body.error
    if (status === 'running') updates.started_at = new Date().toISOString()
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date().toISOString()
      updates.claim_expires_at = null
    }

    const { data, error } = await supabase
      .from('ai_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ task: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
