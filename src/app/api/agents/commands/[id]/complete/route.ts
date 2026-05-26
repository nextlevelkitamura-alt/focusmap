import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
    const ok = body.ok !== false
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })

    const { data: command } = await supabase
      .from('agent_commands')
      .select('id, runner_id, user_id, space_id')
      .eq('id', id)
      .maybeSingle()
    if (!command) return NextResponse.json({ error: 'Command not found' }, { status: 404 })
    if (command.runner_id !== runnerId || command.user_id !== token.user_id) {
      return NextResponse.json({ error: 'Command is outside this agent token scope' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('agent_commands')
      .update({
        status: ok ? 'completed' : 'failed',
        result: body.result && typeof body.result === 'object' ? body.result : null,
        error: typeof body.error === 'string' ? body.error : null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ command: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
