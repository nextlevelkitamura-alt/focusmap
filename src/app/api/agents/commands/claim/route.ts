import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({}))
    const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })

    const { data: runner } = await supabase
      .from('ai_runners')
      .select('id')
      .eq('id', runnerId)
      .eq('user_id', token.user_id)
      .maybeSingle()
    if (!runner) return NextResponse.json({ error: 'Runner not found' }, { status: 404 })

    const { data: commands, error: selectError } = await supabase
      .from('agent_commands')
      .select('*')
      .eq('runner_id', runnerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
    if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 })

    const command = commands?.[0] ?? null
    if (!command) return NextResponse.json({ command: null })

    const { data, error } = await supabase
      .from('agent_commands')
      .update({ status: 'running', claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', command.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ command: data ?? null })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
