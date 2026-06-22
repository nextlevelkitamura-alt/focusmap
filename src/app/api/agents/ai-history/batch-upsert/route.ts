import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  AI_HISTORY_STATUSES,
  upsertAiHistoryItem,
  upsertProjectRepoScope,
  type AiHistoryUpsertInput,
} from '@/lib/turso/ai-history'
import type {
  AiHistoryBatchUpsertResponseItem,
  AiHistoryBatchUpsertItem,
  AiHistoryBatchUpsertRequest,
  AiHistoryBatchUpsertScope,
  AiHistoryStatus,
} from '@/types/ai-history'

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

const VALID_EXECUTORS = ['codex_app', 'codex'] as const
const MAX_ITEMS = 200
const MAX_SCOPES = 100
const MAX_METADATA_JSON_CHARS = 8_000
const AI_HISTORY_PLACEHOLDER_TITLE = '新しいチャット'
const BLOCKED_METADATA_KEYS = new Set([
  'body',
  'full_body',
  'messages',
  'full_messages',
  'full_transcript',
  'thread_full_history',
  'raw_thread_history',
  'rollout',
  'rollout_json',
  'raw_rollout',
  'live_log',
  'output',
  'command_output',
  'raw_output',
  'screenshot',
  'screenshot_body',
  'image_body',
  'base64',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function field(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  }
  return undefined
}

function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function normalizeRepoPath(value: unknown) {
  const raw = compactString(value, 1000)
  if (!raw) return null
  const normalized = raw.replace(/\/+$/u, '')
  return normalized || raw
}

function isoString(value: unknown) {
  const raw = compactString(value, 100)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return null
}

function integerValue(value: unknown, max = 365 * 24 * 60 * 60) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed)) return null
  return Math.min(Math.max(Math.floor(parsed), 0), max)
}

function sanitizeStatus(value: unknown) {
  const raw = compactString(value, 80)
  if (!raw) return 'idle' as AiHistoryStatus
  return AI_HISTORY_STATUSES.has(raw as AiHistoryStatus) ? raw as AiHistoryStatus : null
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return null
  if (typeof value === 'string') return value.slice(0, 1000)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMetadataValue(item, depth + 1))
  if (!isRecord(value)) return null
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.trim()
    if (!normalizedKey || BLOCKED_METADATA_KEYS.has(normalizedKey.toLowerCase())) continue
    output[normalizedKey.slice(0, 80)] = sanitizeMetadataValue(child, depth + 1)
  }
  return output
}

function sanitizeMetadata(value: unknown) {
  const sanitized = sanitizeMetadataValue(value)
  if (!isRecord(sanitized)) return null
  const encoded = JSON.stringify(sanitized)
  if (encoded.length <= MAX_METADATA_JSON_CHARS) return sanitized
  return {
    truncated: true,
    retained_keys: Object.keys(sanitized).slice(0, 40),
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
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
    return { ok: false as const, status: 403, error: 'Runner is not allowed to sync AI history' }
  }
  return { ok: true as const }
}

async function allowedProjectIds(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  projectIds: string[],
) {
  const uniqueIds = uniqueStrings(projectIds)
  if (uniqueIds.length === 0) return new Set<string>()
  let query = supabase
    .from('projects')
    .select('id')
    .eq('user_id', token.user_id)
    .in('id', uniqueIds)
  if (token.space_id) query = query.eq('space_id', token.space_id)
  const { data, error } = await query
  if (error) throw error
  return new Set((data ?? []).map(row => String(row.id)))
}

async function loadAiTaskLinks(
  supabase: SupabaseServiceClient,
  userId: string,
  threadIds: Array<string | null | undefined>,
  linkedAiTaskIds: Array<string | null | undefined>,
) {
  const byThread = new Map<string, Record<string, unknown>>()
  const byId = new Map<string, Record<string, unknown>>()
  const uniqueThreadIds = uniqueStrings(threadIds).slice(0, MAX_ITEMS)
  if (uniqueThreadIds.length > 0) {
    const { data, error } = await supabase
      .from('ai_tasks')
      .select('id, source_task_id, codex_thread_id, cwd, created_at')
      .eq('user_id', userId)
      .in('codex_thread_id', uniqueThreadIds)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS * 2)
    if (error) throw error
    for (const row of data ?? []) {
      const threadId = compactString((row as Record<string, unknown>).codex_thread_id, 200)
      const id = compactString((row as Record<string, unknown>).id, 120)
      if (threadId && !byThread.has(threadId)) byThread.set(threadId, row as Record<string, unknown>)
      if (id) byId.set(id, row as Record<string, unknown>)
    }
  }

  const missingLinkedIds = uniqueStrings(linkedAiTaskIds).filter(id => !byId.has(id)).slice(0, MAX_ITEMS)
  if (missingLinkedIds.length > 0) {
    const { data, error } = await supabase
      .from('ai_tasks')
      .select('id, source_task_id, codex_thread_id, cwd, created_at')
      .eq('user_id', userId)
      .in('id', missingLinkedIds)
      .limit(MAX_ITEMS)
    if (error) throw error
    for (const row of data ?? []) {
      const id = compactString((row as Record<string, unknown>).id, 120)
      if (id) byId.set(id, row as Record<string, unknown>)
    }
  }

  return { byThread, byId }
}

async function loadSourceTasks(
  supabase: SupabaseServiceClient,
  userId: string,
  sourceTaskIds: string[],
) {
  const uniqueIds = uniqueStrings(sourceTaskIds).slice(0, MAX_ITEMS * 2)
  const byId = new Map<string, Record<string, unknown>>()
  if (uniqueIds.length === 0) return byId
  const { data, error } = await supabase
    .from('tasks')
    .select('id, project_id, source, deleted_at')
    .eq('user_id', userId)
    .in('id', uniqueIds)
    .limit(MAX_ITEMS * 2)
  if (error) throw error
  for (const row of data ?? []) {
    const id = compactString((row as Record<string, unknown>).id, 120)
    if (id) byId.set(id, row as Record<string, unknown>)
  }
  return byId
}

function usableSourceTaskId(sourceTaskId: string | null, sourceTasks: Map<string, Record<string, unknown>>) {
  if (!sourceTaskId) return null
  const sourceTask = sourceTasks.get(sourceTaskId)
  if (!sourceTask) return null
  if (sourceTask.deleted_at != null) return null
  const source = compactString(sourceTask.source, 80)
  if (source === 'codex_app_thread' || source === 'codex_inbox') return null
  return sourceTaskId
}

function projectIdFor(
  preferredProjectId: string | null,
  allowedProjects: Set<string>,
  sourceTaskId: string | null,
  sourceTasks: Map<string, Record<string, unknown>>,
) {
  if (preferredProjectId && allowedProjects.has(preferredProjectId)) return preferredProjectId
  const sourceProjectId = sourceTaskId ? compactString(sourceTasks.get(sourceTaskId)?.project_id, 120) : null
  if (sourceProjectId && (allowedProjects.size === 0 || allowedProjects.has(sourceProjectId))) return sourceProjectId
  return null
}

function normalizedScope(
  scope: AiHistoryBatchUpsertScope,
  defaults: { provider: string },
  allowedProjects: Set<string>,
) {
  const record = scope as Record<string, unknown>
  const projectId = compactString(field(record, 'projectId', 'project_id'), 120)
  const repoPath = normalizeRepoPath(field(record, 'repoPath', 'repo_path'))
  if (!projectId || !repoPath || !allowedProjects.has(projectId)) return null
  const provider = compactString(field(record, 'provider'), 60) ?? defaults.provider
  const syncEnabled = booleanValue(field(record, 'syncEnabled', 'sync_enabled'))
  return {
    project_id: projectId,
    provider,
    repo_path: repoPath,
    display_name: compactString(field(record, 'displayName', 'display_name'), 200),
    sync_enabled: syncEnabled,
    last_scanned_at: isoString(field(record, 'lastScannedAt', 'last_scanned_at')),
    last_reconciled_at: isoString(field(record, 'lastReconciledAt', 'last_reconciled_at')),
    settings_json: sanitizeMetadata(field(record, 'settings', 'settingsJson', 'settings_json')),
  }
}

function normalizedItem(
  item: AiHistoryBatchUpsertItem,
  defaults: { provider: string; projectId: string | null; repoPath: string | null },
  links: Awaited<ReturnType<typeof loadAiTaskLinks>>,
  sourceTasks: Map<string, Record<string, unknown>>,
  allowedProjects: Set<string>,
) {
  const record = item as Record<string, unknown>
  const provider = compactString(field(record, 'provider'), 60) ?? defaults.provider
  const externalThreadId = compactString(field(record, 'externalThreadId', 'external_thread_id'), 200)
  const repoPath = normalizeRepoPath(field(record, 'repoPath', 'repo_path')) ?? defaults.repoPath
  if (!externalThreadId) return { error: 'external_thread_id is required' }
  if (!repoPath) return { error: `repo_path is required for ${externalThreadId}` }

  const status = sanitizeStatus(field(record, 'status'))
  if (!status) return { error: `invalid status for ${externalThreadId}` }

  const inputLinkedAiTaskId = compactString(field(record, 'linkedAiTaskId', 'linked_ai_task_id'), 120)
  const linkedById = inputLinkedAiTaskId ? links.byId.get(inputLinkedAiTaskId) : null
  const linkedByThread = links.byThread.get(externalThreadId) ?? null
  const linkedAiTask = linkedById ?? linkedByThread
  const linkedAiTaskId = compactString(linkedAiTask?.id, 120) ?? null
  const inputSourceTaskId = compactString(field(record, 'sourceTaskId', 'source_task_id'), 120)
  const linkedSourceTaskId = compactString(linkedAiTask?.source_task_id, 120)
  const rawSourceTaskId = inputSourceTaskId ?? linkedSourceTaskId
  const sourceTaskId = usableSourceTaskId(rawSourceTaskId, sourceTasks)
  const preferredProjectId = compactString(field(record, 'projectId', 'project_id'), 120) ?? defaults.projectId
  const projectId = projectIdFor(preferredProjectId, allowedProjects, rawSourceTaskId, sourceTasks)
  const title = compactString(field(record, 'title'), 300) ?? AI_HISTORY_PLACEHOLDER_TITLE
  const lastActivityAt = isoString(field(record, 'lastActivityAt', 'last_activity_at')) ?? new Date().toISOString()
  const archived = booleanValue(field(record, 'archived')) ?? false
  const metadata = sanitizeMetadata(field(record, 'metadata', 'metadataJson', 'metadata_json'))

  return {
    item: {
      user_id: '',
      provider,
      external_thread_id: externalThreadId,
      repo_path: repoPath,
      worktree_path: normalizeRepoPath(field(record, 'worktreePath', 'worktree_path')),
      project_id: projectId,
      source_task_id: sourceTaskId,
      clear_source_task_id: Boolean(rawSourceTaskId && !sourceTaskId),
      linked_ai_task_id: linkedAiTaskId,
      title,
      snippet: compactString(field(record, 'snippet'), 500),
      status,
      run_state: compactString(field(record, 'runState', 'run_state'), 120),
      last_activity_at: lastActivityAt,
      started_at: isoString(field(record, 'startedAt', 'started_at')),
      ended_at: isoString(field(record, 'endedAt', 'ended_at')),
      work_duration_seconds: integerValue(field(record, 'workDurationSeconds', 'work_duration_seconds')),
      archived,
      archived_at: isoString(field(record, 'archivedAt', 'archived_at')),
      deleted_at: isoString(field(record, 'deletedAt', 'deleted_at')),
      detail_synced_at: isoString(field(record, 'detailSyncedAt', 'detail_synced_at')),
      detail_message_count: integerValue(field(record, 'detailMessageCount', 'detail_message_count'), 100_000),
      metadata_json: metadata,
    } satisfies Omit<AiHistoryUpsertInput, 'user_id'> & { user_id: '' },
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({})) as AiHistoryBatchUpsertRequest
    if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const runnerId = compactString(body.runner_id, 120)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    const runnerCheck = await assertRunnerCanSync(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    if (!isTursoConfigured()) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }

    const defaults = {
      provider: compactString(body.provider, 60) ?? 'codex_app',
      projectId: compactString(body.project_id, 120),
      repoPath: normalizeRepoPath(body.repo_path),
    }
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
    const rawScopes = Array.isArray(body.scopes) ? body.scopes.slice(0, MAX_SCOPES) : []

    const projectIds = uniqueStrings([
      defaults.projectId,
      ...rawScopes.map(scope => compactString(field(scope as Record<string, unknown>, 'projectId', 'project_id'), 120)),
      ...rawItems.map(item => compactString(field(item as Record<string, unknown>, 'projectId', 'project_id'), 120)),
    ])
    const allowedProjects = await allowedProjectIds(supabase, token, projectIds)
    const threadIds = rawItems.map(item => compactString(field(item as Record<string, unknown>, 'externalThreadId', 'external_thread_id'), 200))
    const linkedAiTaskIds = rawItems.map(item => compactString(field(item as Record<string, unknown>, 'linkedAiTaskId', 'linked_ai_task_id'), 120))
    const links = await loadAiTaskLinks(supabase, token.user_id, threadIds, linkedAiTaskIds)
    const sourceTaskIds = uniqueStrings([
      ...rawItems.map(item => compactString(field(item as Record<string, unknown>, 'sourceTaskId', 'source_task_id'), 120)),
      ...Array.from(links.byThread.values()).map(row => compactString(row.source_task_id, 120)),
      ...Array.from(links.byId.values()).map(row => compactString(row.source_task_id, 120)),
    ])
    const sourceTasks = await loadSourceTasks(supabase, token.user_id, sourceTaskIds)

    let scopesUpserted = 0
    for (const rawScope of rawScopes) {
      const scope = normalizedScope(rawScope, { provider: defaults.provider }, allowedProjects)
      if (!scope) continue
      await upsertProjectRepoScope({
        user_id: token.user_id,
        project_id: scope.project_id,
        provider: scope.provider,
        repo_path: scope.repo_path,
        display_name: scope.display_name,
        sync_enabled: scope.sync_enabled,
        last_scanned_at: scope.last_scanned_at,
        last_reconciled_at: scope.last_reconciled_at,
        settings_json: scope.settings_json,
      })
      scopesUpserted += 1
    }

    const errors: Array<{ index: number; error: string }> = []
    const responseItems: AiHistoryBatchUpsertResponseItem[] = []
    let upserted = 0
    const indexedAt = new Date().toISOString()
    for (let index = 0; index < rawItems.length; index += 1) {
      const normalized = normalizedItem(rawItems[index]!, defaults, links, sourceTasks, allowedProjects)
      if ('error' in normalized) {
        errors.push({ index, error: normalized.error })
        continue
      }
      const historyItemId = await upsertAiHistoryItem({
        ...normalized.item,
        user_id: token.user_id,
        indexed_at: indexedAt,
      })
      responseItems.push({
        index,
        historyItemId,
        id: historyItemId,
        provider: normalized.item.provider,
        externalThreadId: normalized.item.external_thread_id,
        repoPath: normalized.item.repo_path,
        projectId: normalized.item.project_id,
        sourceTaskId: normalized.item.source_task_id,
        linkedAiTaskId: normalized.item.linked_ai_task_id,
      })
      upserted += 1

      if (normalized.item.project_id) {
        await upsertProjectRepoScope({
          user_id: token.user_id,
          project_id: normalized.item.project_id,
          provider: normalized.item.provider,
          repo_path: normalized.item.repo_path,
          sync_enabled: null,
          last_reconciled_at: indexedAt,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      upserted,
      skipped: rawItems.length - upserted,
      errors,
      items: responseItems,
      scopesUpserted,
      indexedAt,
      policy: {
        metadataOnly: true,
        rawBodiesAccepted: false,
        cursor: 'indexed_at|id',
        idField: 'historyItemId',
        legacyCodexInboxSource: 'linked_ai_task_kept_source_task_cleared',
      },
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[agents/ai-history/batch-upsert]', error)
    const message = error instanceof Error ? error.message : 'AI history batch upsert failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json({ error: message }, { status: authFailure ? 401 : 500 })
  }
}
