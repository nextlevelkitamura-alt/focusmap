import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { getTursoTaskForAuth, listTaskEvents, listTaskProgress } from '@/lib/turso/codex-monitoring'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isMissingOptionalActivityTable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  return record.code === 'PGRST205' ||
    (typeof record.message === 'string' && record.message.includes('ai_task_activity_messages'))
}

function kindFromEventType(eventType: string) {
  if (eventType === 'status:completed') return 'completed'
  if (eventType === 'status:failed') return 'failed'
  if (eventType === 'status:awaiting_approval') return 'approval'
  if (eventType === 'status:needs_input') return 'question'
  if (eventType === 'sent') return 'sent'
  if (eventType === 'resumed') return 'resumed'
  return 'progress'
}

function fallbackMessagesFromTask(task: {
  id: string
  user_id: string
  result?: unknown
  created_at?: string | null
  started_at?: string | null
}) {
  const result = isRecord(task.result) ? task.result : {}
  const createdAt = stringValue(result.last_activity_at) || task.started_at || task.created_at || new Date().toISOString()
  const body =
    stringValue(result.live_log) ||
    stringValue(result.message) ||
    stringValue(result.current_step)

  if (!body) return []
  const kind = stringValue(result.codex_run_state) === 'prompt_waiting'
    ? 'prompt_waiting'
    : stringValue(result.codex_run_state) === 'awaiting_approval'
      ? 'approval'
      : 'progress'

  return [{
    id: `fallback:${task.id}:${kind}`,
    task_id: task.id,
    user_id: task.user_id,
    role: kind === 'prompt_waiting' ? 'status' : 'codex',
    kind,
    body: body.slice(-2_000),
    importance: kind === 'progress' ? 'normal' : 'important',
    metadata: { source: 'ai_tasks.result' },
    created_at: createdAt,
  }]
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  if (isTursoConfigured()) {
    try {
      const task = await getTursoTaskForAuth(id, {
        userId: user.id,
        supabase,
      })
      if (task) {
        const [progress, events] = await Promise.all([
          listTaskProgress(task.id, task.user_id, 50),
          listTaskEvents(task.id, task.user_id, 50),
        ])
        const messages = [
          ...progress.map(item => ({
            id: item.id,
            task_id: item.task_id,
            user_id: item.user_id,
            role: 'codex',
            kind: 'progress',
            body: item.message || item.phase || '進捗更新',
            importance: 'normal',
            metadata: item.progress_json ?? {},
            created_at: item.created_at,
          })),
          ...events.map(item => ({
            id: item.id,
            task_id: item.task_id,
            user_id: item.user_id,
            role: 'status',
            kind: kindFromEventType(item.event_type),
            body: item.event_type.startsWith('status:')
              ? `状態: ${item.event_type.slice('status:'.length)}`
              : item.event_type,
            importance: item.event_type.includes('failed') || item.event_type.includes('approval') ? 'important' : 'normal',
            metadata: item.payload_json ?? {},
            created_at: item.created_at,
          })),
        ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).slice(-50)

        if (messages.length > 0) return NextResponse.json({ source: 'turso', messages })
      }
    } catch (tursoError) {
      console.error('[ai-tasks/activity turso]', tursoError)
    }
  }

  const { data: task } = await supabase
    .from('ai_tasks')
    .select('id, user_id, result, created_at, started_at')
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
    if (isMissingOptionalActivityTable(error)) {
      return NextResponse.json({
        source: 'ai_tasks.result',
        messages: fallbackMessagesFromTask(task),
      })
    }
    console.error('[ai-tasks/activity]', error.message)
    return NextResponse.json({ error: 'Activity query failed' }, { status: 500 })
  }

  return NextResponse.json({ messages: [...(data ?? [])].reverse() })
}
