import { NextRequest, NextResponse } from 'next/server'
import { formatBillingCycle } from '@/lib/format'
import { getTursoClient, isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  countAiHistoryBuckets,
  encodeAiHistoryCursor,
  latestAiHistoryIndex,
  listAiHistoryItems,
  parseAiHistoryCursor,
  toAiHistoryListItem,
} from '@/lib/turso/ai-history'
import {
  AI_HISTORY_ARCHIVE_REQUEST_REASON,
  authenticateAiHistoryRequest,
  buildAiHistorySyncState,
  compactString,
  isPendingAiHistoryArchiveRequest,
  listPendingAiHistoryArchiveThreadIds,
  loadAiHistoryProjectContext,
  parseLimit,
  parsePlacement,
  parseStatus,
  unauthorized,
} from './_shared'
import type { AiHistoryListResponse, AiHistoryProvider, AiHistoryScopeFilter } from '@/types/ai-history'

const ARCHIVE_RECONCILE_WINDOW_MS = 60_000
const ARCHIVE_RECONCILE_STALE_MS = 2 * 60_000
const archiveReconcileLastRunByUser = new Map<string, number>()

function emptyResponse(input: {
  selectedRepo: 'all' | string
  selectedScope: AiHistoryScopeFilter
  selectedProvider: AiHistoryProvider
  limit: number
  cursor: string | null
  sync?: AiHistoryListResponse['sync']
}): AiHistoryListResponse {
  return {
    items: [],
    counts: { unplaced: 0, mindmap: 0 },
    nextCursor: null,
    sync: input.sync ?? {
      featureEnabled: false,
      aiOnline: false,
      agentConnected: false,
      selectedRepo: input.selectedRepo,
      selectedScope: input.selectedScope,
      selectedProvider: input.selectedProvider,
      providerOptions: [
        { provider: 'codex_app', label: 'Codex', enabled: true, agentSeen: false },
      ],
      repoOptions: [],
      lastIndexedAt: null,
      lastReconciledAt: null,
      nextReconcileAt: null,
    },
    page: {
      limit: input.limit,
      cursor: input.cursor,
    },
  }
}

function archiveResult(input: {
  historyItemId: string
  threadId: string
  repoPath: string
  title: string
  nowIso: string
}) {
  return {
    executor: 'codex_app',
    steps: [],
    output: '',
    message: 'Mac agentへCodex threadアーカイブを依頼しました。',
    codex_thread_id: input.threadId,
    codex_thread_url: `codex://threads/${input.threadId}`,
    codex_run_state: 'awaiting_approval',
    codex_review_reason: 'completed',
    codex_archive_request_state: 'pending',
    codex_archive_requested_at: input.nowIso,
    codex_archive_request_reason: AI_HISTORY_ARCHIVE_REQUEST_REASON,
    codex_archive_request_cancelled_at: null,
    codex_archive_completed_at: null,
    codex_archive_target: 'ai_history_item_reconcile',
    codex_history_item_id: input.historyItemId,
    ai_history_item_id: input.historyItemId,
    ai_history_repo_path: input.repoPath,
    ai_history_title: input.title,
    codex_last_checked_at: input.nowIso,
    last_activity_at: input.nowIso,
    current_step: 'AI履歴の過去アーカイブ差分を同期しました',
    session_health: 'stopped',
    awaiting_approval_at: input.nowIso,
  }
}

function timeMs(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function duplicateAnchorMs(row: Record<string, unknown>) {
  return timeMs(row.started_at) ?? timeMs(row.indexed_at) ?? timeMs(row.created_at) ?? timeMs(row.last_activity_at)
}

function canReconcileArchiveTitle(value: unknown) {
  const title = compactString(value, 500)
  return Boolean(title && title.length >= 12 && title !== '新しいチャット')
}

function shouldRunArchiveReconcile(userId: string, nowMs: number) {
  const previousRunMs = archiveReconcileLastRunByUser.get(userId) ?? 0
  if (nowMs - previousRunMs < 60_000) return false
  archiveReconcileLastRunByUser.set(userId, nowMs)
  return true
}

async function reconcileArchivedAiHistorySiblings(input: {
  supabase: NonNullable<Awaited<ReturnType<typeof authenticateAiHistoryRequest>>>['supabase']
  userId: string
}) {
  const nowMs = Date.now()
  if (!shouldRunArchiveReconcile(input.userId, nowMs)) return

  const result = await getTursoClient().execute({
    sql: `
      SELECT
        source.id AS source_id,
        source.external_thread_id AS source_external_thread_id,
        source.title AS source_title,
        source.repo_path AS source_repo_path,
        source.started_at AS source_started_at,
        source.indexed_at AS source_indexed_at,
        source.created_at AS source_created_at,
        source.last_activity_at AS source_last_activity_at,
        target.id AS target_id,
        target.external_thread_id AS target_external_thread_id,
        target.title AS target_title,
        target.repo_path AS target_repo_path,
        target.status AS target_status,
        target.started_at AS target_started_at,
        target.indexed_at AS target_indexed_at,
        target.created_at AS target_created_at,
        target.last_activity_at AS target_last_activity_at
      FROM ai_history_items source
      JOIN ai_history_items target
        ON target.user_id = source.user_id
       AND target.provider = source.provider
       AND target.repo_path = source.repo_path
       AND target.title = source.title
       AND target.external_thread_id <> source.external_thread_id
      WHERE source.user_id = ?
        AND source.provider = 'codex_app'
        AND (source.archived = 1 OR source.deleted_at IS NOT NULL)
        AND target.archived = 0
        AND target.deleted_at IS NULL
      ORDER BY target.indexed_at DESC
      LIMIT 100
    `,
    args: [input.userId],
  })

  const candidates = result.rows
    .map(row => row as Record<string, unknown>)
    .filter(row => {
      if (!canReconcileArchiveTitle(row.target_title)) return false
      const targetStatus = compactString(row.target_status, 80)
      if (targetStatus === 'running' || targetStatus === 'needs_input') return false
      const sourceAnchor = duplicateAnchorMs({
        started_at: row.source_started_at,
        indexed_at: row.source_indexed_at,
        created_at: row.source_created_at,
        last_activity_at: row.source_last_activity_at,
      })
      const targetAnchor = duplicateAnchorMs({
        started_at: row.target_started_at,
        indexed_at: row.target_indexed_at,
        created_at: row.target_created_at,
        last_activity_at: row.target_last_activity_at,
      })
      if (sourceAnchor === null || targetAnchor === null) return false
      if (Math.abs(targetAnchor - sourceAnchor) > ARCHIVE_RECONCILE_WINDOW_MS) return false
      const targetLastActivity = timeMs(row.target_last_activity_at) ?? targetAnchor
      return nowMs - targetLastActivity >= ARCHIVE_RECONCILE_STALE_MS
    })

  const targetThreadIds = [...new Set(candidates
    .map(row => compactString(row.target_external_thread_id, 200))
    .filter((value): value is string => Boolean(value)))]
  if (targetThreadIds.length === 0) return

  const { data: existingRows, error: existingError } = await input.supabase
    .from('ai_tasks')
    .select('id, codex_thread_id, result')
    .eq('user_id', input.userId)
    .in('codex_thread_id', targetThreadIds)
    .in('executor', ['codex', 'codex_app'])
    .in('status', ['completed', 'awaiting_approval', 'running', 'needs_input'])
    .limit(500)

  if (existingError) {
    console.error('[ai-history archive reconcile existing]', existingError)
    return
  }

  const pendingThreadIds = new Set((existingRows ?? [])
    .filter(row => isPendingAiHistoryArchiveRequest(row as Record<string, unknown>))
    .map(row => compactString((row as Record<string, unknown>).codex_thread_id, 200))
    .filter((value): value is string => Boolean(value)))
  const nowIso = new Date(nowMs).toISOString()
  const insertedThreadIds = new Set<string>()

  for (const row of candidates) {
    const threadId = compactString(row.target_external_thread_id, 200)
    const historyItemId = compactString(row.target_id, 200)
    const title = compactString(row.target_title, 500)
    const repoPath = compactString(row.target_repo_path, 500)
    if (!threadId || !historyItemId || !title || !repoPath) continue
    if (pendingThreadIds.has(threadId) || insertedThreadIds.has(threadId)) continue

    const { error } = await input.supabase
      .from('ai_tasks')
      .insert({
        user_id: input.userId,
        prompt: `Codexチャットをアーカイブ: ${title}`,
        skill_id: null,
        approval_type: 'auto',
        status: 'completed',
        started_at: nowIso,
        completed_at: nowIso,
        cwd: repoPath,
        executor: 'codex_app',
        codex_thread_id: threadId,
        run_visibility: 'private',
        billing_cycle: formatBillingCycle(),
        result: archiveResult({
          historyItemId,
          threadId,
          repoPath,
          title,
          nowIso,
        }),
      })

    if (error) {
      console.error('[ai-history archive reconcile insert]', error)
      continue
    }
    insertedThreadIds.add(threadId)
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get('project_id')?.trim()
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 })

  const repo = searchParams.get('repo')?.trim() || 'all'
  const selectedRepo = repo === 'all' ? 'all' : repo
  const selectedScope: AiHistoryScopeFilter = searchParams.get('scope') === 'global' ? 'global' : 'project'
  const selectedProvider = (searchParams.get('provider')?.trim() || 'codex_app') as AiHistoryProvider
  const placement = parsePlacement(searchParams.get('placement'))
  if (!placement) return NextResponse.json({ error: 'invalid placement' }, { status: 400 })
  const status = parseStatus(searchParams.get('status'))
  if (!status) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  const limit = parseLimit(searchParams.get('limit'), 50, 200)
  const cursorParam = searchParams.get('cursor')
  const cursor = parseAiHistoryCursor(cursorParam)

  const context = await loadAiHistoryProjectContext({
    supabase: auth.supabase,
    userId: auth.user.id,
    projectId,
  })
  if (!context) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!isTursoConfigured()) {
    const sync = await buildAiHistorySyncState({
      userId: auth.user.id,
      selectedRepo,
      selectedScope,
      selectedProvider,
      scopes: context.optionScopes,
      lastIndexedAt: null,
    })
    return NextResponse.json(emptyResponse({ selectedRepo, selectedScope, selectedProvider, limit, cursor: cursorParam, sync }))
  }

  try {
    if (selectedProvider === 'codex_app') {
      await reconcileArchivedAiHistorySiblings({
        supabase: auth.supabase,
        userId: auth.user.id,
      })
    }
    const excludedExternalThreadIds = await listPendingAiHistoryArchiveThreadIds({
      supabase: auth.supabase,
      userId: auth.user.id,
    })
    const [items, counts, lastIndexedAt] = await Promise.all([
      listAiHistoryItems({
        userId: auth.user.id,
        projectId,
        scope: selectedScope,
        provider: selectedProvider,
        repo: selectedRepo,
        repoPaths: selectedScope === 'global' ? [] : context.repoPaths,
        excludeExternalThreadIds: excludedExternalThreadIds,
        placement,
        status,
        cursor,
        limit,
      }),
      countAiHistoryBuckets({
        userId: auth.user.id,
        projectId,
        scope: selectedScope,
        provider: selectedProvider,
        repo: selectedRepo,
        repoPaths: selectedScope === 'global' ? [] : context.repoPaths,
        excludeExternalThreadIds: excludedExternalThreadIds,
      }),
      latestAiHistoryIndex({
        userId: auth.user.id,
        projectId,
        scope: selectedScope,
        provider: selectedProvider,
        repo: selectedRepo,
        repoPaths: selectedScope === 'global' ? [] : context.repoPaths,
      }),
    ])
    const sync = await buildAiHistorySyncState({
      userId: auth.user.id,
      selectedRepo,
      selectedScope,
      selectedProvider,
      scopes: context.optionScopes,
      lastIndexedAt,
    })
    const nextCursor = items.length >= limit ? encodeAiHistoryCursor(items[items.length - 1]!) : null
    return NextResponse.json({
      items: items.map(item => toAiHistoryListItem(item, context.scopeLabels)),
      counts,
      nextCursor,
      sync,
      page: {
        limit,
        cursor: cursorParam,
      },
    } satisfies AiHistoryListResponse)
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      const sync = await buildAiHistorySyncState({
        userId: auth.user.id,
        selectedRepo,
        selectedScope,
        selectedProvider,
        scopes: context.optionScopes,
        lastIndexedAt: null,
      })
      return NextResponse.json(emptyResponse({ selectedRepo, selectedScope, selectedProvider, limit, cursor: cursorParam, sync }))
    }
    console.error('[ai-history GET]', error)
    return NextResponse.json({ error: 'AI history fetch failed' }, { status: 500 })
  }
}
