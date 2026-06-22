import { NextRequest, NextResponse } from 'next/server'
import { formatBillingCycle } from '@/lib/format'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { getAiHistoryItemForUser } from '@/lib/turso/ai-history'
import {
  AI_HISTORY_ARCHIVE_REQUEST_REASON,
  authenticateAiHistoryRequest,
  compactString,
  isPendingAiHistoryArchiveRequest,
  unauthorized,
} from '../../_shared'

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
    if (item.archived) {
      return NextResponse.json({ success: true, state: 'archived', itemId: item.id })
    }

    const threadId = compactString(item.external_thread_id, 200)
    if (!threadId) return NextResponse.json({ error: 'Codex thread id is missing' }, { status: 400 })

    const { data: existingRows, error: existingError } = await auth.supabase
      .from('ai_tasks')
      .select('id, codex_thread_id, result')
      .eq('user_id', auth.user.id)
      .eq('codex_thread_id', threadId)
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
      return NextResponse.json({
        success: true,
        state: 'pending',
        itemId: item.id,
        archiveTaskId: compactString((existingPending as Record<string, unknown>).id, 120),
      })
    }

    const nowIso = new Date().toISOString()
    const result = archiveResult({
      historyItemId: item.id,
      threadId,
      repoPath: item.repo_path,
      title: item.title,
      nowIso,
    })

    const { data, error } = await auth.supabase
      .from('ai_tasks')
      .insert({
        user_id: auth.user.id,
        prompt: `Codexチャットをアーカイブ: ${item.title}`,
        skill_id: null,
        approval_type: 'auto',
        status: 'completed',
        started_at: nowIso,
        completed_at: nowIso,
        cwd: item.repo_path,
        executor: 'codex_app',
        codex_thread_id: threadId,
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

    return NextResponse.json({
      success: true,
      state: 'pending',
      itemId: item.id,
      archiveTaskId: compactString((data as Record<string, unknown>).id, 120),
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[ai-history archive POST]', error)
    return NextResponse.json({ error: 'AI history archive request failed' }, { status: 500 })
  }
}
