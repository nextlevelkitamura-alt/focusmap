import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getPlanForTransition } from '@/lib/turso/plan-links'

const TARGETS: Record<string, Set<string>> = {
  planning: new Set(['active', 'archive']),
  active: new Set(['paused', 'done', 'archive']),
  paused: new Set(['active', 'archive']),
  done: new Set(['archive']),
  archive: new Set(),
}

function runnerCanExecute(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const value = metadata as Record<string, unknown>
  return value.app === 'focusmap-lite' || value.agent === 'focusmap-agent'
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const planSlug = typeof body.planSlug === 'string' ? body.planSlug.trim() : ''
  const expectedBucket = typeof body.expectedBucket === 'string' ? body.expectedBucket.trim() : ''
  const targetBucket = typeof body.targetBucket === 'string' ? body.targetBucket.trim() : ''
  if (!planSlug || !TARGETS[expectedBucket]?.has(targetBucket)) {
    return NextResponse.json({ success: false, error: 'INVALID_TRANSITION' }, { status: 400 })
  }

  const plan = await getPlanForTransition(planSlug)
  if (!plan) return NextResponse.json({ success: false, error: 'PLAN_NOT_FOUND' }, { status: 404 })
  if (plan.bucket !== expectedBucket) {
    return NextResponse.json({ success: false, error: 'BUCKET_CONFLICT', currentBucket: plan.bucket }, { status: 409 })
  }

  const onlineSince = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data: runners, error: runnerError } = await supabase
    .from('ai_runners')
    .select('id, metadata, last_heartbeat_at')
    .eq('user_id', user.id)
    .gte('last_heartbeat_at', onlineSince)
    .order('last_heartbeat_at', { ascending: false })
    .limit(10)
  if (runnerError) return NextResponse.json({ success: false, error: runnerError.message }, { status: 500 })
  const runner = (runners ?? []).find(row => runnerCanExecute(row.metadata))
  if (!runner) return NextResponse.json({ success: false, error: 'RUNNER_OFFLINE' }, { status: 409 })

  const service = createServiceClient()
  const { data: command, error } = await service
    .from('agent_commands')
    .insert({
      runner_id: runner.id,
      user_id: user.id,
      space_id: null,
      task_id: null,
      type: 'plan_transition',
      payload: {
        plan_path: plan.path,
        expected_bucket: expectedBucket,
        target_bucket: targetBucket,
      },
      status: 'pending',
    })
    .select('id, status, type, payload, created_at')
    .single()
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, command, plan }, { status: 202 })
}
