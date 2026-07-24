import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { canEditSpace } from '@/lib/space-access'

const VALID_TYPES = new Set([
  'open_url',
  'open_google_auth',
  'open_gws_auth',
  'open_browser_auth',
  'run_shell',
  'plan_transition',
  'restart_agent',
  'pause_agent',
  'resume_agent',
  'upload_logs',
  'scan_capabilities',
  'file_read',
  'file_write',
  'file_list',
  'file_delete',
  'browser_navigate',
  'browser_click',
  'browser_fill',
  'browser_screenshot',
  'browser_text',
  'browser_close_session',
  'cancel_command',
])

function canExecuteRemoteCommands(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const meta = metadata as Record<string, unknown>
  return meta.app === 'focusmap-lite' || meta.agent === 'focusmap-agent'
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const runnerId = searchParams.get('runner_id')
  let query = supabase
    .from('agent_commands')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (runnerId) query = query.eq('runner_id', runnerId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ commands: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
  const type = typeof body.type === 'string' ? body.type : ''
  if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
  if (!VALID_TYPES.has(type)) return NextResponse.json({ error: 'invalid command type' }, { status: 400 })

  const { data: runner } = await supabase
    .from('ai_runners')
    .select('id, user_id, metadata')
    .eq('id', runnerId)
    .maybeSingle()
  if (!runner) return NextResponse.json({ error: 'Runner not found' }, { status: 404 })
  if (!canExecuteRemoteCommands(runner.metadata)) {
    return NextResponse.json({ error: 'Runner cannot execute agent commands' }, { status: 400 })
  }
  if (runner.user_id !== user.id) {
    const { data: spaces } = await supabase
      .from('ai_runner_spaces')
      .select('space_id')
      .eq('runner_id', runnerId)
      .eq('enabled', true)
    const editable = await Promise.all((spaces ?? []).map(row => canEditSpace(supabase, user.id, row.space_id)))
    if (!editable.some(Boolean)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const spaceId = typeof body.space_id === 'string' ? body.space_id : null
  if (spaceId && !(await canEditSpace(supabase, user.id, spaceId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('agent_commands')
    .insert({
      runner_id: runnerId,
      user_id: user.id,
      space_id: spaceId,
      task_id: typeof body.task_id === 'string' ? body.task_id : null,
      type,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ command: data }, { status: 201 })
}
