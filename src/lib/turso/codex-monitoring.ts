import type { SupabaseClient } from '@supabase/supabase-js'
import { getTursoClient, jsonOrNull, parseJsonRecord } from './client'

export type TursoAiTask = {
  id: string
  user_id: string
  space_id: string | null
  title: string | null
  status: string
  executor: string | null
  dispatch_mode: string | null
  source_type: string | null
  source_id: string | null
  codex_thread_id: string | null
  current_step: string | null
  progress_percent: number | null
  summary: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export type TursoTaskProgress = {
  id: string
  task_id: string
  user_id: string
  phase: string | null
  message: string | null
  progress_json: Record<string, unknown> | null
  created_at: string
}

export type TursoTaskEvent = {
  id: string
  task_id: string
  user_id: string
  event_type: string
  payload_json: Record<string, unknown> | null
  created_at: string
}

export type TursoRunnerHeartbeat = {
  runner_id: string
  user_id: string
  device_id: string | null
  status: string
  last_seen_at: string
  current_task_id: string | null
  version: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TursoTaskProgressWatch = {
  task_id: string
  user_id: string
  watcher_id: string
  watcher_type: string
  expires_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

export type TursoScreenshot = {
  id: string
  task_id: string
  user_id: string
  thumbnail_key: string | null
  preview_key: string | null
  width: number | null
  height: number | null
  thumbnail_size_bytes: number | null
  preview_size_bytes: number | null
  captured_at: string
  created_at: string
  deleted_at: string | null
  local_original_path_hash: string | null
}

type Row = Record<string, unknown>

type TaskAccessOptions = {
  userId: string
  spaceId?: string | null
  supabase?: SupabaseClient
}

function nowIso() {
  return new Date().toISOString()
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asTask(row: Row): TursoAiTask {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    space_id: asString(row.space_id),
    title: asString(row.title),
    status: asString(row.status) ?? 'pending',
    executor: asString(row.executor),
    dispatch_mode: asString(row.dispatch_mode),
    source_type: asString(row.source_type),
    source_id: asString(row.source_id),
    codex_thread_id: asString(row.codex_thread_id),
    current_step: asString(row.current_step),
    progress_percent: asNumber(row.progress_percent),
    summary: asString(row.summary),
    error_message: asString(row.error_message),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
    started_at: asString(row.started_at),
    completed_at: asString(row.completed_at),
  }
}

function asProgress(row: Row): TursoTaskProgress {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    user_id: String(row.user_id),
    phase: asString(row.phase),
    message: asString(row.message),
    progress_json: parseJsonRecord(row.progress_json),
    created_at: asString(row.created_at) ?? nowIso(),
  }
}

function asEvent(row: Row): TursoTaskEvent {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    user_id: String(row.user_id),
    event_type: asString(row.event_type) ?? 'unknown',
    payload_json: parseJsonRecord(row.payload_json),
    created_at: asString(row.created_at) ?? nowIso(),
  }
}

function asRunnerHeartbeat(row: Row): TursoRunnerHeartbeat {
  return {
    runner_id: String(row.runner_id),
    user_id: String(row.user_id),
    device_id: asString(row.device_id),
    status: asString(row.status) ?? 'online',
    last_seen_at: asString(row.last_seen_at) ?? nowIso(),
    current_task_id: asString(row.current_task_id),
    version: asString(row.version),
    metadata_json: parseJsonRecord(row.metadata_json),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
  }
}

function asTaskProgressWatch(row: Row): TursoTaskProgressWatch {
  return {
    task_id: String(row.task_id),
    user_id: String(row.user_id),
    watcher_id: String(row.watcher_id),
    watcher_type: asString(row.watcher_type) ?? 'web',
    expires_at: asString(row.expires_at) ?? nowIso(),
    last_seen_at: asString(row.last_seen_at) ?? nowIso(),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
  }
}

function asScreenshot(row: Row): TursoScreenshot {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    user_id: String(row.user_id),
    thumbnail_key: asString(row.thumbnail_key),
    preview_key: asString(row.preview_key),
    width: asNumber(row.width),
    height: asNumber(row.height),
    thumbnail_size_bytes: asNumber(row.thumbnail_size_bytes),
    preview_size_bytes: asNumber(row.preview_size_bytes),
    captured_at: asString(row.captured_at) ?? nowIso(),
    created_at: asString(row.created_at) ?? nowIso(),
    deleted_at: asString(row.deleted_at),
    local_original_path_hash: asString(row.local_original_path_hash),
  }
}

function sourceTypeAndId(row: Row): { sourceType: string | null; sourceId: string | null } {
  const sourceTaskId = asString(row.source_task_id)
  if (sourceTaskId) return { sourceType: 'mindmap', sourceId: sourceTaskId }
  const sourceNoteId = asString(row.source_note_id)
  if (sourceNoteId) return { sourceType: 'note', sourceId: sourceNoteId }
  const sourceIdealGoalId = asString(row.source_ideal_goal_id)
  if (sourceIdealGoalId) return { sourceType: 'ideal_goal', sourceId: sourceIdealGoalId }
  return { sourceType: null, sourceId: null }
}

export async function upsertTursoAiTask(input: {
  id: string
  user_id: string
  space_id?: string | null
  title?: string | null
  status?: string | null
  executor?: string | null
  dispatch_mode?: string | null
  source_type?: string | null
  source_id?: string | null
  codex_thread_id?: string | null
  current_step?: string | null
  progress_percent?: number | null
  summary?: string | null
  error_message?: string | null
  created_at?: string | null
  updated_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}) {
  const db = getTursoClient()
  const updatedAt = input.updated_at ?? nowIso()
  await db.execute({
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
        title = COALESCE(excluded.title, ai_tasks.title),
        status = COALESCE(excluded.status, ai_tasks.status),
        executor = COALESCE(excluded.executor, ai_tasks.executor),
        dispatch_mode = COALESCE(excluded.dispatch_mode, ai_tasks.dispatch_mode),
        source_type = COALESCE(excluded.source_type, ai_tasks.source_type),
        source_id = COALESCE(excluded.source_id, ai_tasks.source_id),
        codex_thread_id = COALESCE(excluded.codex_thread_id, ai_tasks.codex_thread_id),
        current_step = COALESCE(excluded.current_step, ai_tasks.current_step),
        progress_percent = COALESCE(excluded.progress_percent, ai_tasks.progress_percent),
        summary = COALESCE(excluded.summary, ai_tasks.summary),
        error_message = COALESCE(excluded.error_message, ai_tasks.error_message),
        updated_at = excluded.updated_at,
        started_at = COALESCE(excluded.started_at, ai_tasks.started_at),
        completed_at = COALESCE(excluded.completed_at, ai_tasks.completed_at)
    `,
    args: [
      input.id,
      input.user_id,
      input.space_id ?? null,
      input.title ?? null,
      input.status ?? 'pending',
      input.executor ?? null,
      input.dispatch_mode ?? null,
      input.source_type ?? null,
      input.source_id ?? null,
      input.codex_thread_id ?? null,
      input.current_step ?? null,
      input.progress_percent ?? null,
      input.summary ?? null,
      input.error_message ?? null,
      input.created_at ?? updatedAt,
      updatedAt,
      input.started_at ?? null,
      input.completed_at ?? null,
    ],
  })
}

export async function ensureTursoAiTaskStub(input: {
  id: string
  user_id: string
  space_id?: string | null
  status?: string | null
  title?: string | null
  created_at?: string | null
  updated_at?: string | null
}) {
  const timestamp = input.updated_at ?? input.created_at ?? nowIso()
  await getTursoClient().execute({
    sql: `
      INSERT OR IGNORE INTO ai_tasks (
        id, user_id, space_id, title, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      input.id,
      input.user_id,
      input.space_id ?? null,
      input.title ?? null,
      input.status ?? 'pending',
      input.created_at ?? timestamp,
      timestamp,
    ],
  })
}

export async function seedTursoTaskFromSupabase(
  supabase: SupabaseClient,
  taskId: string,
  options: { userId: string; spaceId?: string | null },
): Promise<TursoAiTask | null> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, user_id, space_id, prompt, status, executor, codex_thread_id, source_task_id, source_note_id, source_ideal_goal_id, error, created_at, started_at, completed_at')
    .eq('id', taskId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as Row
  const rowUserId = asString(row.user_id)
  const rowSpaceId = asString(row.space_id)
  if (!rowUserId) return null
  if (rowUserId !== options.userId && (!options.spaceId || rowSpaceId !== options.spaceId)) return null

  const source = sourceTypeAndId(row)
  await upsertTursoAiTask({
    id: String(row.id),
    user_id: rowUserId,
    space_id: rowSpaceId,
    title: asString(row.prompt)?.slice(0, 140) ?? null,
    status: asString(row.status),
    executor: asString(row.executor),
    source_type: source.sourceType,
    source_id: source.sourceId,
    codex_thread_id: asString(row.codex_thread_id),
    error_message: asString(row.error),
    created_at: asString(row.created_at),
    started_at: asString(row.started_at),
    completed_at: asString(row.completed_at),
  })

  return getTursoTaskForAuth(taskId, options)
}

export async function getTursoTaskForAuth(taskId: string, options: TaskAccessOptions): Promise<TursoAiTask | null> {
  const db = getTursoClient()
  const clauses = ['id = ?']
  const args: Array<string> = [taskId]

  if (options.spaceId) {
    clauses.push('(user_id = ? OR space_id = ?)')
    args.push(options.userId, options.spaceId)
  } else {
    clauses.push('user_id = ?')
    args.push(options.userId)
  }

  const result = await db.execute({
    sql: `SELECT * FROM ai_tasks WHERE ${clauses.join(' AND ')} LIMIT 1`,
    args,
  })
  const row = result.rows[0] as Row | undefined
  if (row) return asTask(row)
  if (!options.supabase) return null
  return seedTursoTaskFromSupabase(options.supabase, taskId, options)
}

export async function insertTaskProgress(input: {
  id?: string | null
  task_id: string
  user_id: string
  phase?: string | null
  message?: string | null
  progress_json?: unknown
  created_at?: string | null
}) {
  const id = input.id ?? crypto.randomUUID()
  const createdAt = input.created_at ?? nowIso()
  await getTursoClient().execute({
    sql: `
      INSERT INTO ai_task_progress (id, task_id, user_id, phase, message, progress_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        user_id = excluded.user_id,
        phase = excluded.phase,
        message = excluded.message,
        progress_json = excluded.progress_json,
        created_at = excluded.created_at
    `,
    args: [
      id,
      input.task_id,
      input.user_id,
      input.phase ?? null,
      input.message ?? null,
      jsonOrNull(input.progress_json),
      createdAt,
    ],
  })
  return { id, created_at: createdAt }
}

export async function insertTaskEvent(input: {
  id?: string | null
  task_id: string
  user_id: string
  event_type: string
  payload_json?: unknown
  created_at?: string | null
}) {
  const id = input.id ?? crypto.randomUUID()
  const createdAt = input.created_at ?? nowIso()
  await getTursoClient().execute({
    sql: `
      INSERT INTO ai_task_events (id, task_id, user_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        user_id = excluded.user_id,
        event_type = excluded.event_type,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `,
    args: [id, input.task_id, input.user_id, input.event_type, jsonOrNull(input.payload_json), createdAt],
  })
  return { id, created_at: createdAt }
}

export async function listTaskProgress(taskId: string, userId: string, limit = 50) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM ai_task_progress
      WHERE task_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [taskId, userId, limit],
  })
  return result.rows.map(row => asProgress(row as Row))
}

export async function listTaskEvents(taskId: string, userId: string, limit = 50) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM ai_task_events
      WHERE task_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [taskId, userId, limit],
  })
  return result.rows.map(row => asEvent(row as Row))
}

export async function listTursoAiTaskSnapshots(options: {
  userId: string
  spaceId?: string | null
  status?: string | null
  updatedAfter?: string | null
  cursor?: { updatedAt: string; id: string } | null
  limit?: number
}) {
  const clauses = ['(user_id = ?']
  const args: Array<string | number> = [options.userId]

  if (options.spaceId) {
    clauses[0] += ' OR space_id = ?'
    args.push(options.spaceId)
  }
  clauses[0] += ')'

  if (options.status) {
    clauses.push('status = ?')
    args.push(options.status)
  }
  if (options.cursor) {
    clauses.push('(updated_at > ? OR (updated_at = ? AND id > ?))')
    args.push(options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id)
  } else if (options.updatedAfter) {
    clauses.push('updated_at > ?')
    args.push(options.updatedAfter)
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const hasCursor = !!options.cursor || !!options.updatedAfter
  const orderDirection = hasCursor ? 'ASC' : 'DESC'
  const result = await getTursoClient().execute({
    sql: `
      SELECT
        id, user_id, space_id, title, status, executor, dispatch_mode, source_type, source_id,
        codex_thread_id, current_step, progress_percent, summary, error_message,
        created_at, updated_at, started_at, completed_at
      FROM ai_tasks
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at ${orderDirection}, id ${orderDirection}
      LIMIT ?
    `,
    args: [...args, limit],
  })
  const tasks = result.rows.map(row => asTask(row as Row))
  return hasCursor ? tasks : tasks.reverse()
}

export async function upsertTaskProgressWatch(input: {
  task_id: string
  user_id: string
  watcher_id: string
  watcher_type?: string | null
  ttl_seconds?: number | null
}) {
  const now = nowIso()
  const ttlSeconds = Math.min(Math.max(input.ttl_seconds ?? 20, 5), 60)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await getTursoClient().execute({
    sql: `
      INSERT INTO task_progress_watches (
        task_id, user_id, watcher_id, watcher_type, expires_at, last_seen_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, user_id, watcher_id) DO UPDATE SET
        watcher_type = excluded.watcher_type,
        expires_at = excluded.expires_at,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `,
    args: [
      input.task_id,
      input.user_id,
      input.watcher_id,
      input.watcher_type ?? 'web',
      expiresAt,
      now,
      now,
      now,
    ],
  })
  return { expires_at: expiresAt, last_seen_at: now }
}

export async function closeTaskProgressWatch(input: {
  task_id: string
  user_id: string
  watcher_id: string
}) {
  await getTursoClient().execute({
    sql: 'DELETE FROM task_progress_watches WHERE task_id = ? AND user_id = ? AND watcher_id = ?',
    args: [input.task_id, input.user_id, input.watcher_id],
  })
}

export async function deleteExpiredTaskProgressWatches(options: {
  olderThanSeconds?: number
  now?: string | null
} = {}) {
  const nowMs = options.now ? Date.parse(options.now) : Date.now()
  const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const olderThanSeconds = Math.max(options.olderThanSeconds ?? 24 * 60 * 60, 60)
  const cutoff = new Date(baseMs - olderThanSeconds * 1000).toISOString()
  const result = await getTursoClient().execute({
    sql: 'DELETE FROM task_progress_watches WHERE expires_at < ?',
    args: [cutoff],
  })
  return { deleted: result.rowsAffected ?? 0, cutoff }
}

export async function listActiveTaskProgressWatches(options: {
  userId?: string | null
  taskId?: string | null
  now?: string | null
  limit?: number
}) {
  const clauses = ['expires_at > ?']
  const args: Array<string | number> = [options.now ?? nowIso()]
  if (options.userId) {
    clauses.push('user_id = ?')
    args.push(options.userId)
  }
  if (options.taskId) {
    clauses.push('task_id = ?')
    args.push(options.taskId)
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500)
  const result = await getTursoClient().execute({
    sql: `
      SELECT task_id, user_id, watcher_id, watcher_type, expires_at, last_seen_at, created_at, updated_at
      FROM task_progress_watches
      WHERE ${clauses.join(' AND ')}
      ORDER BY expires_at DESC
      LIMIT ?
    `,
    args: [...args, limit],
  })
  return result.rows.map(row => asTaskProgressWatch(row as Row))
}

export async function upsertRunnerHeartbeat(input: {
  runner_id: string
  user_id: string
  device_id?: string | null
  status?: string | null
  last_seen_at?: string | null
  current_task_id?: string | null
  version?: string | null
  metadata_json?: unknown
}) {
  const seenAt = input.last_seen_at ?? nowIso()
  const hasCurrentTaskId = Object.prototype.hasOwnProperty.call(input, 'current_task_id')
  await getTursoClient().execute({
    sql: `
      INSERT INTO runner_heartbeats (
        runner_id, user_id, device_id, status, last_seen_at, current_task_id, version, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(runner_id) DO UPDATE SET
        user_id = excluded.user_id,
        device_id = excluded.device_id,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        current_task_id = CASE WHEN ? THEN excluded.current_task_id ELSE runner_heartbeats.current_task_id END,
        version = excluded.version,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
    args: [
      input.runner_id,
      input.user_id,
      input.device_id ?? null,
      input.status ?? 'online',
      seenAt,
      input.current_task_id ?? null,
      input.version ?? null,
      jsonOrNull(input.metadata_json),
      seenAt,
      seenAt,
      hasCurrentTaskId ? 1 : 0,
    ],
  })
  return { last_seen_at: seenAt }
}

export async function listRunnerHeartbeats(userId: string, limit = 20) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM runner_heartbeats
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `,
    args: [userId, limit],
  })
  return result.rows.map(row => asRunnerHeartbeat(row as Row))
}

export async function insertScreenshotMetadata(input: {
  id: string
  task_id: string
  user_id: string
  thumbnail_key?: string | null
  preview_key?: string | null
  width?: number | null
  height?: number | null
  thumbnail_size_bytes?: number | null
  preview_size_bytes?: number | null
  captured_at: string
  local_original_path_hash?: string | null
}) {
  await getTursoClient().execute({
    sql: `
      INSERT INTO screenshots (
        id, task_id, user_id, thumbnail_key, preview_key, width, height,
        thumbnail_size_bytes, preview_size_bytes, captured_at, local_original_path_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      input.id,
      input.task_id,
      input.user_id,
      input.thumbnail_key ?? null,
      input.preview_key ?? null,
      input.width ?? null,
      input.height ?? null,
      input.thumbnail_size_bytes ?? null,
      input.preview_size_bytes ?? null,
      input.captured_at,
      input.local_original_path_hash ?? null,
    ],
  })
}

export async function listScreenshotsForTask(taskId: string, userId: string, limit = 20) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM screenshots
      WHERE task_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY captured_at DESC
      LIMIT ?
    `,
    args: [taskId, userId, limit],
  })
  return result.rows.map(row => asScreenshot(row as Row))
}

export async function getLatestScreenshotForTask(taskId: string, userId: string) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM screenshots
      WHERE task_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [taskId, userId],
  })
  const row = result.rows[0] as Row | undefined
  return row ? asScreenshot(row) : null
}

export async function getScreenshotForUser(id: string, userId: string) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT * FROM screenshots
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    args: [id, userId],
  })
  const row = result.rows[0] as Row | undefined
  return row ? asScreenshot(row) : null
}

export async function markScreenshotDeleted(id: string, userId: string) {
  const deletedAt = nowIso()
  await getTursoClient().execute({
    sql: 'UPDATE screenshots SET deleted_at = ? WHERE id = ? AND user_id = ?',
    args: [deletedAt, id, userId],
  })
  return { deleted_at: deletedAt }
}
