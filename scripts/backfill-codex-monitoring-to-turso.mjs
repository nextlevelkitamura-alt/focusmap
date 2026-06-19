#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createClient as createTursoClient } from '@libsql/client'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { loadMonitoringEnv, missingMonitoringEnv } from './load-monitoring-env.mjs'

const TASK_SELECT = [
  'id',
  'user_id',
  'space_id',
  'prompt',
  'status',
  'error',
  'created_at',
  'started_at',
  'completed_at',
  'executor',
  'codex_thread_id',
  'source_task_id',
  'source_note_id',
  'source_ideal_goal_id',
  'result_codex_run_state:result->>codex_run_state',
  'result_codex_manual_handoff:result->codex_manual_handoff',
  'result_current_step:result->>current_step',
  'result_message:result->>message',
  'result_live_log:result->>live_log',
  'result_progress_summary:result->progress_summary',
  'result_last_activity_at:result->>last_activity_at',
  'result_awaiting_approval_at:result->>awaiting_approval_at',
].join(', ')

const ACTIVITY_SELECT = 'id, task_id, user_id, role, kind, body, importance, metadata, created_at'
const OBSERVATION_SELECT = [
  'id',
  'task_id',
  'user_id',
  'observed_at',
  'source',
  'state',
  'progress_percent',
  'confidence',
  'session_health',
  'summary',
  'comment',
  'evidence',
  'created_at',
].join(', ')

function usage() {
  console.log(`Usage:
  npm run codex-monitoring:backfill -- --days 30 --dry-run
  npm run codex-monitoring:backfill -- --days 30 --apply

Options:
  --days <n>                 Backfill tasks created within the last n days. Default: 30
  --dry-run                  Print target counts and estimated Turso writes only
  --apply                    Write to Turso. Mutually exclusive with --dry-run
  --page-size <n>            Supabase page size. Default: 200, max: 1000
  --max-tasks <n>            Optional safety cap for ai_tasks
  --activity-limit <n>       Recent ai_task_activity_messages per task. Default: 25, max: 50
  --observation-limit <n>    Recent ai_task_observations per task. Default: 10, max: 50
`)
}

function parseArgs(argv) {
  const options = {
    days: 30,
    dryRun: false,
    apply: false,
    pageSize: 200,
    maxTasks: null,
    activityLimit: 25,
    observationLimit: 10,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--apply') {
      options.apply = true
      continue
    }
    const readNumber = (name) => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a numeric value`)
      i += 1
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
      return parsed
    }
    if (arg === '--days') options.days = readNumber(arg)
    else if (arg === '--page-size') options.pageSize = Math.min(readNumber(arg), 1000)
    else if (arg === '--max-tasks') options.maxTasks = readNumber(arg)
    else if (arg === '--activity-limit') options.activityLimit = Math.min(readNumber(arg), 50)
    else if (arg === '--observation-limit') options.observationLimit = Math.min(readNumber(arg), 50)
    else throw new Error(`Unknown option: ${arg}`)
  }

  if (options.dryRun === options.apply) {
    throw new Error('Pass exactly one of --dry-run or --apply. Real writes require --apply.')
  }
  return options
}

function requiredEnvValue(env, keys) {
  for (const key of keys) {
    if (env[key]) return env[key]
  }
  return null
}

function compactString(value, max) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null
}

function tailString(value, max) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(-max)
    : null
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function jsonOrNull(value, maxChars = 8000) {
  if (value === undefined || value === null) return null
  const serialized = JSON.stringify(value)
  return serialized.length > maxChars
    ? JSON.stringify({ truncated: true, sha256: sha256(serialized), chars: serialized.length })
    : serialized
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function boundedPercent(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function sourceTypeAndId(row) {
  if (row.source_task_id) return { source_type: 'mindmap', source_id: row.source_task_id }
  if (row.source_note_id) return { source_type: 'note', source_id: row.source_note_id }
  if (row.source_ideal_goal_id) return { source_type: 'ideal_goal', source_id: row.source_ideal_goal_id }
  return { source_type: null, source_id: null }
}

function inferDispatchMode(row) {
  if (row.executor !== 'codex_app') return null
  if (row.result_codex_manual_handoff === true || row.result_codex_manual_handoff === 'true') return 'manual'
  return 'auto'
}

function progressSummary(row) {
  return isRecord(row.result_progress_summary) ? row.result_progress_summary : null
}

function currentStep(row) {
  const summary = progressSummary(row)
  return compactString(row.result_current_step, 4000)
    ?? compactString(summary?.current_step, 4000)
    ?? compactString(row.result_message, 4000)
    ?? tailString(row.result_live_log, 4000)
}

function summaryText(row) {
  const summary = progressSummary(row)
  return compactString(summary?.summary, 2000)
    ?? compactString(row.result_message, 2000)
}

function progressPercent(row) {
  const summary = progressSummary(row)
  return boundedPercent(summary?.progress_percent)
}

function updatedAt(row) {
  return compactString(row.result_last_activity_at, 80)
    ?? compactString(row.completed_at, 80)
    ?? compactString(row.started_at, 80)
    ?? compactString(row.created_at, 80)
    ?? new Date().toISOString()
}

function snapshotProgressId(taskId) {
  return `backfill:task-progress:${taskId}:snapshot`
}

function activityProgressId(activityId) {
  return `backfill:activity:${activityId}`
}

function observationProgressId(observationId) {
  return `backfill:observation:${observationId}`
}

function statusEventId(taskId) {
  return `backfill:status:${taskId}`
}

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

function isMissingOptionalSupabaseTable(error) {
  return error?.code === 'PGRST205' || String(error?.message ?? '').includes('Could not find the table')
}

async function fetchTasks(supabase, options, sinceIso) {
  const tasks = []
  for (let from = 0; ; from += options.pageSize) {
    const to = from + options.pageSize - 1
    let query = supabase
      .from('ai_tasks')
      .select(TASK_SELECT)
      .gte('created_at', sinceIso)
      .or('executor.in.(codex,codex_app),codex_thread_id.not.is.null')
      .order('created_at', { ascending: true })
      .range(from, to)

    if (options.maxTasks) query = query.limit(Math.min(options.pageSize, options.maxTasks - tasks.length))

    const { data, error } = await query
    if (error) throw new Error(`Supabase ai_tasks query failed: ${error.message}`)
    tasks.push(...(data ?? []))

    if (!data || data.length < options.pageSize) break
    if (options.maxTasks && tasks.length >= options.maxTasks) break
  }
  return options.maxTasks ? tasks.slice(0, options.maxTasks) : tasks
}

async function fetchActivityForTasks(supabase, taskIds, limit) {
  if (!limit || taskIds.length === 0) return []
  const all = []
  for (const taskId of taskIds) {
    const { data, error } = await supabase
      .from('ai_task_activity_messages')
      .select(ACTIVITY_SELECT)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      if (isMissingOptionalSupabaseTable(error)) {
        console.warn('Skipping ai_task_activity_messages: table is not available in Supabase schema cache.')
        return []
      }
      throw new Error(`Supabase ai_task_activity_messages query failed: ${error.message}`)
    }
    all.push(...[...(data ?? [])].reverse())
  }
  return all
}

async function fetchObservationsForTasks(supabase, taskIds, limit) {
  if (!limit || taskIds.length === 0) return []
  const all = []
  for (const taskId of taskIds) {
    const { data, error } = await supabase
      .from('ai_task_observations')
      .select(OBSERVATION_SELECT)
      .eq('task_id', taskId)
      .order('observed_at', { ascending: false })
      .limit(limit)
    if (error) {
      if (isMissingOptionalSupabaseTable(error)) {
        console.warn('Skipping ai_task_observations: table is not available in Supabase schema cache.')
        return []
      }
      throw new Error(`Supabase ai_task_observations query failed: ${error.message}`)
    }
    all.push(...[...(data ?? [])].reverse())
  }
  return all
}

async function countExistingIds(turso, table, idColumn, ids) {
  if (ids.length === 0) return 0
  let total = 0
  for (const idsChunk of chunk(ids, 100)) {
    const placeholders = idsChunk.map(() => '?').join(', ')
    const result = await turso.execute({
      sql: `SELECT COUNT(*) AS count FROM ${table} WHERE ${idColumn} IN (${placeholders})`,
      args: idsChunk,
    })
    total += Number(result.rows[0]?.count ?? 0)
  }
  return total
}

function taskArgs(row) {
  const source = sourceTypeAndId(row)
  const taskCurrentStep = currentStep(row)
  const taskSummary = summaryText(row)
  const taskUpdatedAt = updatedAt(row)
  return [
    row.id,
    row.user_id,
    row.space_id ?? null,
    compactString(row.prompt, 140),
    row.status ?? 'pending',
    row.executor ?? null,
    inferDispatchMode(row),
    source.source_type,
    source.source_id,
    row.codex_thread_id ?? null,
    taskCurrentStep,
    progressPercent(row),
    taskSummary,
    compactString(row.error, 2000),
    row.created_at ?? taskUpdatedAt,
    taskUpdatedAt,
    row.started_at ?? null,
    row.completed_at ?? null,
  ]
}

async function upsertTask(turso, row) {
  await turso.execute({
    sql: `
      INSERT INTO ai_tasks (
        id, user_id, space_id, title, status, executor, dispatch_mode, source_type, source_id,
        codex_thread_id, current_step, progress_percent, summary, error_message,
        created_at, updated_at, started_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        space_id = excluded.space_id,
        title = excluded.title,
        status = excluded.status,
        executor = excluded.executor,
        dispatch_mode = excluded.dispatch_mode,
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        codex_thread_id = excluded.codex_thread_id,
        current_step = excluded.current_step,
        progress_percent = excluded.progress_percent,
        summary = excluded.summary,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at,
        started_at = COALESCE(ai_tasks.started_at, excluded.started_at),
        completed_at = excluded.completed_at
    `,
    args: taskArgs(row),
  })
}

function snapshotProgress(row) {
  const message = currentStep(row) ?? summaryText(row)
  const summary = progressSummary(row)
  if (!message && !summary) return null
  return {
    id: snapshotProgressId(row.id),
    task_id: row.id,
    user_id: row.user_id,
    phase: 'backfill_snapshot',
    message,
    progress_json: {
      source: 'supabase_ai_tasks_backfill',
      progress_summary: summary,
      codex_run_state: row.result_codex_run_state ?? null,
      progress_percent: progressPercent(row),
    },
    created_at: updatedAt(row),
  }
}

function activityProgress(row) {
  return {
    id: activityProgressId(row.id),
    task_id: row.task_id,
    user_id: row.user_id,
    phase: `activity:${compactString(row.kind, 60) ?? 'progress'}`,
    message: compactString(row.body, 2000),
    progress_json: {
      source: 'supabase_activity_backfill',
      role: row.role ?? null,
      kind: row.kind ?? null,
      importance: row.importance ?? null,
      metadata: isRecord(row.metadata) ? row.metadata : null,
      supabase_id: row.id,
    },
    created_at: row.created_at,
  }
}

function observationProgress(row) {
  return {
    id: observationProgressId(row.id),
    task_id: row.task_id,
    user_id: row.user_id,
    phase: `observation:${compactString(row.state, 60) ?? 'unknown'}`,
    message: compactString(row.summary || row.comment, 2000),
    progress_json: {
      source: 'supabase_observation_backfill',
      observation_source: row.source ?? null,
      state: row.state ?? null,
      progress_percent: boundedPercent(row.progress_percent),
      confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence ?? 0),
      session_health: row.session_health ?? null,
      comment: compactString(row.comment, 2000),
      evidence: isRecord(row.evidence) ? row.evidence : null,
      supabase_id: row.id,
    },
    created_at: row.observed_at ?? row.created_at,
  }
}

function statusEvent(row) {
  if (!row.status) return null
  return {
    id: statusEventId(row.id),
    task_id: row.id,
    user_id: row.user_id,
    event_type: `status:${row.status}`,
    payload_json: {
      source: 'supabase_ai_tasks_backfill',
      status: row.status,
      codex_run_state: row.result_codex_run_state ?? null,
      awaiting_approval_at: row.result_awaiting_approval_at ?? null,
      error_message: compactString(row.error, 2000),
    },
    created_at: updatedAt(row),
  }
}

async function upsertProgress(turso, item) {
  await turso.execute({
    sql: `
      INSERT INTO ai_task_progress (id, task_id, user_id, phase, message, progress_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase,
        message = excluded.message,
        progress_json = excluded.progress_json,
        created_at = excluded.created_at
    `,
    args: [
      item.id,
      item.task_id,
      item.user_id,
      item.phase ?? null,
      item.message ?? null,
      jsonOrNull(item.progress_json),
      item.created_at ?? new Date().toISOString(),
    ],
  })
}

async function insertEventIfMissing(turso, item) {
  await turso.execute({
    sql: `
      INSERT OR IGNORE INTO ai_task_events (id, task_id, user_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      item.id,
      item.task_id,
      item.user_id,
      item.event_type,
      jsonOrNull(item.payload_json),
      item.created_at ?? new Date().toISOString(),
    ],
  })
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const env = loadMonitoringEnv()
  const supabaseUrl = requiredEnvValue(env, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'])
  if (supabaseUrl) env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl
  const missing = [
    ...missingMonitoringEnv(env, ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']),
    ...missingMonitoringEnv(env, ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']),
  ]
  if (missing.length) {
    throw new Error(`Missing required env: ${[...new Set(missing)].join(', ')}`)
  }

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const turso = createTursoClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  })

  const tasks = await fetchTasks(supabase, options, since)
  const taskIds = tasks.map(task => task.id)
  const [activities, observations] = await Promise.all([
    fetchActivityForTasks(supabase, taskIds, options.activityLimit),
    fetchObservationsForTasks(supabase, taskIds, options.observationLimit),
  ])

  const snapshotProgressRows = tasks.map(snapshotProgress).filter(Boolean)
  const activityProgressRows = activities.map(activityProgress).filter(row => row.message)
  const observationProgressRows = observations.map(observationProgress).filter(row => row.message || row.progress_json)
  const progressRows = [...snapshotProgressRows, ...activityProgressRows, ...observationProgressRows]
  const eventRows = tasks.map(statusEvent).filter(Boolean)

  const [existingTasks, existingProgress, existingEvents] = await Promise.all([
    countExistingIds(turso, 'ai_tasks', 'id', taskIds),
    countExistingIds(turso, 'ai_task_progress', 'id', progressRows.map(row => row.id)),
    countExistingIds(turso, 'ai_task_events', 'id', eventRows.map(row => row.id)),
  ])

  const summary = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    since,
    days: options.days,
    targets: {
      ai_tasks: tasks.length,
      snapshot_progress: snapshotProgressRows.length,
      activity_messages: activities.length,
      observation_progress: observationProgressRows.length,
      status_events: eventRows.length,
    },
    existing_in_turso: {
      ai_tasks: existingTasks,
      progress_rows: existingProgress,
      event_rows: existingEvents,
    },
    estimated_turso_writes: {
      ai_task_upserts: tasks.length,
      progress_upserts: progressRows.length,
      event_insert_or_ignore: eventRows.length,
      total_statements: tasks.length + progressRows.length + eventRows.length,
    },
    skip_candidates: {
      progress_rows_already_present: existingProgress,
      event_rows_already_present: existingEvents,
    },
  }

  if (options.dryRun) {
    printSummary(summary)
    return
  }

  for (const task of tasks) await upsertTask(turso, task)
  for (const progress of progressRows) await upsertProgress(turso, progress)
  for (const event of eventRows) await insertEventIfMissing(turso, event)

  const [verifiedTasks, verifiedProgress, verifiedEvents] = await Promise.all([
    countExistingIds(turso, 'ai_tasks', 'id', taskIds),
    countExistingIds(turso, 'ai_task_progress', 'id', progressRows.map(row => row.id)),
    countExistingIds(turso, 'ai_task_events', 'id', eventRows.map(row => row.id)),
  ])

  printSummary({
    ...summary,
    verified_in_turso_after_apply: {
      ai_tasks: verifiedTasks,
      progress_rows: verifiedProgress,
      event_rows: verifiedEvents,
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
