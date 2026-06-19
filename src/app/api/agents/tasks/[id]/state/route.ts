import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import {
  insertAiTaskActivityMessage,
  type AiTaskActivityImportance,
  type AiTaskActivityKind,
  type AiTaskActivityRole,
} from '@/lib/ai-task-activity'
import { resolveRunningStartedAt, shouldInitializeRunningStartedAt } from '@/lib/ai-task-run-timing'
import { isTursoConfigured } from '@/lib/turso/client'
import { insertTaskEvent, insertTaskProgress, upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

const VALID_STATUSES = new Set(['pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed'])
const MAX_CURRENT_STEP_CHARS = 600
const MAX_SUMMARY_CHARS = 1_200
const MAX_SOURCE_TASK_TITLE_CHARS = 120
const MAX_ACTIVITY_MESSAGES_PER_UPDATE = 12
const MAX_ACTIVITY_BODY_CHARS = 8_000

const VALID_ACTIVITY_ROLES = new Set<AiTaskActivityRole>(['system', 'codex', 'user', 'status'])
const VALID_ACTIVITY_KINDS = new Set<AiTaskActivityKind>([
  'prompt_waiting',
  'sent',
  'progress',
  'question',
  'approval',
  'resumed',
  'completed',
  'failed',
  'user_answer',
])
const VALID_ACTIVITY_IMPORTANCE = new Set<AiTaskActivityImportance>(['normal', 'important'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function isThreadUnavailableReason(value: unknown) {
  return value === 'thread_deleted' || value === 'thread_unavailable'
}

function isInternalAgentActivityBody(value: string) {
  return /^(Codex実行を開始しました|Codexが実行を開始しました|Codex thread が見つからないため監視を停止しました|Codex thread が一時的に見つからないため、監視を継続します|Codex thread の監視を停止しました)/u.test(value.trim())
}

function parseTimeMs(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function isClaimedByOtherActiveRunner(
  task: { claimed_runner_id?: unknown; claim_expires_at?: unknown },
  runnerId: string,
  nowMs = Date.now(),
) {
  const claimedRunnerId = compactString(task.claimed_runner_id, 120)
  if (!claimedRunnerId || claimedRunnerId === runnerId) return false
  const claimExpiresAtMs = parseTimeMs(task.claim_expires_at)
  return claimExpiresAtMs == null || claimExpiresAtMs > nowMs
}

export function shouldCompleteSourceTaskFromAgentState(input: {
  status: string
  result?: Record<string, unknown> | null
  sourceTaskId?: unknown
}) {
  const sourceTaskId = compactString(input.sourceTaskId, 120)
  if (!sourceTaskId) return false
  if (input.status !== 'completed') return false
  const result = isRecord(input.result) ? input.result : {}
  return result.codex_review_reason === 'archived' &&
    result.codex_source_task_completed === true &&
    result.codex_source_task_completion_suppressed !== true
}

export function shouldMarkSourceTaskArchivedFromAgentState(input: {
  result?: Record<string, unknown> | null
  sourceTaskId?: unknown
}) {
  const sourceTaskId = compactString(input.sourceTaskId, 120)
  if (!sourceTaskId) return false
  const result = isRecord(input.result) ? input.result : {}
  const meta = isRecord(result.meta) ? result.meta : {}
  return result.codex_review_reason === 'archived' ||
    result.codex_thread_archived === true ||
    meta.thread_archived === true
}

export function normalizeAgentStateForLegacyThreadMissing(input: {
  status: string
  result?: Record<string, unknown> | null
  previousStatus?: unknown
}) {
  const result = isRecord(input.result) ? { ...input.result } : null
  if (!result || !isThreadUnavailableReason(result.codex_review_reason)) {
    return { status: input.status, result }
  }

  result.codex_review_reason = 'thread_unavailable'

  if (typeof result.message === 'string' && result.message.includes('見つからないため監視を停止')) {
    result.message = 'Codex thread が一時的に見つからないため、監視を継続します。'
  }

  if (
    input.previousStatus === 'running' &&
    input.status === 'awaiting_approval'
  ) {
    result.codex_run_state = 'running'
    result.message = 'Codex thread を一時的に確認できません。実行中として監視を継続します。'
    result.current_step = 'Codex thread を一時確認中です'
    delete result.awaiting_approval_at
    return { status: 'running', result }
  }

  return { status: input.status, result }
}

function normalizeSourceTaskTitle(value: unknown, max = MAX_SOURCE_TASK_TITLE_CHARS) {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.replace(/\s+/g, ' ').trim().slice(0, max)
  return text || null
}

function firstNonEmptyLine(value: unknown) {
  if (typeof value !== 'string') return null
  return value.split('\n').map(line => line.trim()).find(Boolean) ?? null
}

function looksLikeRawPromptTitle(value: unknown) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  if (text.includes('\n')) return true
  if (text.length > 90) return true
  return text.startsWith('# AGENTS.md instructions') || text.includes('<environment_context>')
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  return normalizeSourceTaskTitle(record[key])
}

function sourceTitleCandidates(input: {
  prompt?: unknown
  previousResult?: Record<string, unknown> | null
}) {
  const result = isRecord(input.previousResult) ? input.previousResult : {}
  const meta = isRecord(result.meta) ? result.meta : {}
  const candidates = new Set<string>()
  for (const value of [
    firstNonEmptyLine(input.prompt),
    stringFromRecord(meta, 'source_task_title'),
    stringFromRecord(meta, 'source_task_title_suggestion'),
    stringFromRecord(meta, 'thread_title'),
  ]) {
    const title = normalizeSourceTaskTitle(value)
    if (title) candidates.add(title)
  }
  const threadId = typeof result.codex_thread_id === 'string' ? result.codex_thread_id.trim() : ''
  if (threadId) candidates.add(`Codex thread ${threadId.slice(0, 8)}`)
  return candidates
}

function looksLikePromptDerivedTitle(currentTitle: unknown, prompt: unknown) {
  const current = normalizeSourceTaskTitle(currentTitle)
  const firstPromptLine = normalizeSourceTaskTitle(firstNonEmptyLine(prompt), 500)
  if (!current || !firstPromptLine) return false
  if (current.length < 40) return false
  return firstPromptLine.length > current.length &&
    firstPromptLine.startsWith(current)
}

export function shouldApplyCodexThreadTitleToSourceTask(input: {
  currentTitle?: unknown
  nextTitle?: unknown
  prompt?: unknown
  previousResult?: Record<string, unknown> | null
}) {
  const currentTitle = normalizeSourceTaskTitle(input.currentTitle)
  const nextTitle = normalizeSourceTaskTitle(input.nextTitle)
  if (!currentTitle || !nextTitle || currentTitle === nextTitle) return false
  if (looksLikeRawPromptTitle(input.currentTitle) || looksLikePromptDerivedTitle(input.currentTitle, input.prompt)) return true
  return sourceTitleCandidates(input).has(currentTitle)
}

export function memoWithUpdatedImportedThreadTitle(input: {
  memo?: unknown
  currentTitle?: unknown
  nextTitle?: unknown
}) {
  if (typeof input.memo !== 'string' || !input.memo.trim()) return null
  const currentTitle = normalizeSourceTaskTitle(input.currentTitle)
  const nextTitle = normalizeSourceTaskTitle(input.nextTitle)
  if (!currentTitle || !nextTitle) return null
  const lines = input.memo.split('\n')
  const firstLine = lines[0] ?? ''
  const currentHeading = firstLine.trim().startsWith('# ')
    ? normalizeSourceTaskTitle(firstLine.trim().replace(/^#\s+/, ''))
    : null
  if (currentHeading !== currentTitle) return null
  lines[0] = `# ${nextTitle}`
  return lines.join('\n')
}

function compactLatestLine(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const latest = value
    .split(/\n{2,}|\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
  return compactString(latest, max)
}

function compactActivityMessages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ACTIVITY_MESSAGES_PER_UPDATE).flatMap((item) => {
    if (!isRecord(item)) return []
    const role = typeof item.role === 'string' && VALID_ACTIVITY_ROLES.has(item.role as AiTaskActivityRole)
      ? item.role as AiTaskActivityRole
      : null
    const kind = typeof item.kind === 'string' && VALID_ACTIVITY_KINDS.has(item.kind as AiTaskActivityKind)
      ? item.kind as AiTaskActivityKind
      : null
    const body = compactString(item.body, MAX_ACTIVITY_BODY_CHARS)
    if (!role || !kind || !body) return []
    if (isInternalAgentActivityBody(body)) return []

    const importance = typeof item.importance === 'string' && VALID_ACTIVITY_IMPORTANCE.has(item.importance as AiTaskActivityImportance)
      ? item.importance as AiTaskActivityImportance
      : undefined
    const dedupeKey = compactString(item.dedupe_key ?? item.dedupeKey, 240) ?? undefined
    const createdAtRaw = compactString(item.created_at ?? item.createdAt, 80)
    const createdAt = createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw).toISOString()
      : undefined

    return [{
      role,
      kind,
      body,
      importance,
      dedupeKey,
      createdAt,
      metadata: isRecord(item.metadata) ? item.metadata : undefined,
    }]
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const runnerId = typeof body.runner_id === 'string' ? body.runner_id : ''
    let status = typeof body.status === 'string' ? body.status : ''
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })

    const { data: task } = await supabase
      .from('ai_tasks')
      .select('id, user_id, space_id, prompt, result, claimed_runner_id, claim_expires_at, status, started_at, source_task_id')
      .eq('id', id)
      .maybeSingle()
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.user_id !== token.user_id && task.space_id !== token.space_id) {
      return NextResponse.json({ error: 'Task is outside this agent token scope' }, { status: 403 })
    }
    if (isClaimedByOtherActiveRunner(task, runnerId)) {
      return NextResponse.json({ error: 'Task is claimed by another runner' }, { status: 409 })
    }

    const normalizedState = normalizeAgentStateForLegacyThreadMissing({
      status,
      result: isRecord(body.result) ? body.result : null,
      previousStatus: task.status,
    })
    status = normalizedState.status

    const updates: Record<string, unknown> = {
      status,
    }
    if (normalizedState.result) updates.result = normalizedState.result
    if (typeof body.error === 'string') updates.error = body.error
    const existingStartedAt = typeof task.started_at === 'string' ? task.started_at : null
    const runningStartedAt = status === 'running' ? resolveRunningStartedAt(existingStartedAt) : null
    if (status === 'running' && shouldInitializeRunningStartedAt(existingStartedAt)) updates.started_at = runningStartedAt
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date().toISOString()
      updates.claim_expires_at = null
    }

    const sourceTaskTitle = normalizeSourceTaskTitle(isRecord(body) ? body.source_task_title : null)
    let sourceTaskTitleForSnapshot: string | null = null
    if (sourceTaskTitle && task.source_task_id) {
      const { data: sourceTask, error: sourceTaskError } = await supabase
        .from('tasks')
        .select('id, title, memo, source')
        .eq('id', String(task.source_task_id))
        .eq('user_id', String(task.user_id))
        .is('deleted_at', null)
        .maybeSingle()

      if (sourceTaskError) return NextResponse.json({ error: sourceTaskError.message }, { status: 500 })

      if (sourceTask?.source === 'codex_app_thread') {
        const currentSourceTitle = normalizeSourceTaskTitle(sourceTask.title)
        const shouldApplySourceTaskTitle = shouldApplyCodexThreadTitleToSourceTask({
          currentTitle: sourceTask.title,
          nextTitle: sourceTaskTitle,
          prompt: task.prompt,
          previousResult: isRecord(task.result) ? task.result : null,
        })
        if (currentSourceTitle === sourceTaskTitle || shouldApplySourceTaskTitle) {
          sourceTaskTitleForSnapshot = sourceTaskTitle
        }
        if (shouldApplySourceTaskTitle) {
          const taskUpdates: Record<string, unknown> = {
            title: sourceTaskTitle,
            updated_at: new Date().toISOString(),
          }
          const nextMemo = memoWithUpdatedImportedThreadTitle({
            memo: sourceTask.memo,
            currentTitle: sourceTask.title,
            nextTitle: sourceTaskTitle,
          })
          if (nextMemo) taskUpdates.memo = nextMemo

          const { error: titleUpdateError } = await supabase
            .from('tasks')
            .update(taskUpdates)
            .eq('id', String(task.source_task_id))
            .eq('user_id', String(task.user_id))
            .is('deleted_at', null)

          if (titleUpdateError) return NextResponse.json({ error: titleUpdateError.message }, { status: 500 })
        }
      }
    }

    const resultForSourceCompletion = normalizedState.result
    if (shouldCompleteSourceTaskFromAgentState({
      status,
      result: resultForSourceCompletion,
      sourceTaskId: task.source_task_id,
    })) {
      const { error: sourceUpdateError } = await supabase
        .from('tasks')
        .update({
          status: 'done',
          stage: 'done',
          updated_at: new Date().toISOString(),
        })
        .eq('id', String(task.source_task_id))
        .eq('user_id', String(task.user_id))
        .is('deleted_at', null)

      if (sourceUpdateError) return NextResponse.json({ error: sourceUpdateError.message }, { status: 500 })
    }

    if (shouldMarkSourceTaskArchivedFromAgentState({
      result: resultForSourceCompletion,
      sourceTaskId: task.source_task_id,
    })) {
      const resultJson = resultForSourceCompletion ?? {}
      const threadId = compactString(resultJson.codex_thread_id, 200)
      const taskUpdates: Record<string, unknown> = {
        codex_status: 'archived',
        updated_at: new Date().toISOString(),
      }
      if (threadId) taskUpdates.codex_thread_id = threadId
      const { error: sourceArchiveError } = await supabase
        .from('tasks')
        .update(taskUpdates)
        .eq('id', String(task.source_task_id))
        .eq('user_id', String(task.user_id))
        .is('deleted_at', null)

      if (sourceArchiveError) return NextResponse.json({ error: sourceArchiveError.message }, { status: 500 })
    }

    const { data, error } = await supabase
      .from('ai_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (isTursoConfigured()) {
      try {
        const resultJson = normalizedState.result ?? {}
        const currentStep = compactString(resultJson.current_step, MAX_CURRENT_STEP_CHARS)
          ?? compactLatestLine(resultJson.message, MAX_CURRENT_STEP_CHARS)
          ?? compactLatestLine(resultJson.live_log, MAX_CURRENT_STEP_CHARS)
        const summary = isRecord(resultJson.progress_summary)
          ? JSON.stringify(resultJson.progress_summary).slice(0, MAX_SUMMARY_CHARS)
          : compactString(resultJson.summary, MAX_SUMMARY_CHARS)
            ?? compactLatestLine(resultJson.message, MAX_SUMMARY_CHARS)
        const statusChanged = status !== task.status
        await upsertTursoAiTask({
          id,
          user_id: String(task.user_id),
          space_id: typeof task.space_id === 'string' ? task.space_id : null,
          title: sourceTaskTitleForSnapshot,
          status,
          current_step: currentStep,
          summary,
          error_message: typeof body.error === 'string' ? body.error : null,
          started_at: status === 'running' ? runningStartedAt : null,
          completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
        })
        if (statusChanged) {
          await insertTaskEvent({
            task_id: id,
            user_id: String(task.user_id),
            event_type: status,
            payload_json: {
              runner_id: runnerId,
              status,
              error: typeof body.error === 'string' ? body.error : null,
            },
          })
        }
        if (statusChanged && (currentStep || summary)) {
          await insertTaskProgress({
            task_id: id,
            user_id: String(task.user_id),
            phase: status,
            message: currentStep,
            progress_json: isRecord(resultJson.progress_summary) ? resultJson.progress_summary : null,
          })
        }
      } catch (tursoError) {
        console.error('[agents/tasks/state turso]', tursoError)
      }
    }
    const activityMessages = compactActivityMessages(body.activity_messages)
    if (activityMessages.length > 0) {
      await Promise.all(activityMessages.map(message => insertAiTaskActivityMessage(supabase, {
        taskId: id,
        userId: String(task.user_id),
        role: message.role,
        kind: message.kind,
        body: message.body,
        importance: message.importance,
        metadata: {
          ...(message.metadata ?? {}),
          runner_id: runnerId,
          source: 'focusmap-agent',
        },
        dedupeKey: message.dedupeKey,
        createdAt: message.createdAt,
      }))).catch((activityError: unknown) => {
        console.error('[agents/tasks/state activity]', activityError)
      })
    }
    return NextResponse.json({ task: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent authentication failed' },
      { status: 401 },
    )
  }
}
