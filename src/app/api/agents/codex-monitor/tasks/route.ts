import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'

const VALID_STATUSES = ['pending', 'running', 'awaiting_approval', 'needs_input'] as const
const VALID_EXECUTORS = ['codex', 'codex_app'] as const
const MANUAL_HANDOFF_DISCOVERY_WINDOW_MS = 10 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonThreadId(result: unknown) {
  const record = isRecord(result) ? result : {}
  return stringValue(record.codex_thread_id)
}

function parseTimeMs(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function isRecentManualHandoffDiscoveryCandidate(row: Record<string, unknown>, nowMs = Date.now()) {
  if (stringValue(row.codex_thread_id) || jsonThreadId(row.result)) return false
  if (stringValue(row.executor) !== 'codex_app') return false
  const result = isRecord(row.result) ? row.result : {}
  if (result.codex_manual_handoff !== true) return false
  if (stringValue(result.codex_run_state) !== 'prompt_waiting') return false
  if (!stringValue(row.prompt)) return false

  const startedMs = parseTimeMs(row.started_at)
  const createdMs = parseTimeMs(row.created_at)
  const candidateMs = Math.max(startedMs, createdMs)
  return candidateMs > 0 && nowMs - candidateMs <= MANUAL_HANDOFF_DISCOVERY_WINDOW_MS
}

export function shouldReturnCodexMonitorTask(row: Record<string, unknown>) {
  return Boolean(stringValue(row.codex_thread_id) || jsonThreadId(row.result)) ||
    isRecentManualHandoffDiscoveryCandidate(row)
}

function parseLimit(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.floor(parsed))) : 80
}

function collectStringIds(rows: unknown[], key: string) {
  return [...new Set(rows
    .map(row => stringValue(isRecord(row) ? row[key] : null))
    .filter((value): value is string => Boolean(value)))]
}

async function activeTaskIds(
  supabase: Awaited<ReturnType<typeof authenticateAgent>>['supabase'],
  ids: string[],
) {
  if (ids.length === 0) return new Set<string>()
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .in('id', ids)
    .is('deleted_at', null)
  if (error) throw error
  return new Set((data ?? []).map(row => String(row.id)))
}

async function activeNoteIds(
  supabase: Awaited<ReturnType<typeof authenticateAgent>>['supabase'],
  ids: string[],
) {
  if (ids.length === 0) return new Set<string>()
  const { data, error } = await supabase
    .from('notes')
    .select('id')
    .in('id', ids)
    .is('deleted_at', null)
  if (error) throw error
  return new Set((data ?? []).map(row => String(row.id)))
}

async function activeIdealGoalIds(
  supabase: Awaited<ReturnType<typeof authenticateAgent>>['supabase'],
  ids: string[],
) {
  if (ids.length === 0) return new Set<string>()
  const { data, error } = await supabase
    .from('ideal_goals')
    .select('id')
    .in('id', ids)
    .neq('status', 'archived')
  if (error) throw error
  return new Set((data ?? []).map(row => String(row.id)))
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({}))
    const runnerId = stringValue(isRecord(body) ? body.runner_id : null)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })

    const { data: runner, error: runnerError } = await supabase
      .from('ai_runners')
      .select('id, user_id, executors')
      .eq('id', runnerId)
      .eq('user_id', token.user_id)
      .maybeSingle()

    if (runnerError) return NextResponse.json({ error: runnerError.message }, { status: 500 })
    if (!runner) return NextResponse.json({ error: 'Runner not found' }, { status: 404 })

    const executors = Array.isArray(runner.executors)
      ? runner.executors.map(value => String(value))
      : []
    if (!executors.some(executor => VALID_EXECUTORS.includes(executor as (typeof VALID_EXECUTORS)[number]))) {
      return NextResponse.json({ tasks: [] })
    }

    const limit = parseLimit(isRecord(body) ? body.limit : null)
    let query = supabase
      .from('ai_tasks')
      .select('id, user_id, space_id, prompt, skill_id, approval_type, status, executor, cwd, source_task_id, source_note_id, source_ideal_goal_id, codex_thread_id, codex_resume_thread_id, result, created_at, started_at, completed_at')
      .in('executor', VALID_EXECUTORS)
      .in('status', VALID_STATUSES)
      .order('created_at', { ascending: false })
      .limit(limit * 2)

    if (token.space_id) {
      query = query.or(`user_id.eq.${token.user_id},space_id.eq.${token.space_id}`)
    } else {
      query = query.eq('user_id', token.user_id)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data ?? []).filter(row => {
      const record = row as Record<string, unknown>
      return shouldReturnCodexMonitorTask(record)
    })

    const sourceTaskIds = collectStringIds(rows, 'source_task_id')
    const sourceNoteIds = collectStringIds(rows, 'source_note_id')
    const sourceIdealGoalIds = collectStringIds(rows, 'source_ideal_goal_id')

    const [activeTasks, activeNotes, activeIdealGoals] = await Promise.all([
      activeTaskIds(supabase, sourceTaskIds),
      activeNoteIds(supabase, sourceNoteIds),
      activeIdealGoalIds(supabase, sourceIdealGoalIds),
    ])

    const tasks = rows
      .filter(row => {
        const record = row as Record<string, unknown>
        const sourceTaskId = stringValue(record.source_task_id)
        const sourceNoteId = stringValue(record.source_note_id)
        const sourceIdealGoalId = stringValue(record.source_ideal_goal_id)
        if (sourceTaskId && !activeTasks.has(sourceTaskId)) return false
        if (sourceNoteId && !activeNotes.has(sourceNoteId)) return false
        if (sourceIdealGoalId && !activeIdealGoals.has(sourceIdealGoalId)) return false
        return true
      })
      .slice(0, limit)

    return NextResponse.json({ tasks })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
