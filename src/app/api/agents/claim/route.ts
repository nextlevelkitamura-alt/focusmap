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

    const ttl = Number.isFinite(Number(body.claim_ttl_seconds))
      ? Math.max(30, Math.min(1800, Number(body.claim_ttl_seconds)))
      : 300

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('claim_ai_task_for_runner', {
      p_runner_id: runnerId,
      p_claim_ttl_seconds: ttl,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const task = Array.isArray(data) ? data[0] ?? null : data ?? null
    return NextResponse.json({ task })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
