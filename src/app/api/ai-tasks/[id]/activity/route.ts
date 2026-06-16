import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { getTursoTaskForAuth, listTaskEvents, listTaskProgressPage } from '@/lib/turso/codex-monitoring'

const MAX_ACTIVITY_BODY_CHARS = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value || '100', 10)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 100, 1), 200)
}

function parseBefore(req: NextRequest) {
  const createdAt = req.nextUrl.searchParams.get('before_created_at')?.trim()
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null
  const rawId = req.nextUrl.searchParams.get('before_id')?.trim() || ''
  return {
    createdAt: new Date(createdAt).toISOString(),
    id: /^[A-Za-z0-9:_-]+$/.test(rawId) ? rawId : null,
  }
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

const HIDDEN_ACTIVITY_EVENT_TYPES = new Set([
  'thread_detected',
  'running',
  'awaiting_approval',
  'status:running',
  'status:awaiting_approval',
])

function isHiddenActivityEvent(eventType: string) {
  return HIDDEN_ACTIVITY_EVENT_TYPES.has(eventType)
}

function activityRole(value: unknown) {
  return value === 'system' || value === 'codex' || value === 'user' || value === 'status'
    ? value
    : null
}

function activityKind(value: unknown) {
  return value === 'prompt_waiting' ||
    value === 'sent' ||
    value === 'progress' ||
    value === 'question' ||
    value === 'approval' ||
    value === 'resumed' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'user_answer'
    ? value
    : null
}

function activityImportance(value: unknown) {
  return value === 'important' ? 'important' : 'normal'
}

function progressMessageFromTurso(item: Awaited<ReturnType<typeof listTaskProgressPage>>[number]) {
  const progressJson = isRecord(item.progress_json) ? item.progress_json : {}
  const mirroredActivity = progressJson.source === 'activity_message'
  const metadata = isRecord(progressJson.metadata) ? progressJson.metadata : progressJson
  const role = mirroredActivity ? activityRole(progressJson.role) ?? 'codex' : 'codex'
  const kind = mirroredActivity ? activityKind(progressJson.kind) ?? 'progress' : 'progress'
  return {
    id: item.id,
    task_id: item.task_id,
    user_id: item.user_id,
    role,
    kind,
    body: item.message || item.phase || '進捗更新',
    importance: mirroredActivity ? activityImportance(progressJson.importance) : 'normal',
    metadata,
    created_at: item.created_at,
  }
}

function fallbackMessagesFromTask(task: {
  id: string
  user_id: string
  prompt?: string | null
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
  const visibleMessages = fallbackVisibleMessagesFromResult(task, result, createdAt)

  const sentPrompt = stringValue(task.prompt)
  const messages = sentPrompt
    ? [{
        id: `prompt:${task.id}`,
        task_id: task.id,
        user_id: task.user_id,
        role: 'user',
        kind: 'sent',
        body: sentPrompt,
        importance: 'normal',
        metadata: { source: 'ai_tasks.prompt' },
        created_at: task.created_at || createdAt,
      }]
    : []

  if (visibleMessages.length > 0) return [...messages, ...visibleMessages]
  if (!body) return messages
  const kind = stringValue(result.codex_run_state) === 'prompt_waiting'
    ? 'prompt_waiting'
    : stringValue(result.codex_run_state) === 'awaiting_approval'
      ? 'approval'
      : 'progress'

  return [...messages, {
    id: `fallback:${task.id}:${kind}`,
    task_id: task.id,
    user_id: task.user_id,
    role: kind === 'prompt_waiting' ? 'status' : 'codex',
    kind,
    body: body.slice(-MAX_ACTIVITY_BODY_CHARS),
    importance: kind === 'progress' ? 'normal' : 'important',
    metadata: { source: 'ai_tasks.result' },
    created_at: createdAt,
  }]
}

function fallbackVisibleMessagesFromResult(
  task: {
    id: string
    user_id: string
    started_at?: string | null
    created_at?: string | null
  },
  result: Record<string, unknown>,
  fallbackCreatedAt?: string | null,
) {
  const rawMessages = Array.isArray(result.codex_visible_messages)
    ? result.codex_visible_messages
    : []
  return rawMessages.flatMap((value, index) => {
    if (!isRecord(value)) return []
    const body = stringValue(value.body)
    if (!body) return []
    const role = activityRole(value.role) ?? 'codex'
    const kind = activityKind(value.kind) ?? (role === 'user' ? 'user_answer' : 'progress')
    const createdAt = stringValue(value.created_at) ||
      fallbackCreatedAt ||
      task.started_at ||
      task.created_at ||
      new Date().toISOString()

    return [{
      id: `result-visible:${task.id}:${index}`,
      task_id: task.id,
      user_id: task.user_id,
      role,
      kind,
      body,
      importance: activityImportance(value.importance),
      metadata: { source: 'ai_tasks.result.codex_visible_messages' },
      created_at: createdAt,
    }]
  })
}

function taskPromptMessage(task: {
  id: string
  user_id: string
  title?: string | null
  prompt?: string | null
  created_at?: string | null
}) {
  const body = stringValue(task.prompt) || stringValue(task.title)
  if (!body) return null
  return {
    id: `prompt:${task.id}`,
    task_id: task.id,
    user_id: task.user_id,
    role: 'user',
    kind: 'sent',
    body,
    importance: 'normal',
    metadata: { source: task.prompt ? 'ai_tasks.prompt' : 'turso.ai_tasks.title' },
    created_at: task.created_at || new Date().toISOString(),
  }
}

function hasUserSentMessage(messages: Array<{ role?: unknown; kind?: unknown; body?: unknown }>) {
  return messages.some(message =>
    (message.role === 'user' || message.kind === 'user_answer' || message.kind === 'sent') &&
    !!stringValue(message.body)
  )
}

function isHiddenActivityMessage(message: { role?: unknown; kind?: unknown; body?: unknown }) {
  const body = stringValue(message.body)
  if (!body) return true
  if (message.role === 'status' && /^Codex threadを検出しました/u.test(body)) return true
  if (/^状態:\s*(running|awaiting_approval)$/u.test(body)) return true
  if (/^(thread_detected|running|awaiting_approval)$/u.test(body)) return true
  if (/^(Codex実行を開始しました|Codexが実行を開始しました|Codex thread が見つからないため監視を停止しました|Codex thread が一時的に見つからないため、監視を継続します|Codex thread の監視を停止しました)/u.test(body)) return true
  return false
}

function visibleActivityMessages<T extends { role?: unknown; kind?: unknown; body?: unknown }>(messages: T[]) {
  return messages.filter(message => !isHiddenActivityMessage(message))
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
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'))
  const before = parseBefore(req)

  if (isTursoConfigured()) {
    try {
      const task = await getTursoTaskForAuth(id, {
        userId: user.id,
        supabase,
      })
      if (task) {
        const [progress, events] = await Promise.all([
          listTaskProgressPage(task.id, task.user_id, { limit, before }),
          before ? Promise.resolve([]) : listTaskEvents(task.id, task.user_id, 50),
        ])
        const progressMessages = progress.map(progressMessageFromTurso)
        const eventMessages = events
          .filter(item => !isHiddenActivityEvent(item.event_type))
          .map(item => ({
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
          }))
        const promptMessage = before ? null : taskPromptMessage(task)
        const messages = visibleActivityMessages([
          ...(promptMessage && !hasUserSentMessage([...progressMessages, ...eventMessages]) ? [promptMessage] : []),
          ...progressMessages,
          ...eventMessages,
        ]).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const oldestProgress = progress.at(-1)
        const nextCursor = progress.length >= limit && oldestProgress
          ? { created_at: oldestProgress.created_at, id: oldestProgress.id }
          : null

        if (before || messages.some(message => !String(message.id).startsWith('prompt:'))) {
          return NextResponse.json({
            source: 'turso',
            messages,
            has_more: Boolean(nextCursor),
            next_cursor: nextCursor,
          })
        }
      }
    } catch (tursoError) {
      console.error('[ai-tasks/activity turso]', tursoError)
    }
  }

  const { data: task } = await supabase
    .from('ai_tasks')
    .select('id, user_id, prompt, result, created_at, started_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let activityQuery = supabase
    .from('ai_task_activity_messages')
    .select('id, task_id, user_id, role, kind, body, importance, metadata, created_at')
    .eq('task_id', id)
    .eq('user_id', user.id)

  if (before?.id) {
    activityQuery = activityQuery.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`)
  } else if (before) {
    activityQuery = activityQuery.lt('created_at', before.createdAt)
  }

  const { data, error } = await activityQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (error) {
    if (isMissingOptionalActivityTable(error)) {
      return NextResponse.json({
        source: 'ai_tasks.result',
        messages: before ? [] : fallbackMessagesFromTask(task),
        has_more: false,
        next_cursor: null,
      })
    }
    console.error('[ai-tasks/activity]', error.message)
    return NextResponse.json({ error: 'Activity query failed' }, { status: 500 })
  }

  const promptMessage = before ? null : taskPromptMessage(task)
  const activityMessages = [...(data ?? [])].reverse()
  const resultFallbackMessages = fallbackMessagesFromTask(task)
    .filter(message => !String(message.id).startsWith('prompt:'))
  const messages = visibleActivityMessages([
    ...(promptMessage && !hasUserSentMessage(activityMessages) ? [promptMessage] : []),
    ...activityMessages,
    ...(!before && activityMessages.length === 0 ? resultFallbackMessages : []),
  ])
  const oldestActivity = data?.at(-1) as { id?: string; created_at?: string } | undefined
  const nextCursor = (data?.length ?? 0) >= limit && oldestActivity?.created_at
    ? { created_at: oldestActivity.created_at, id: oldestActivity.id ?? null }
    : null
  return NextResponse.json({
    messages,
    has_more: Boolean(nextCursor),
    next_cursor: nextCursor,
  })
}
