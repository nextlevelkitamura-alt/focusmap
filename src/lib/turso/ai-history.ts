import { createHash } from 'node:crypto'
import { getTursoClient, jsonOrNull, parseJsonRecord } from './client'
import type {
  AiHistoryListItem,
  AiHistoryPlacement,
  AiHistoryStatus,
} from '@/types/ai-history'

export const AI_HISTORY_STATUSES = new Set<AiHistoryStatus>([
  'running',
  'awaiting_approval',
  'needs_input',
  'completed',
  'failed',
  'idle',
])

type Row = Record<string, unknown>

export type AiHistoryCursor = {
  indexedAt: string
  id: string
}

export type TursoAiHistoryItem = {
  id: string
  user_id: string
  provider: string
  external_thread_id: string
  repo_path: string
  worktree_path: string | null
  project_id: string | null
  source_task_id: string | null
  linked_ai_task_id: string | null
  title: string
  snippet: string | null
  status: AiHistoryStatus
  run_state: string | null
  last_activity_at: string
  indexed_at: string
  started_at: string | null
  ended_at: string | null
  work_duration_seconds: number | null
  archived: boolean
  archived_at: string | null
  deleted_at: string | null
  detail_synced_at: string | null
  detail_message_count: number | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TursoProjectRepoScope = {
  id: string
  user_id: string
  project_id: string
  provider: string
  repo_path: string
  display_name: string | null
  sync_enabled: boolean
  last_scanned_at: string | null
  last_reconciled_at: string | null
  settings_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type AiHistoryUpsertInput = {
  id?: string | null
  user_id: string
  provider: string
  external_thread_id: string
  repo_path: string
  worktree_path?: string | null
  project_id?: string | null
  source_task_id?: string | null
  clear_source_task_id?: boolean | null
  linked_ai_task_id?: string | null
  title: string
  snippet?: string | null
  status: AiHistoryStatus
  run_state?: string | null
  last_activity_at: string
  indexed_at?: string | null
  started_at?: string | null
  ended_at?: string | null
  work_duration_seconds?: number | null
  archived?: boolean | null
  archived_at?: string | null
  deleted_at?: string | null
  detail_synced_at?: string | null
  detail_message_count?: number | null
  metadata_json?: Record<string, unknown> | null
}

export type ProjectRepoScopeUpsertInput = {
  id?: string | null
  user_id: string
  project_id: string
  provider: string
  repo_path: string
  display_name?: string | null
  sync_enabled?: boolean | null
  last_scanned_at?: string | null
  last_reconciled_at?: string | null
  settings_json?: Record<string, unknown> | null
}

function nowIso() {
  return new Date().toISOString()
}

function stableId(prefix: string, parts: string[]) {
  const digest = createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32)
  return `${prefix}_${digest}`
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'bigint') return value !== 0n
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

function asStatus(value: unknown): AiHistoryStatus {
  const status = asString(value)
  return status && AI_HISTORY_STATUSES.has(status as AiHistoryStatus)
    ? status as AiHistoryStatus
    : 'idle'
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

function placeholders(values: unknown[]) {
  return values.map(() => '?').join(', ')
}

function repoLabel(repoPath: string) {
  const normalized = repoPath.replace(/\/+$/u, '')
  const label = normalized.split('/').filter(Boolean).at(-1)
  return label || repoPath
}

function asItem(row: Row): TursoAiHistoryItem {
  const provider = asString(row.provider) ?? 'codex_app'
  const externalThreadId = asString(row.external_thread_id) ?? ''
  const repoPath = asString(row.repo_path) ?? ''
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider,
    external_thread_id: externalThreadId,
    repo_path: repoPath,
    worktree_path: asString(row.worktree_path),
    project_id: asString(row.project_id),
    source_task_id: asString(row.source_task_id),
    linked_ai_task_id: asString(row.linked_ai_task_id),
    title: asString(row.title) ?? (externalThreadId ? `Codex thread ${externalThreadId.slice(0, 8)}` : 'AI履歴'),
    snippet: asString(row.snippet),
    status: asStatus(row.status),
    run_state: asString(row.run_state),
    last_activity_at: asString(row.last_activity_at) ?? nowIso(),
    indexed_at: asString(row.indexed_at) ?? nowIso(),
    started_at: asString(row.started_at),
    ended_at: asString(row.ended_at),
    work_duration_seconds: asNumber(row.work_duration_seconds),
    archived: asBoolean(row.archived),
    archived_at: asString(row.archived_at),
    deleted_at: asString(row.deleted_at),
    detail_synced_at: asString(row.detail_synced_at),
    detail_message_count: asNumber(row.detail_message_count),
    metadata_json: parseJsonRecord(row.metadata_json),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
  }
}

function asScope(row: Row): TursoProjectRepoScope {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    project_id: String(row.project_id),
    provider: asString(row.provider) ?? 'codex_app',
    repo_path: asString(row.repo_path) ?? '',
    display_name: asString(row.display_name),
    sync_enabled: asBoolean(row.sync_enabled),
    last_scanned_at: asString(row.last_scanned_at),
    last_reconciled_at: asString(row.last_reconciled_at),
    settings_json: parseJsonRecord(row.settings_json),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
  }
}

export function encodeAiHistoryCursor(item: { indexed_at: string; id: string }) {
  return `${item.indexed_at}|${item.id}`
}

export function parseAiHistoryCursor(value: string | null): AiHistoryCursor | null {
  if (!value) return null
  const [indexedAtRaw, idRaw] = value.split('|')
  const parsed = Date.parse(indexedAtRaw ?? '')
  const id = typeof idRaw === 'string' ? idRaw.trim() : ''
  if (!Number.isFinite(parsed) || !id) return null
  return { indexedAt: new Date(parsed).toISOString(), id }
}

export function toAiHistoryListItem(
  item: TursoAiHistoryItem,
  scopeLabels: Map<string, string | null> = new Map(),
): AiHistoryListItem {
  const sourceTaskId = item.source_task_id
  const detailMessageCount = item.detail_message_count ?? 0
  return {
    id: item.id,
    provider: item.provider,
    externalThreadId: item.external_thread_id,
    title: item.title,
    snippet: item.snippet,
    repoPath: item.repo_path,
    repoLabel: scopeLabels.get(item.repo_path) || repoLabel(item.repo_path),
    worktreePath: item.worktree_path,
    placement: sourceTaskId ? 'mindmap' : 'unplaced',
    sourceTaskId,
    linkedAiTaskId: item.linked_ai_task_id,
    status: item.status,
    runState: item.run_state,
    lastActivityAt: item.last_activity_at,
    indexedAt: item.indexed_at,
    startedAt: item.started_at,
    endedAt: item.ended_at,
    workDurationSeconds: item.work_duration_seconds,
    archived: item.archived,
    detailHydrated: Boolean(item.detail_synced_at || detailMessageCount > 0),
    detailSyncedAt: item.detail_synced_at,
    codexOpenUrl: item.provider === 'codex_app' && item.external_thread_id
      ? `codex://threads/${item.external_thread_id}`
      : null,
  }
}

function scopedHistoryWhere(options: {
  userId: string
  projectId: string
  repo?: string | null
  repoPaths?: string[]
  includeArchived?: boolean
  includeDeleted?: boolean
  placement?: AiHistoryPlacement | 'all'
  status?: AiHistoryStatus | 'all' | null
}) {
  const clauses = ['user_id = ?']
  const args: Array<string | number> = [options.userId]
  const scopeRepoPaths = uniqueStrings(options.repoPaths ?? [])

  if (options.repo && options.repo !== 'all') {
    clauses.push('repo_path = ?')
    args.push(options.repo)
  }

  if (scopeRepoPaths.length > 0) {
    clauses.push(`(project_id = ? OR repo_path IN (${placeholders(scopeRepoPaths)}))`)
    args.push(options.projectId, ...scopeRepoPaths)
  } else {
    clauses.push('project_id = ?')
    args.push(options.projectId)
  }

  if (!options.includeArchived) clauses.push('archived = 0')
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL')
  if (options.placement === 'unplaced') clauses.push('source_task_id IS NULL')
  if (options.placement === 'mindmap') clauses.push('source_task_id IS NOT NULL')
  if (options.status && options.status !== 'all') {
    clauses.push('status = ?')
    args.push(options.status)
  }

  return { clauses, args }
}

export async function listProjectRepoScopes(options: {
  userId: string
  projectId: string
  provider?: string | null
}) {
  const clauses = ['user_id = ?', 'project_id = ?']
  const args: Array<string | number> = [options.userId, options.projectId]
  if (options.provider) {
    clauses.push('provider = ?')
    args.push(options.provider)
  }
  const result = await getTursoClient().execute({
    sql: `
      SELECT *
      FROM project_repo_scopes
      WHERE ${clauses.join(' AND ')}
      ORDER BY sync_enabled DESC, updated_at DESC, repo_path ASC
    `,
    args,
  })
  return result.rows.map(row => asScope(row as Row))
}

export async function upsertProjectRepoScope(input: ProjectRepoScopeUpsertInput) {
  const timestamp = nowIso()
  const id = input.id ?? stableId('prscope', [input.user_id, input.project_id, input.provider, input.repo_path])
  const hasSyncEnabled = input.sync_enabled !== null && input.sync_enabled !== undefined
  await getTursoClient().execute({
    sql: `
      INSERT INTO project_repo_scopes (
        id, user_id, project_id, provider, repo_path, display_name, sync_enabled,
        last_scanned_at, last_reconciled_at, settings_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, project_id, provider, repo_path) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, project_repo_scopes.display_name),
        sync_enabled = CASE WHEN ? THEN excluded.sync_enabled ELSE project_repo_scopes.sync_enabled END,
        last_scanned_at = COALESCE(excluded.last_scanned_at, project_repo_scopes.last_scanned_at),
        last_reconciled_at = COALESCE(excluded.last_reconciled_at, project_repo_scopes.last_reconciled_at),
        settings_json = COALESCE(excluded.settings_json, project_repo_scopes.settings_json),
        updated_at = excluded.updated_at
    `,
    args: [
      id,
      input.user_id,
      input.project_id,
      input.provider,
      input.repo_path,
      input.display_name ?? null,
      input.sync_enabled === false ? 0 : 1,
      input.last_scanned_at ?? null,
      input.last_reconciled_at ?? null,
      jsonOrNull(input.settings_json),
      timestamp,
      timestamp,
      hasSyncEnabled ? 1 : 0,
    ],
  })
}

export async function upsertAiHistoryItem(input: AiHistoryUpsertInput) {
  const timestamp = nowIso()
  const indexedAt = input.indexed_at ?? timestamp
  const archived = input.archived === true
  const archivedAt = archived ? (input.archived_at ?? indexedAt) : null
  const id = input.id ?? stableId('aih', [input.user_id, input.provider, input.external_thread_id, input.repo_path])
  await getTursoClient().execute({
    sql: `
      INSERT INTO ai_history_items (
        id, user_id, provider, external_thread_id, repo_path, worktree_path, project_id,
        source_task_id, linked_ai_task_id, title, snippet, status, run_state,
        last_activity_at, indexed_at, started_at, ended_at, work_duration_seconds,
        archived, archived_at, deleted_at, detail_synced_at, detail_message_count,
        metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider, external_thread_id, repo_path) DO UPDATE SET
        worktree_path = COALESCE(excluded.worktree_path, ai_history_items.worktree_path),
        project_id = COALESCE(excluded.project_id, ai_history_items.project_id),
        source_task_id = CASE
          WHEN ? THEN NULL
          ELSE COALESCE(excluded.source_task_id, ai_history_items.source_task_id)
        END,
        linked_ai_task_id = COALESCE(excluded.linked_ai_task_id, ai_history_items.linked_ai_task_id),
        title = excluded.title,
        snippet = excluded.snippet,
        status = excluded.status,
        run_state = excluded.run_state,
        last_activity_at = excluded.last_activity_at,
        indexed_at = excluded.indexed_at,
        started_at = COALESCE(excluded.started_at, ai_history_items.started_at),
        ended_at = COALESCE(excluded.ended_at, ai_history_items.ended_at),
        work_duration_seconds = COALESCE(excluded.work_duration_seconds, ai_history_items.work_duration_seconds),
        archived = excluded.archived,
        archived_at = CASE
          WHEN excluded.archived = 1 THEN COALESCE(excluded.archived_at, ai_history_items.archived_at, excluded.indexed_at)
          ELSE NULL
        END,
        deleted_at = excluded.deleted_at,
        detail_synced_at = COALESCE(excluded.detail_synced_at, ai_history_items.detail_synced_at),
        detail_message_count = COALESCE(excluded.detail_message_count, ai_history_items.detail_message_count),
        metadata_json = COALESCE(excluded.metadata_json, ai_history_items.metadata_json),
        updated_at = excluded.updated_at
    `,
    args: [
      id,
      input.user_id,
      input.provider,
      input.external_thread_id,
      input.repo_path,
      input.worktree_path ?? null,
      input.project_id ?? null,
      input.source_task_id ?? null,
      input.linked_ai_task_id ?? null,
      input.title,
      input.snippet ?? null,
      input.status,
      input.run_state ?? null,
      input.last_activity_at,
      indexedAt,
      input.started_at ?? null,
      input.ended_at ?? null,
      input.work_duration_seconds ?? null,
      archived ? 1 : 0,
      archivedAt,
      input.deleted_at ?? null,
      input.detail_synced_at ?? null,
      input.detail_message_count ?? null,
      jsonOrNull(input.metadata_json),
      timestamp,
      timestamp,
      input.clear_source_task_id ? 1 : 0,
    ],
  })
}

export async function getAiHistoryItemForUser(id: string, userId: string) {
  const result = await getTursoClient().execute({
    sql: 'SELECT * FROM ai_history_items WHERE id = ? AND user_id = ? LIMIT 1',
    args: [id, userId],
  })
  const row = result.rows[0] as Row | undefined
  return row ? asItem(row) : null
}

export async function listAiHistoryItems(options: {
  userId: string
  projectId: string
  repo?: string | null
  repoPaths?: string[]
  placement?: AiHistoryPlacement | 'all'
  status?: AiHistoryStatus | 'all' | null
  cursor?: AiHistoryCursor | null
  limit?: number
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    repo: options.repo,
    repoPaths: options.repoPaths,
    placement: options.placement ?? 'unplaced',
    status: options.status ?? 'all',
  })
  if (options.cursor) {
    where.clauses.push('(indexed_at < ? OR (indexed_at = ? AND id < ?))')
    where.args.push(options.cursor.indexedAt, options.cursor.indexedAt, options.cursor.id)
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const result = await getTursoClient().execute({
    sql: `
      SELECT *
      FROM ai_history_items
      WHERE ${where.clauses.join(' AND ')}
      ORDER BY indexed_at DESC, id DESC
      LIMIT ?
    `,
    args: [...where.args, limit],
  })
  return result.rows.map(row => asItem(row as Row))
}

export async function countAiHistoryBuckets(options: {
  userId: string
  projectId: string
  repo?: string | null
  repoPaths?: string[]
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    repo: options.repo,
    repoPaths: options.repoPaths,
    placement: 'all',
    status: 'all',
  })
  const result = await getTursoClient().execute({
    sql: `
      SELECT
        SUM(CASE WHEN source_task_id IS NULL THEN 1 ELSE 0 END) AS unplaced,
        SUM(CASE WHEN source_task_id IS NOT NULL THEN 1 ELSE 0 END) AS mindmap
      FROM ai_history_items
      WHERE ${where.clauses.join(' AND ')}
    `,
    args: where.args,
  })
  const row = result.rows[0] as Row | undefined
  return {
    unplaced: asNumber(row?.unplaced) ?? 0,
    mindmap: asNumber(row?.mindmap) ?? 0,
  }
}

export async function listAiHistorySnapshot(options: {
  userId: string
  projectId: string
  repo?: string | null
  repoPaths?: string[]
  cursor?: AiHistoryCursor | null
  limit?: number
  includeDeleted?: boolean
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    repo: options.repo,
    repoPaths: options.repoPaths,
    includeArchived: options.includeDeleted === true,
    includeDeleted: options.includeDeleted === true,
    placement: 'all',
    status: 'all',
  })
  if (options.cursor) {
    where.clauses.push('(indexed_at > ? OR (indexed_at = ? AND id > ?))')
    where.args.push(options.cursor.indexedAt, options.cursor.indexedAt, options.cursor.id)
  }
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 500)
  const orderDirection = options.cursor ? 'ASC' : 'DESC'
  const result = await getTursoClient().execute({
    sql: `
      SELECT *
      FROM ai_history_items
      WHERE ${where.clauses.join(' AND ')}
      ORDER BY indexed_at ${orderDirection}, id ${orderDirection}
      LIMIT ?
    `,
    args: [...where.args, limit],
  })
  const items = result.rows.map(row => asItem(row as Row))
  return options.cursor ? items : items.reverse()
}

export async function latestAiHistoryIndex(options: {
  userId: string
  projectId: string
  repo?: string | null
  repoPaths?: string[]
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    repo: options.repo,
    repoPaths: options.repoPaths,
    placement: 'all',
    status: 'all',
  })
  const result = await getTursoClient().execute({
    sql: `
      SELECT MAX(indexed_at) AS indexed_at
      FROM ai_history_items
      WHERE ${where.clauses.join(' AND ')}
    `,
    args: where.args,
  })
  return asString((result.rows[0] as Row | undefined)?.indexed_at)
}
