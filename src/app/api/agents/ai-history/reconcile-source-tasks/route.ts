import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import {
  isUsableCodexSourceTaskRecord,
  taskCodexStatusFromAiHistory,
} from '@/lib/codex-status-projection'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { listPlacedAiHistorySourceTaskStatuses, type TursoAiHistoryItem } from '@/lib/turso/ai-history'

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

const VALID_EXECUTORS = ['codex_app', 'codex'] as const
const MAX_RECONCILE_LIMIT = 500

function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function parseLimitValue(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : 200
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : 200, 1), MAX_RECONCILE_LIMIT)
}

function parseProvider(value: unknown) {
  return compactString(value, 80) ?? 'codex_app'
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

function timeMs(value: string | null | undefined) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function historyItemFreshness(item: Pick<TursoAiHistoryItem, 'indexed_at' | 'last_activity_at' | 'updated_at'>) {
  return Math.max(
    timeMs(item.indexed_at),
    timeMs(item.last_activity_at),
    timeMs(item.updated_at),
  )
}

async function assertRunnerCanSync(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  runnerId: string,
) {
  const { data, error } = await supabase
    .from('ai_runners')
    .select('id, user_id, executors')
    .eq('id', runnerId)
    .eq('user_id', token.user_id)
    .maybeSingle()
  if (error) throw error
  if (!data) return { ok: false as const, status: 404, error: 'Runner not found' }
  const executors = Array.isArray(data.executors) ? data.executors.map(value => String(value)) : []
  if (!executors.some(executor => VALID_EXECUTORS.includes(executor as (typeof VALID_EXECUTORS)[number]))) {
    return { ok: false as const, status: 403, error: 'Runner is not allowed to reconcile AI history' }
  }
  return { ok: true as const }
}

async function loadSourceTasks(
  supabase: SupabaseServiceClient,
  userId: string,
  sourceTaskIds: string[],
) {
  const byId = new Map<string, Record<string, unknown>>()
  if (sourceTaskIds.length === 0) return byId
  const { data, error } = await supabase
    .from('tasks')
    .select('id, source, deleted_at, codex_status, codex_thread_id')
    .eq('user_id', userId)
    .in('id', sourceTaskIds)
    .limit(MAX_RECONCILE_LIMIT)
  if (error) throw error
  for (const row of data ?? []) {
    const id = compactString((row as Record<string, unknown>).id, 120)
    if (id) byId.set(id, row as Record<string, unknown>)
  }
  return byId
}

async function handleRequest(request: NextRequest, input: {
  runnerId: string | null
  provider: string
  limit: number
}) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const runnerId = compactString(input.runnerId, 120)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    const runnerCheck = await assertRunnerCanSync(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    if (!isTursoConfigured()) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }

    const indexedAt = new Date().toISOString()
    const items = await listPlacedAiHistorySourceTaskStatuses({
      userId: token.user_id,
      provider: input.provider,
      limit: input.limit,
    })
    const latestItemsBySourceTaskId = new Map<string, (typeof items)[number]>()
    for (const item of items) {
      if (!item.source_task_id) continue
      const current = latestItemsBySourceTaskId.get(item.source_task_id)
      if (!current || historyItemFreshness(item) >= historyItemFreshness(current)) {
        latestItemsBySourceTaskId.set(item.source_task_id, item)
      }
    }
    const latestItems = Array.from(latestItemsBySourceTaskId.values())
    const sourceTaskIds = uniqueStrings(latestItems.map(item => item.source_task_id))
    const sourceTasks = await loadSourceTasks(supabase, token.user_id, sourceTaskIds)

    let synced = 0
    let unchanged = 0
    let skipped = 0
    const syncedSourceTaskIds: string[] = []

    for (const item of latestItems) {
      const sourceTaskId = item.source_task_id
      if (!sourceTaskId) {
        skipped += 1
        continue
      }
      const sourceTask = sourceTasks.get(sourceTaskId)
      if (!sourceTask || !isUsableCodexSourceTaskRecord(sourceTask)) {
        skipped += 1
        continue
      }
      const codexStatus = taskCodexStatusFromAiHistory({
        status: item.status,
        archived: item.archived,
        deleted_at: item.deleted_at,
      })
      if (!codexStatus) {
        skipped += 1
        continue
      }

      const currentStatus = compactString(sourceTask.codex_status, 80)
      const currentThreadId = compactString(sourceTask.codex_thread_id, 200)
      if (currentStatus === codexStatus && currentThreadId === item.external_thread_id) {
        unchanged += 1
        continue
      }

      const { error } = await supabase
        .from('tasks')
        .update({
          codex_status: codexStatus,
          codex_thread_id: item.external_thread_id,
          updated_at: indexedAt,
        })
        .eq('id', sourceTaskId)
        .eq('user_id', token.user_id)
        .is('deleted_at', null)

      if (error) throw error
      synced += 1
      syncedSourceTaskIds.push(sourceTaskId)
    }

    return NextResponse.json({
      ok: true,
      source: 'turso',
      checked: items.length,
      reconciled: latestItems.length,
      sourceTasks: sourceTaskIds.length,
      synced,
      unchanged,
      skipped,
      syncedSourceTaskIds,
      indexedAt,
      policy: {
        provider: input.provider,
        interval: 'agent_10m_plus_startup',
        sourceOfTruth: 'ai_history_items',
        completedMapsTo: 'awaiting_approval',
        legacyCodexInboxSource: 'skipped',
      },
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[agents/ai-history reconcile source tasks]', error)
    const message = error instanceof Error ? error.message : 'AI history source task reconcile failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json({ error: message }, { status: authFailure ? 401 : 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, {
    runnerId: request.nextUrl.searchParams.get('runner_id'),
    provider: parseProvider(request.nextUrl.searchParams.get('provider')),
    limit: parseLimitValue(request.nextUrl.searchParams.get('limit')),
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return handleRequest(request, {
    runnerId: compactString(body.runner_id, 120),
    provider: parseProvider(body.provider),
    limit: parseLimitValue(body.limit),
  })
}
