import { createHash } from 'node:crypto'
import { getTursoClient, jsonOrNull, parseJsonRecord } from './client'
import type {
  AiHistoryDetailActivityMessage,
  AiHistoryDetailHydrateRequestItem,
  AiHistoryDetailHydrateRequestReason,
  AiHistoryDetailMessageKind,
  AiHistoryDetailMessageRole,
  AiHistoryListItem,
  AiHistoryMonitorTarget,
  AiHistoryPlacement,
  AiHistoryScopeFilter,
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

const AI_HISTORY_PLACEHOLDER_TITLE = '新しいチャット'

export const AI_HISTORY_DETAIL_ROLES = new Set<AiHistoryDetailMessageRole>([
  'user',
  'assistant',
  'system',
])

export const AI_HISTORY_DETAIL_KINDS = new Set<AiHistoryDetailMessageKind>([
  'user_prompt',
  'assistant_answer',
  'assistant_question',
  'status',
  'summary',
])

const MAX_AI_HISTORY_DETAIL_BODY_CHARS = 8_000

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

export type TursoAiHistoryDetailMessage = {
  id: string
  user_id: string
  history_item_id: string
  provider: string
  external_thread_id: string
  repo_path: string
  sequence: number
  role: AiHistoryDetailMessageRole
  kind: AiHistoryDetailMessageKind
  body: string
  body_hash: string
  occurred_at: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TursoAiHistoryDetailHydrateRequest = {
  id: string
  user_id: string
  history_item_id: string
  provider: string
  external_thread_id: string
  repo_path: string
  reason: AiHistoryDetailHydrateRequestReason
  requested_by: string
  requested_at: string
  expires_at: string
  fulfilled_at: string | null
  created_at: string
  updated_at: string
  detail_synced_at: string | null
  detail_message_count: number | null
  last_activity_at: string
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

export type AiHistoryDetailMessageUpsertInput = {
  sequence: number
  role: AiHistoryDetailMessageRole
  kind: AiHistoryDetailMessageKind
  body: string
  occurred_at?: string | null
  metadata_json?: Record<string, unknown> | null
}

export type AiHistoryDetailCursor = {
  createdAt?: string | null
  id?: string | null
  sequence?: number | null
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

function asDetailRole(value: unknown): AiHistoryDetailMessageRole {
  const role = asString(value)
  return role && AI_HISTORY_DETAIL_ROLES.has(role as AiHistoryDetailMessageRole)
    ? role as AiHistoryDetailMessageRole
    : 'assistant'
}

function asDetailKind(value: unknown): AiHistoryDetailMessageKind {
  const kind = asString(value)
  return kind && AI_HISTORY_DETAIL_KINDS.has(kind as AiHistoryDetailMessageKind)
    ? kind as AiHistoryDetailMessageKind
    : 'assistant_answer'
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
    title: asString(row.title) ?? AI_HISTORY_PLACEHOLDER_TITLE,
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

function asDetailMessage(row: Row): TursoAiHistoryDetailMessage {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    history_item_id: String(row.history_item_id),
    provider: asString(row.provider) ?? 'codex_app',
    external_thread_id: asString(row.external_thread_id) ?? '',
    repo_path: asString(row.repo_path) ?? '',
    sequence: asNumber(row.sequence) ?? 0,
    role: asDetailRole(row.role),
    kind: asDetailKind(row.kind),
    body: asString(row.body) ?? '',
    body_hash: asString(row.body_hash) ?? '',
    occurred_at: asString(row.occurred_at),
    metadata_json: parseJsonRecord(row.metadata_json),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
  }
}

function asHydrateRequest(row: Row): TursoAiHistoryDetailHydrateRequest {
  const reason = asString(row.reason)
  const hydrateReason: AiHistoryDetailHydrateRequestReason =
    reason === 'detail_cache_unsynced' || reason === 'detail_cache_stale'
      ? reason
      : 'detail_cache_empty'
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    history_item_id: String(row.history_item_id),
    provider: asString(row.provider) ?? 'codex_app',
    external_thread_id: asString(row.external_thread_id) ?? '',
    repo_path: asString(row.repo_path) ?? '',
    reason: hydrateReason,
    requested_by: asString(row.requested_by) ?? 'web',
    requested_at: asString(row.requested_at) ?? nowIso(),
    expires_at: asString(row.expires_at) ?? nowIso(),
    fulfilled_at: asString(row.fulfilled_at),
    created_at: asString(row.created_at) ?? nowIso(),
    updated_at: asString(row.updated_at) ?? nowIso(),
    detail_synced_at: asString(row.detail_synced_at),
    detail_message_count: asNumber(row.detail_message_count),
    last_activity_at: asString(row.last_activity_at) ?? nowIso(),
  }
}

export function hashAiHistoryDetailBody(body: string) {
  return createHash('sha256').update(body).digest('hex')
}

function detailMessageId(input: {
  userId: string
  historyItemId: string
  sequence: number
  bodyHash: string
}) {
  const sequence = String(input.sequence).padStart(8, '0')
  const digest = createHash('sha256')
    .update([input.userId, input.historyItemId, String(input.sequence), input.bodyHash].join('\u001f'))
    .digest('hex')
    .slice(0, 20)
  return `aihd_${sequence}_${digest}`
}

function hydrateRequestId(input: { userId: string; historyItemId: string }) {
  const digest = createHash('sha256')
    .update([input.userId, input.historyItemId].join('\u001f'))
    .digest('hex')
    .slice(0, 32)
  return `aihreq_${digest}`
}

function toActivityRole(role: AiHistoryDetailMessageRole) {
  if (role === 'user') return 'user' as const
  if (role === 'system') return 'status' as const
  return 'codex' as const
}

function toActivityKind(kind: AiHistoryDetailMessageKind) {
  if (kind === 'user_prompt') return 'sent' as const
  if (kind === 'assistant_question') return 'question' as const
  if (kind === 'summary') return 'completed' as const
  if (kind === 'status') return 'progress' as const
  return 'completed' as const
}

function toActivityImportance(kind: AiHistoryDetailMessageKind) {
  return kind === 'assistant_question' || kind === 'summary' ? 'important' as const : 'normal' as const
}

export function toAiHistoryDetailActivityMessage(
  message: TursoAiHistoryDetailMessage,
): AiHistoryDetailActivityMessage {
  const metadata = message.metadata_json ?? {}
  return {
    id: message.id,
    history_item_id: message.history_item_id,
    task_id: message.history_item_id,
    user_id: message.user_id,
    provider: message.provider,
    external_thread_id: message.external_thread_id,
    repo_path: message.repo_path,
    sequence: message.sequence,
    role: toActivityRole(message.role),
    detail_role: message.role,
    kind: toActivityKind(message.kind),
    detail_kind: message.kind,
    body: message.body,
    body_hash: message.body_hash,
    importance: toActivityImportance(message.kind),
    metadata: {
      ...metadata,
      detailRole: message.role,
      detailKind: message.kind,
      detailSequence: message.sequence,
      bodyHash: message.body_hash,
    },
    occurred_at: message.occurred_at,
    created_at: message.occurred_at ?? message.created_at,
  }
}

export function isAiHistoryDetailHydrateRequired(
  item: Pick<TursoAiHistoryItem, 'linked_ai_task_id' | 'last_activity_at' | 'detail_synced_at' | 'detail_message_count'>,
  actualMessageCount?: number | null,
) {
  if (item.linked_ai_task_id) return false
  const messageCount = actualMessageCount ?? item.detail_message_count ?? 0
  if (messageCount <= 0) return true
  const detailSyncedMs = Date.parse(item.detail_synced_at ?? '')
  if (!Number.isFinite(detailSyncedMs)) return true
  const lastActivityMs = Date.parse(item.last_activity_at ?? '')
  if (!Number.isFinite(lastActivityMs)) return false
  return detailSyncedMs + 1000 < lastActivityMs
}

export function aiHistoryDetailHydrateReason(
  item: Pick<TursoAiHistoryItem, 'linked_ai_task_id' | 'last_activity_at' | 'detail_synced_at' | 'detail_message_count'>,
  actualMessageCount?: number | null,
) {
  if (item.linked_ai_task_id) return null
  const messageCount = actualMessageCount ?? item.detail_message_count ?? 0
  if (messageCount <= 0) return 'detail_cache_empty'
  const detailSyncedMs = Date.parse(item.detail_synced_at ?? '')
  if (!Number.isFinite(detailSyncedMs)) return 'detail_cache_unsynced'
  const lastActivityMs = Date.parse(item.last_activity_at ?? '')
  if (Number.isFinite(lastActivityMs) && detailSyncedMs + 1000 < lastActivityMs) {
    return 'detail_cache_stale'
  }
  return null
}

export function toAiHistoryDetailHydrateRequestItem(
  request: TursoAiHistoryDetailHydrateRequest,
): AiHistoryDetailHydrateRequestItem {
  return {
    id: request.id,
    historyItemId: request.history_item_id,
    provider: request.provider,
    externalThreadId: request.external_thread_id,
    repoPath: request.repo_path,
    reason: request.reason,
    requestedAt: request.requested_at,
    expiresAt: request.expires_at,
    detailSyncedAt: request.detail_synced_at,
    detailMessageCount: request.detail_message_count,
    lastActivityAt: request.last_activity_at,
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

export function toAiHistoryMonitorTarget(item: TursoAiHistoryItem): AiHistoryMonitorTarget {
  return {
    historyItemId: item.id,
    id: item.id,
    provider: item.provider,
    externalThreadId: item.external_thread_id,
    repoPath: item.repo_path,
    projectId: item.project_id,
    status: item.status,
    runState: item.run_state,
    lastActivityAt: item.last_activity_at,
    indexedAt: item.indexed_at,
  }
}

function scopedHistoryWhere(options: {
  userId: string
  projectId: string
  scope?: AiHistoryScopeFilter
  provider?: string | null
  repo?: string | null
  repoPaths?: string[]
  excludeExternalThreadIds?: string[]
  includeArchived?: boolean
  includeDeleted?: boolean
  placement?: AiHistoryPlacement | 'all'
  status?: AiHistoryStatus | 'all' | null
}) {
  const clauses = ['user_id = ?']
  const args: Array<string | number> = [options.userId]
  const scopeRepoPaths = uniqueStrings(options.repoPaths ?? [])
  const excludedThreadIds = uniqueStrings(options.excludeExternalThreadIds ?? []).slice(0, 500)

  if (options.provider) {
    clauses.push('provider = ?')
    args.push(options.provider)
  }

  if (options.repo && options.repo !== 'all') {
    clauses.push('repo_path = ?')
    args.push(options.repo)
  }

  if (excludedThreadIds.length > 0) {
    clauses.push(`(external_thread_id IS NULL OR external_thread_id NOT IN (${placeholders(excludedThreadIds)}))`)
    args.push(...excludedThreadIds)
  }

  if (options.scope !== 'global') {
    if (scopeRepoPaths.length > 0) {
      clauses.push(`repo_path IN (${placeholders(scopeRepoPaths)})`)
      args.push(...scopeRepoPaths)
    } else {
      clauses.push('0 = 1')
    }
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
  const titleSource = typeof input.metadata_json?.title_source === 'string' ? input.metadata_json.title_source : null
  const preserveExistingTitle = titleSource === 'prompt_fallback' || titleSource === 'placeholder'
  const result = await getTursoClient().execute({
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
        title = CASE
          WHEN (excluded.title = ? OR ?) AND ai_history_items.title IS NOT NULL AND trim(ai_history_items.title) <> '' AND ai_history_items.title <> ?
            THEN ai_history_items.title
          ELSE excluded.title
        END,
        snippet = excluded.snippet,
        status = excluded.status,
        run_state = excluded.run_state,
        last_activity_at = excluded.last_activity_at,
        indexed_at = excluded.indexed_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        work_duration_seconds = excluded.work_duration_seconds,
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
      RETURNING id
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
      AI_HISTORY_PLACEHOLDER_TITLE,
      preserveExistingTitle ? 1 : 0,
      AI_HISTORY_PLACEHOLDER_TITLE,
    ],
  })
  return asString((result.rows[0] as Row | undefined)?.id) ?? id
}

export async function getAiHistoryItemForUser(id: string, userId: string) {
  const result = await getTursoClient().execute({
    sql: 'SELECT * FROM ai_history_items WHERE id = ? AND user_id = ? LIMIT 1',
    args: [id, userId],
  })
  const row = result.rows[0] as Row | undefined
  return row ? asItem(row) : null
}

export async function setAiHistorySourceTaskIdForUser(input: {
  id: string
  userId: string
  sourceTaskId: string | null
  projectId?: string | null
}) {
  const timestamp = nowIso()
  const result = await getTursoClient().execute({
    sql: `
      UPDATE ai_history_items
      SET source_task_id = ?,
          project_id = COALESCE(?, project_id),
          updated_at = ?
      WHERE id = ? AND user_id = ?
      RETURNING *
    `,
    args: [
      input.sourceTaskId,
      input.projectId ?? null,
      timestamp,
      input.id,
      input.userId,
    ],
  })
  const row = result.rows[0] as Row | undefined
  return row ? asItem(row) : null
}

function normalizeDetailBody(body: string) {
  return body.replace(/\r\n/g, '\n').trim().slice(0, MAX_AI_HISTORY_DETAIL_BODY_CHARS)
}

export async function listAiHistoryDetailMessages(options: {
  userId: string
  historyItemId: string
  limit?: number
  before?: AiHistoryDetailCursor | null
}) {
  const clauses = ['user_id = ?', 'history_item_id = ?']
  const args: Array<string | number> = [options.userId, options.historyItemId]
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)

  if (options.before?.sequence !== null && options.before?.sequence !== undefined) {
    clauses.push('(sequence < ? OR (sequence = ? AND id < ?))')
    args.push(options.before.sequence, options.before.sequence, options.before.id ?? '')
  } else if (options.before?.createdAt) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    args.push(options.before.createdAt, options.before.createdAt, options.before.id ?? '')
  }

  const result = await getTursoClient().execute({
    sql: `
      SELECT *
      FROM ai_history_detail_messages
      WHERE ${clauses.join(' AND ')}
      ORDER BY sequence DESC, id DESC
      LIMIT ?
    `,
    args: [...args, limit],
  })
  return result.rows.map(row => asDetailMessage(row as Row)).reverse()
}

export async function countAiHistoryDetailMessages(options: {
  userId: string
  historyItemId: string
}) {
  const result = await getTursoClient().execute({
    sql: `
      SELECT COUNT(*) AS count
      FROM ai_history_detail_messages
      WHERE user_id = ? AND history_item_id = ?
    `,
    args: [options.userId, options.historyItemId],
  })
  return asNumber((result.rows[0] as Row | undefined)?.count) ?? 0
}

export async function upsertAiHistoryDetailHydrateRequest(options: {
  userId: string
  item: Pick<TursoAiHistoryItem, 'id' | 'provider' | 'external_thread_id' | 'repo_path'>
  reason: AiHistoryDetailHydrateRequestReason
  requestedBy?: 'web' | 'agent' | 'system'
  ttlSeconds?: number
}) {
  const timestamp = nowIso()
  const ttlSeconds = Math.min(Math.max(options.ttlSeconds ?? 120, 30), 10 * 60)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  const id = hydrateRequestId({ userId: options.userId, historyItemId: options.item.id })
  await getTursoClient().execute({
    sql: `
      INSERT INTO ai_history_detail_hydrate_requests (
        id, user_id, history_item_id, provider, external_thread_id, repo_path,
        reason, requested_by, requested_at, expires_at, fulfilled_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(user_id, history_item_id) DO UPDATE SET
        provider = excluded.provider,
        external_thread_id = excluded.external_thread_id,
        repo_path = excluded.repo_path,
        reason = excluded.reason,
        requested_by = excluded.requested_by,
        requested_at = excluded.requested_at,
        expires_at = excluded.expires_at,
        fulfilled_at = NULL,
        updated_at = excluded.updated_at
      WHERE ai_history_detail_hydrate_requests.expires_at < ?
        OR ai_history_detail_hydrate_requests.fulfilled_at IS NOT NULL
    `,
    args: [
      id,
      options.userId,
      options.item.id,
      options.item.provider,
      options.item.external_thread_id,
      options.item.repo_path,
      options.reason,
      options.requestedBy ?? 'web',
      timestamp,
      expiresAt,
      timestamp,
      timestamp,
      timestamp,
    ],
  })
  return {
    id,
    requestedAt: timestamp,
    expiresAt,
  }
}

export async function listAiHistoryDetailHydrateRequests(options: {
  userId: string
  limit?: number
  now?: string
}) {
  const now = options.now ?? nowIso()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const result = await getTursoClient().execute({
    sql: `
      SELECT
        hydrate_request.id,
        hydrate_request.user_id,
        hydrate_request.history_item_id,
        hydrate_request.provider,
        hydrate_request.external_thread_id,
        hydrate_request.repo_path,
        hydrate_request.reason,
        hydrate_request.requested_by,
        hydrate_request.requested_at,
        hydrate_request.expires_at,
        hydrate_request.fulfilled_at,
        hydrate_request.created_at,
        hydrate_request.updated_at,
        item.detail_synced_at,
        item.detail_message_count,
        item.last_activity_at
      FROM ai_history_detail_hydrate_requests hydrate_request
      INNER JOIN ai_history_items item
        ON item.id = hydrate_request.history_item_id
        AND item.user_id = hydrate_request.user_id
      WHERE hydrate_request.user_id = ?
        AND hydrate_request.fulfilled_at IS NULL
        AND hydrate_request.expires_at >= ?
        AND item.linked_ai_task_id IS NULL
        AND item.archived = 0
        AND item.deleted_at IS NULL
      ORDER BY hydrate_request.requested_at DESC, hydrate_request.id DESC
      LIMIT ?
    `,
    args: [options.userId, now, limit],
  })
  return result.rows.map(row => asHydrateRequest(row as Row))
}

export async function markAiHistoryDetailHydrateRequestFulfilled(options: {
  userId: string
  historyItemId: string
  fulfilledAt?: string
}) {
  const fulfilledAt = options.fulfilledAt ?? nowIso()
  await getTursoClient().execute({
    sql: `
      UPDATE ai_history_detail_hydrate_requests
      SET fulfilled_at = ?, updated_at = ?
      WHERE user_id = ? AND history_item_id = ? AND fulfilled_at IS NULL
    `,
    args: [fulfilledAt, fulfilledAt, options.userId, options.historyItemId],
  })
}

async function refreshAiHistoryDetailSummary(options: {
  userId: string
  historyItemId: string
  detailSyncedAt: string
}) {
  const updatedAt = nowIso()
  await getTursoClient().execute({
    sql: `
      UPDATE ai_history_items
      SET
        detail_synced_at = CASE
          WHEN detail_synced_at IS NULL OR detail_synced_at < ? THEN ?
          ELSE detail_synced_at
        END,
        detail_message_count = (
          SELECT COUNT(*)
          FROM ai_history_detail_messages
          WHERE user_id = ? AND history_item_id = ?
        ),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
    args: [
      options.detailSyncedAt,
      options.detailSyncedAt,
      options.userId,
      options.historyItemId,
      updatedAt,
      options.historyItemId,
      options.userId,
    ],
  })
}

export async function upsertAiHistoryDetailMessages(options: {
  userId: string
  historyItemId: string
  provider: string
  externalThreadId: string
  repoPath: string
  messages: AiHistoryDetailMessageUpsertInput[]
  detailSyncedAt?: string | null
}) {
  const timestamp = nowIso()
  let upserted = 0

  for (const message of options.messages) {
    const body = normalizeDetailBody(message.body)
    if (!body) continue
    const bodyHash = hashAiHistoryDetailBody(body)
    const id = detailMessageId({
      userId: options.userId,
      historyItemId: options.historyItemId,
      sequence: message.sequence,
      bodyHash,
    })
    const occurredAt = message.occurred_at ?? null
    await getTursoClient().execute({
      sql: `
        INSERT INTO ai_history_detail_messages (
          id, user_id, history_item_id, provider, external_thread_id, repo_path,
          sequence, role, kind, body, body_hash, occurred_at, metadata_json,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, history_item_id, sequence, body_hash) DO UPDATE SET
          role = excluded.role,
          kind = excluded.kind,
          body = excluded.body,
          occurred_at = COALESCE(excluded.occurred_at, ai_history_detail_messages.occurred_at),
          metadata_json = COALESCE(excluded.metadata_json, ai_history_detail_messages.metadata_json),
          updated_at = excluded.updated_at
      `,
      args: [
        id,
        options.userId,
        options.historyItemId,
        options.provider,
        options.externalThreadId,
        options.repoPath,
        message.sequence,
        message.role,
        message.kind,
        body,
        bodyHash,
        occurredAt,
        jsonOrNull(message.metadata_json),
        occurredAt ?? timestamp,
        timestamp,
      ],
    })
    upserted += 1
  }

  const detailSyncedAt = options.detailSyncedAt ?? timestamp
  await refreshAiHistoryDetailSummary({
    userId: options.userId,
    historyItemId: options.historyItemId,
    detailSyncedAt,
  })
  if (upserted > 0) {
    await markAiHistoryDetailHydrateRequestFulfilled({
      userId: options.userId,
      historyItemId: options.historyItemId,
      fulfilledAt: detailSyncedAt,
    })
  }

  return {
    upserted,
    detailSyncedAt,
    messageCount: await countAiHistoryDetailMessages({
      userId: options.userId,
      historyItemId: options.historyItemId,
    }),
  }
}

export async function listAiHistoryItems(options: {
  userId: string
  projectId: string
  scope?: AiHistoryScopeFilter
  provider?: string | null
  repo?: string | null
  repoPaths?: string[]
  excludeExternalThreadIds?: string[]
  placement?: AiHistoryPlacement | 'all'
  status?: AiHistoryStatus | 'all' | null
  cursor?: AiHistoryCursor | null
  limit?: number
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    scope: options.scope,
    provider: options.provider,
    repo: options.repo,
    repoPaths: options.repoPaths,
    excludeExternalThreadIds: options.excludeExternalThreadIds,
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
  scope?: AiHistoryScopeFilter
  provider?: string | null
  repo?: string | null
  repoPaths?: string[]
  excludeExternalThreadIds?: string[]
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    scope: options.scope,
    provider: options.provider,
    repo: options.repo,
    repoPaths: options.repoPaths,
    excludeExternalThreadIds: options.excludeExternalThreadIds,
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
  scope?: AiHistoryScopeFilter
  provider?: string | null
  repo?: string | null
  repoPaths?: string[]
  cursor?: AiHistoryCursor | null
  limit?: number
  includeDeleted?: boolean
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    scope: options.scope,
    provider: options.provider,
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

export async function listActiveAiHistoryMonitorTargets(options: {
  userId: string
  provider?: string | null
  limit?: number
}) {
  const provider = asString(options.provider) ?? 'codex_app'
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)
  const result = await getTursoClient().execute({
    sql: `
      SELECT *
      FROM ai_history_items
      WHERE user_id = ?
        AND provider = ?
        AND archived = 0
        AND deleted_at IS NULL
        AND status IN ('running', 'awaiting_approval', 'needs_input')
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'awaiting_approval' THEN 1
          WHEN 'needs_input' THEN 1
          ELSE 2
        END ASC,
        indexed_at DESC,
        id DESC
      LIMIT ?
    `,
    args: [options.userId, provider, limit],
  })
  return result.rows.map(row => asItem(row as Row))
}

export async function latestAiHistoryIndex(options: {
  userId: string
  projectId: string
  scope?: AiHistoryScopeFilter
  provider?: string | null
  repo?: string | null
  repoPaths?: string[]
}) {
  const where = scopedHistoryWhere({
    userId: options.userId,
    projectId: options.projectId,
    scope: options.scope,
    provider: options.provider,
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
