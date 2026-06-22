import { NextRequest, NextResponse } from 'next/server'
import { formatBillingCycle } from '@/lib/format'
import { getTursoClient, isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { getAiHistoryItemForUser, type TursoAiHistoryItem } from '@/lib/turso/ai-history'
import {
  AI_HISTORY_ARCHIVE_REQUEST_REASON,
  authenticateAiHistoryRequest,
  compactString,
  isPendingAiHistoryArchiveRequest,
  unauthorized,
} from '../../_shared'

const DUPLICATE_ARCHIVE_WINDOW_MS = 60_000

type ArchiveTarget = {
  historyItemId: string
  threadId: string
  repoPath: string
  title: string
  archived: boolean
}

function archiveResult(input: {
  historyItemId: string
  threadId: string
  repoPath: string
  title: string
  nowIso: string
}) {
  const currentStep = 'AI履歴からCodexチャットのアーカイブを依頼しました'
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
    codex_archive_target: 'ai_history_item',
    codex_history_item_id: input.historyItemId,
    ai_history_item_id: input.historyItemId,
    ai_history_repo_path: input.repoPath,
    ai_history_title: input.title,
    codex_last_checked_at: input.nowIso,
    last_activity_at: input.nowIso,
    current_step: currentStep,
    session_health: 'stopped',
    awaiting_approval_at: input.nowIso,
  }
}

function duplicateAnchorMs(item: {
  started_at?: string | null
  indexed_at?: string | null
  created_at?: string | null
  last_activity_at?: string | null
}) {
  const candidates = [item.started_at, item.indexed_at, item.created_at, item.last_activity_at]
  for (const value of candidates) {
    const parsed = Date.parse(value ?? '')
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function isDuplicateArchiveTitle(title: string) {
  const trimmed = title.trim()
  return trimmed.length >= 12 && trimmed !== '新しいチャット'
}

function rowBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'bigint') return value !== 0n
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

function toArchiveTarget(
  item: Pick<TursoAiHistoryItem, 'id' | 'external_thread_id' | 'repo_path' | 'title' | 'archived'>,
): ArchiveTarget | null {
  const threadId = compactString(item.external_thread_id, 200)
  if (!threadId) return null
  return {
    historyItemId: item.id,
    threadId,
    repoPath: item.repo_path,
    title: item.title,
    archived: item.archived,
  }
}

async function listDuplicateArchiveTargets(item: TursoAiHistoryItem) {
  const sourceAnchorMs = duplicateAnchorMs(item)
  if (sourceAnchorMs === null) return []
  if (!isDuplicateArchiveTitle(item.title)) return []

  const result = await getTursoClient().execute({
    sql: `
      SELECT id, external_thread_id, repo_path, title, started_at, indexed_at, created_at, last_activity_at, archived
      FROM ai_history_items
      WHERE user_id = ?
        AND provider = ?
        AND repo_path = ?
        AND title = ?
        AND deleted_at IS NULL
        AND archived = 0
        AND external_thread_id <> ?
      ORDER BY indexed_at DESC
      LIMIT 20
    `,
    args: [item.user_id, item.provider, item.repo_path, item.title, item.external_thread_id],
  })

  return result.rows
    .map(row => {
      const candidate = {
        id: compactString((row as Record<string, unknown>).id, 200) ?? '',
        external_thread_id: compactString((row as Record<string, unknown>).external_thread_id, 200) ?? '',
        repo_path: compactString((row as Record<string, unknown>).repo_path, 500) ?? '',
        title: compactString((row as Record<string, unknown>).title, 500) ?? '',
        started_at: compactString((row as Record<string, unknown>).started_at, 100),
        indexed_at: compactString((row as Record<string, unknown>).indexed_at, 100),
        created_at: compactString((row as Record<string, unknown>).created_at, 100),
        last_activity_at: compactString((row as Record<string, unknown>).last_activity_at, 100),
        archived: rowBoolean((row as Record<string, unknown>).archived),
      }
      const candidateAnchorMs = duplicateAnchorMs(candidate)
      if (candidateAnchorMs === null) return null
      if (Math.abs(candidateAnchorMs - sourceAnchorMs) > DUPLICATE_ARCHIVE_WINDOW_MS) return null
      return toArchiveTarget(candidate)
    })
    .filter((target): target is ArchiveTarget => Boolean(target))
}

function uniqueArchiveTargets(targets: ArchiveTarget[]) {
  const seenThreadIds = new Set<string>()
  return targets.filter(target => {
    if (seenThreadIds.has(target.threadId)) return false
    seenThreadIds.add(target.threadId)
    return true
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()
  if (!isTursoConfigured()) {
    return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
  }

  const { id } = await params
  try {
    const item = await getAiHistoryItemForUser(id, auth.user.id)
    if (!item || item.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (item.provider !== 'codex_app') {
      return NextResponse.json({ error: 'Only Codex.app history can be archived' }, { status: 400 })
    }
    const nowIso = new Date().toISOString()
    const duplicateTargets = await listDuplicateArchiveTargets(item)
    const ownTarget = toArchiveTarget(item)
    if (!ownTarget && duplicateTargets.length === 0) {
      return NextResponse.json({ error: 'Codex thread id is missing' }, { status: 400 })
    }
    const targets = uniqueArchiveTargets([...(ownTarget ? [ownTarget] : []), ...duplicateTargets])
    const activeTargets = targets.filter(target => !target.archived)
    if (activeTargets.length === 0) {
      return NextResponse.json({ success: true, state: 'archived', itemId: item.id })
    }

    const archiveTaskIds: string[] = []
    for (const target of activeTargets) {
      const { data: existingRows, error: existingError } = await auth.supabase
        .from('ai_tasks')
        .select('id, codex_thread_id, result')
        .eq('user_id', auth.user.id)
        .eq('codex_thread_id', target.threadId)
        .in('executor', ['codex', 'codex_app'])
        .in('status', ['completed', 'awaiting_approval', 'running', 'needs_input'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (existingError) {
        console.error('[ai-history archive existing]', existingError)
        return NextResponse.json({ error: 'Failed to check archive request' }, { status: 500 })
      }

      const existingPending = (existingRows ?? []).find(row =>
        isPendingAiHistoryArchiveRequest(row as Record<string, unknown>)
      )
      if (existingPending) {
        const existingTaskId = compactString((existingPending as Record<string, unknown>).id, 120)
        if (existingTaskId) archiveTaskIds.push(existingTaskId)
        continue
      }

      const result = archiveResult({
        historyItemId: target.historyItemId,
        threadId: target.threadId,
        repoPath: target.repoPath,
        title: target.title,
        nowIso,
      })

      const { data, error } = await auth.supabase
        .from('ai_tasks')
        .insert({
          user_id: auth.user.id,
          prompt: `Codexチャットをアーカイブ: ${target.title}`,
          skill_id: null,
          approval_type: 'auto',
          status: 'completed',
          started_at: nowIso,
          completed_at: nowIso,
          cwd: target.repoPath,
          executor: 'codex_app',
          codex_thread_id: target.threadId,
          run_visibility: 'private',
          billing_cycle: formatBillingCycle(),
          result,
        })
        .select('id')
        .single()

      if (error) {
        console.error('[ai-history archive insert]', error)
        return NextResponse.json({ error: 'Failed to request Codex archive' }, { status: 500 })
      }

      const archiveTaskId = compactString((data as Record<string, unknown>).id, 120)
      if (archiveTaskId) archiveTaskIds.push(archiveTaskId)
    }

    return NextResponse.json({
      success: true,
      state: 'pending',
      itemId: item.id,
      archiveTaskId: archiveTaskIds[0] ?? null,
      archiveTaskIds,
      archivedThreadIds: activeTargets.map(target => target.threadId),
      duplicateThreadCount: Math.max(0, targets.length - 1),
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[ai-history archive POST]', error)
    return NextResponse.json({ error: 'AI history archive request failed' }, { status: 500 })
  }
}
