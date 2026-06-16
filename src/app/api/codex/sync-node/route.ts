import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { NextRequest, NextResponse } from 'next/server'
import {
  insertAiTaskActivityMessage,
  type AiTaskActivityKind,
  type AiTaskActivityRole,
} from '@/lib/ai-task-activity'
import { isLocalCodexOpenRequestHost } from '@/lib/codex-app-launch'
import {
  detectCodexResumeAfterApproval,
  parseCodexRollout,
  shouldCompleteSourceTaskForCodexReview,
  type CodexReviewReason,
  type CodexRunState,
  type CodexThreadSnapshot,
} from '@/lib/codex-run-state'
import { createClient } from '@/utils/supabase/server'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { insertTaskEvent, upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const SQLITE_BIN = '/usr/bin/sqlite3'
const CODEX_PROGRESS_ACTIVITY_INTERVAL_MS = 2 * 60_000
const MAX_CURRENT_STEP_CHARS = 600
const MAX_SUMMARY_CHARS = 1_200

type SyncNodeBody = {
  source_task_id?: unknown
  ai_task_id?: unknown
  include_visible_activity?: unknown
}

type CodexTaskRow = {
  id: string
  user_id: string
  space_id: string | null
  prompt: string
  codex_thread_id: string | null
  cwd: string | null
  result: Record<string, unknown> | null
  status: string
  started_at: string | null
  created_at: string | null
  source_task_id: string | null
  executor: 'codex' | 'codex_app'
}

type CodexThreadRow = CodexThreadSnapshot & {
  id: string
  first_user_message?: string | null
}

function canUseLocalSync(req: NextRequest): boolean {
  if (process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_SYNC === 'true') return true
  return isLocalCodexOpenRequestHost({
    nextHostname: req.nextUrl.hostname,
    host: req.headers.get('host'),
    forwardedHost: req.headers.get('x-forwarded-host'),
  })
}

function resolveCodexStateDbPath() {
  const configured = process.env.FOCUSMAP_CODEX_STATE_DB_PATH?.trim()
  const candidates = [
    configured,
    path.join(os.homedir(), '.codex', 'sqlite', 'state_5.sqlite'),
    path.join(os.homedir(), '.codex', 'state_5.sqlite'),
  ].filter((value): value is string => Boolean(value))

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function sqlText(value: string): string {
  return value.replace(/'/g, "''")
}

function codexTaskThreadId(task: CodexTaskRow): string | null {
  if (task.codex_thread_id?.trim()) return task.codex_thread_id.trim()
  const resultThreadId = asRecord(task.result).codex_thread_id
  return typeof resultThreadId === 'string' && resultThreadId.trim() ? resultThreadId.trim() : null
}

function codexHandoffTokenForTask(task: CodexTaskRow): string | null {
  const resultToken = asRecord(task.result).codex_handoff_token
  if (typeof resultToken === 'string' && resultToken.trim()) return resultToken.trim()
  const match = task.prompt.match(/Focusmap同期ID:\s*(FM-[A-Za-z0-9._:-]+)/)
  return match?.[1]?.trim() || null
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(SQLITE_BIN, ['-json', dbPath, sql], {
    timeout: 5_000,
    windowsHide: true,
  })
  const raw = stdout.trim()
  return raw ? JSON.parse(raw) as T[] : []
}

async function findMatchingCodexThread(dbPath: string, task: CodexTaskRow): Promise<string | null> {
  const startedMs = parseTimeMs(task.started_at) ?? parseTimeMs(task.created_at) ?? Date.now()
  const sinceMs = Math.max(0, startedMs - 60_000)
  const token = codexHandoffTokenForTask(task)
  const cwd = task.cwd?.trim()
  const cwdCondition = cwd ? ` AND cwd = '${sqlText(cwd)}'` : ''
  const candidates: string[] = []

  if (token) {
    const tokenCondition = `first_user_message LIKE '%Focusmap同期ID: ${sqlText(token)}%' AND updated_at_ms >= ${sinceMs}`
    if (cwdCondition) candidates.push(`${tokenCondition}${cwdCondition}`)
    candidates.push(tokenCondition)
  }

  const promptPrefix = task.prompt.slice(0, 60).trim()
  if (promptPrefix) {
    const prefixCondition = `first_user_message LIKE '${sqlText(promptPrefix)}%' AND updated_at_ms >= ${sinceMs}`
    if (cwdCondition) candidates.push(`${prefixCondition}${cwdCondition}`)
    candidates.push(prefixCondition)
  }

  for (const where of candidates) {
    const rows = await sqliteJson<{ id: string }>(
      dbPath,
      `SELECT id FROM threads WHERE ${where} ORDER BY created_at_ms DESC LIMIT 1`,
    )
    if (rows[0]?.id) return rows[0].id
  }

  return null
}

async function readCodexThread(dbPath: string, threadId: string): Promise<CodexThreadRow | null> {
  const rows = await sqliteJson<CodexThreadRow>(
    dbPath,
    [
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, preview, rollout_path, source, cwd, first_user_message',
      'FROM threads',
      `WHERE id = '${sqlText(threadId)}'`,
      'LIMIT 1',
    ].join(' '),
  )
  return rows[0] ?? null
}

function textFingerprint(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(36)
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function normalizeStep(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isMeaningfulStepChange(previous: unknown, next: string): boolean {
  const prevText = typeof previous === 'string' ? normalizeStep(previous) : ''
  const nextText = normalizeStep(next)
  if (!nextText) return false
  if (!prevText) return true
  if (prevText === nextText) return false
  return !prevText.includes(nextText) && !nextText.includes(prevText)
}

function shouldWriteProgressActivity(current: Record<string, unknown>, currentStep: string, nowMs: number): boolean {
  if (!currentStep.trim()) return false
  if (isMeaningfulStepChange(current.codex_activity_last_progress_step, currentStep)) return true

  const lastProgressAtMs = parseIsoMs(current.codex_activity_last_progress_at)
  return lastProgressAtMs == null || nowMs - lastProgressAtMs >= CODEX_PROGRESS_ACTIVITY_INTERVAL_MS
}

function activityForReviewReason(reason: CodexReviewReason): {
  kind: AiTaskActivityKind
  role: AiTaskActivityRole
  body: string
} | null {
  if (reason === 'completed') {
    return null
  }
  if (reason === 'approval_requested') {
    return { kind: 'approval', role: 'codex', body: 'Codexが承認を待っています。内容を確認してください。' }
  }
  if (reason === 'aborted' || reason === 'monitoring_lost' || reason === 'thread_deleted') {
    return { kind: 'failed', role: 'status', body: 'Codexの実行が停止しました。Codex.app側の状態確認が必要です。' }
  }
  if (reason === 'thread_unavailable') {
    return { kind: 'approval', role: 'status', body: 'Codex threadを一時的に確認できません。監視は継続します。' }
  }
  return { kind: 'approval', role: 'status', body: 'Codexセッションは確認待ちです。' }
}

function reviewReasonLabel(reason: CodexReviewReason): string {
  if (reason === 'completed') return '完了確認'
  if (reason === 'approval_requested') return '承認待ち'
  if (reason === 'manual_handoff') return 'プロンプト待ち'
  if (reason === 'monitoring_lost') return '同期確認'
  if (reason === 'thread_deleted') return 'スレッド確認'
  if (reason === 'thread_unavailable') return '一時確認'
  if (reason === 'aborted') return '停止確認'
  if (reason === 'archived') return 'アーカイブ確認'
  return '確認待ち'
}

function compactText(value: string | null | undefined, max: number) {
  const text = value?.trim()
  if (!text) return null
  return text.length > max ? text.slice(-max) : text
}

function normalizeVisibleText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function isPromptWaitingText(value: string) {
  return /プロンプト待ち|送信待ち|Codex\.appで送信|Focusmapはthread状態|Focusmapは状態と出力だけを同期|プロンプトはコピー済み/u.test(value)
}

function isPromptEcho(value: string, task: CodexTaskRow) {
  const text = normalizeVisibleText(value)
  if (!text) return true
  const prompt = normalizeVisibleText(task.prompt)
  const firstPromptLine = normalizeVisibleText(task.prompt.split('\n').find(line => line.trim()) ?? '')
  return text === prompt || (!!firstPromptLine && text === firstPromptLine)
}

function hasVisibleCodexOutput(row: CodexThreadRow, parsed: ReturnType<typeof parseCodexRollout>, task: CodexTaskRow) {
  const values = [
    parsed.latestAgentMessage,
    parsed.liveLog,
    row.preview ?? '',
  ]
  return values.some(value => {
    const text = value?.trim()
    if (!text) return false
    if (isPromptWaitingText(text)) return false
    return !isPromptEcho(text, task)
  })
}

function visibleCodexActivityEvent(row: CodexThreadRow, parsed: ReturnType<typeof parseCodexRollout>, task: CodexTaskRow): {
  role: AiTaskActivityRole
  kind: AiTaskActivityKind
  body: string
  dedupeKey: string
  importance?: 'normal' | 'important'
  createdAt?: string | null
} | null {
  const candidates = [
    { body: parsed.latestQuestion, kind: 'question' as const, importance: 'important' as const, createdAt: parsed.lastActivityAt },
    { body: parsed.latestAgentMessage, kind: 'progress' as const, importance: 'normal' as const, createdAt: parsed.lastActivityAt },
    { body: row.preview ?? '', kind: 'progress' as const, importance: 'normal' as const, createdAt: threadUpdatedAtIso(row) },
  ]

  for (const candidate of candidates) {
    const body = compactText(candidate.body, 2_000)
    if (!body) continue
    if (isPromptWaitingText(body)) continue
    if (isPromptEcho(body, task)) continue
    const fingerprint = textFingerprint(body)
    return {
      role: 'codex',
      kind: candidate.kind,
      body,
      dedupeKey: `thread:${row.id}:visible:${candidate.kind}:${fingerprint}`,
      importance: candidate.importance,
      createdAt: candidate.createdAt,
    }
  }

  return null
}

function visibleCodexActivityEvents(row: CodexThreadRow, parsed: ReturnType<typeof parseCodexRollout>, task: CodexTaskRow): Array<{
  role: AiTaskActivityRole
  kind: AiTaskActivityKind
  body: string
  dedupeKey: string
  importance?: 'normal' | 'important'
  createdAt?: string | null
}> {
  const events: Array<{
    role: AiTaskActivityRole
    kind: AiTaskActivityKind
    body: string
    dedupeKey: string
    importance?: 'normal' | 'important'
    createdAt?: string | null
  }> = []
  const pushEvent = (event: {
    role: AiTaskActivityRole
    kind: AiTaskActivityKind
    body: string
    dedupeKey: string
    importance?: 'normal' | 'important'
    createdAt?: string | null
  }) => {
    const fingerprint = textFingerprint(event.body)
    if (events.some(existing => textFingerprint(existing.body) === fingerprint)) return
    events.push(event)
  }

  for (const message of parsed.visibleMessages.slice(-16)) {
    const body = compactText(message.body, 2_000)
    if (!body) continue
    if (isPromptWaitingText(body)) continue
    if (isPromptEcho(body, task)) continue
    const kind: AiTaskActivityKind = message.role === 'user'
      ? 'user_answer'
      : message.kind === 'completed'
        ? 'completed'
        : message.kind === 'question'
          ? 'question'
          : 'progress'
    pushEvent({
      role: message.role === 'user' ? 'user' : 'codex',
      kind,
      body,
      dedupeKey: `thread:${row.id}:message:${message.role}:${message.createdAt ?? 'no-time'}:${textFingerprint(body)}`,
      importance: kind === 'progress' ? 'normal' : 'important',
      createdAt: message.createdAt,
    })
  }

  const fallback = visibleCodexActivityEvent(row, parsed, task)
  if (fallback) pushEvent(fallback)
  return events
}

function threadUpdatedAtIso(row: CodexThreadRow) {
  return row.updated_at_ms ? new Date(row.updated_at_ms).toISOString() : null
}

function codexPulseStep(state: CodexRunState | 'prompt_waiting', reason: CodexReviewReason): string {
  if (state === 'running') return 'Codex.appが作業中です'
  if (state === 'awaiting_approval') return reviewReasonLabel(reason)
  return 'プロンプト待ち'
}

function codexPulseSummary(state: CodexRunState | 'prompt_waiting', reason: CodexReviewReason, lastActivityAt: string | null): string {
  const activity = lastActivityAt ? `最終活動 ${lastActivityAt}` : '活動時刻未取得'
  if (state === 'running') return `Codex.appの稼働シグナルを確認中。${activity}`
  if (state === 'awaiting_approval') return `Codex.appは確認待ちです（${reason}）。${activity}`
  return `Codex.appは送信待ちです。${activity}`
}

function codexProgressSummary(input: {
  current: Record<string, unknown>
  state: CodexRunState | 'prompt_waiting'
  currentStep: string
  summary: string
  lastActivityAt: string | null
  nowIso: string
}) {
  const previous = asRecord(input.current.progress_summary)
  const previousProgressPercent = typeof previous.progress_percent === 'number'
    ? previous.progress_percent
    : null
  const state = input.state === 'running'
    ? 'running'
    : input.state === 'awaiting_approval'
      ? 'needs_review'
      : 'not_started'
  return {
    ...previous,
    state,
    progress_percent: input.state === 'awaiting_approval'
      ? 100
      : input.state === 'running'
        ? Math.max(10, Math.min(previousProgressPercent ?? 50, 95))
        : 0,
    summary: input.summary,
    current_step: input.currentStep,
    evidence: 'Focusmap synced the Codex.app thread and rollout from the local Codex state.',
    recommended_action: input.state === 'running'
      ? 'Codex.app側の実行完了を待ってください。'
      : input.state === 'awaiting_approval'
        ? 'Codexの返答を確認してください。'
        : 'Codex.appでプロンプトを送信してください。',
    can_mark_completed: input.state === 'awaiting_approval',
    confidence: typeof previous.confidence === 'number' ? Math.max(previous.confidence, 0.8) : 0.8,
    checked_at: input.nowIso,
    source: 'rule',
    last_activity_at: input.lastActivityAt,
    session_health: input.state === 'running' ? 'active' : input.state === 'awaiting_approval' ? 'stopped' : 'unknown',
  }
}

function codexClosureStep(reason: Extract<CodexReviewReason, 'archived' | 'thread_deleted' | 'thread_unavailable'>): string {
  if (reason === 'archived') return 'Codex threadがアーカイブされたため完了しました'
  if (reason === 'thread_unavailable') return 'Codex threadを一時的に確認できません'
  return 'Codex threadが削除されたため確認待ちです'
}

function codexClosureMessage(reason: Extract<CodexReviewReason, 'archived' | 'thread_deleted' | 'thread_unavailable'>): string {
  if (reason === 'archived') return 'Codex.app側でthreadがアーカイブされたため、Focusmapタスクを完了しました。'
  if (reason === 'thread_unavailable') return 'Codex.app側のthreadを一時的に確認できません。削除扱いにはせず、監視を継続します。'
  return 'Codex.app側でthreadが削除された可能性があります。内容確認が必要です。'
}

function upsertStep(steps: unknown[], nextStep: Record<string, unknown>) {
  const stepKey = typeof nextStep.key === 'string' ? nextStep.key : ''
  if (!stepKey) return [...steps, nextStep]
  const index = steps.findIndex(step => asRecord(step).key === stepKey)
  if (index < 0) return [...steps, nextStep]
  const next = [...steps]
  next[index] = nextStep
  return next
}

function threadMovedSinceLastSync(current: Record<string, unknown>, row: CodexThreadRow) {
  const previousSnapshot = asRecord(current.codex_thread_snapshot)
  const previousUpdatedAt = parseTimeMs(previousSnapshot.updated_at_ms)
  const nextUpdatedAt = parseTimeMs(row.updated_at_ms)
  return previousUpdatedAt != null && nextUpdatedAt != null && nextUpdatedAt > previousUpdatedAt
}

function visibleMessagesChanged(previous: unknown, next: Array<Record<string, unknown>>) {
  const normalize = (messages: unknown[]) => messages.map(message => {
    const record = asRecord(message)
    return {
      role: record.role ?? null,
      kind: record.kind ?? null,
      body: typeof record.body === 'string' ? record.body.trim() : '',
    }
  }).filter(message => message.body)

  const previousMessages = Array.isArray(previous) ? normalize(previous) : []
  const nextMessages = normalize(next)
  if (previousMessages.length !== nextMessages.length) return true
  return JSON.stringify(previousMessages) !== JSON.stringify(nextMessages)
}

function progressSummaryChanged(previous: unknown, next: Record<string, unknown>) {
  const current = asRecord(previous)
  return current.state !== next.state ||
    current.current_step !== next.current_step ||
    current.summary !== next.summary ||
    current.last_activity_at !== next.last_activity_at ||
    current.can_mark_completed !== next.can_mark_completed ||
    current.session_health !== next.session_health
}

async function mirrorCodexSyncToTurso(input: {
  task: CodexTaskRow
  status: 'running' | 'awaiting_approval' | 'needs_input' | 'completed'
  threadId: string | null
  currentStep: string
  summary: string
  codexState: CodexRunState | 'prompt_waiting'
  previousRunState: string | null
  hadThreadId: boolean
  resumedFromApproval: boolean
  completedAt?: string | null
}) {
  if (!isTursoConfigured()) return
  await upsertTursoAiTask({
    id: input.task.id,
    user_id: input.task.user_id,
    space_id: input.task.space_id,
    title: compactText(input.task.prompt, 140),
    status: input.status,
    executor: input.task.executor,
    source_type: input.task.source_task_id ? 'mindmap' : null,
    source_id: input.task.source_task_id,
    codex_thread_id: input.threadId,
    current_step: compactText(input.currentStep, MAX_CURRENT_STEP_CHARS),
    summary: compactText(input.summary, MAX_SUMMARY_CHARS),
    updated_at: new Date().toISOString(),
    started_at: input.status === 'running' ? new Date().toISOString() : null,
    completed_at: input.status === 'completed' ? (input.completedAt ?? new Date().toISOString()) : null,
  })

  const eventType = input.status === 'completed' && input.task.status !== 'completed'
    ? 'completed'
    : !input.hadThreadId && input.threadId
      ? 'thread_detected'
      : input.resumedFromApproval
        ? 'resumed'
        : input.previousRunState !== input.codexState
          ? input.status
          : null
  if (eventType) {
    await insertTaskEvent({
      task_id: input.task.id,
      user_id: input.task.user_id,
      event_type: eventType,
      payload_json: {
        status: input.status,
        codex_thread_id: input.threadId,
      },
    })
  }
}

type SourceTaskCompletionResult = {
  sourceTaskId: string | null
  completed: boolean
  alreadyCompleted: boolean
  missing: boolean
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

function codexClosureAlreadyRecorded(input: {
  task: CodexTaskRow
  threadId: string
  current: Record<string, unknown>
  reason: Extract<CodexReviewReason, 'archived' | 'thread_deleted' | 'thread_unavailable'>
  sourceTaskId: string | null
}) {
  const completesSourceTask = shouldCompleteSourceTaskForCodexReview(input.reason)
  if (!completesSourceTask) {
    if (input.task.status !== 'awaiting_approval') return false
    if (input.current.codex_review_reason !== input.reason) return false
    return codexTaskThreadId(input.task) === input.threadId
  }
  if (input.current.codex_source_task_completion_suppressed === true) {
    if (input.task.status !== 'awaiting_approval') return false
    if (input.current.codex_review_reason !== input.reason) return false
    return codexTaskThreadId(input.task) === input.threadId
  }
  if (input.task.status !== 'completed') return false
  if (input.current.codex_review_reason !== input.reason) return false
  if (codexTaskThreadId(input.task) !== input.threadId) return false
  if (!input.sourceTaskId) return true
  return input.current.codex_source_task_completed === true || input.current.codex_source_task_missing === true
}

async function completeSourceMindmapTaskForCodexClosure(
  supabase: SupabaseServerClient,
  task: CodexTaskRow,
  nowIso: string,
): Promise<SourceTaskCompletionResult> {
  const sourceTaskId = task.source_task_id?.trim() || null
  if (!sourceTaskId) {
    return { sourceTaskId: null, completed: false, alreadyCompleted: false, missing: false }
  }

  const { data, error } = await supabase
    .from('tasks')
    .select('id, status, stage')
    .eq('id', sourceTaskId)
    .eq('user_id', task.user_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    return { sourceTaskId, completed: false, alreadyCompleted: false, missing: true }
  }

  const current = asRecord(data)
  if (current.status === 'done' && current.stage === 'done') {
    return { sourceTaskId, completed: false, alreadyCompleted: true, missing: false }
  }

  const { error: updateError } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      stage: 'done',
      updated_at: nowIso,
    })
    .eq('id', sourceTaskId)
    .eq('user_id', task.user_id)
    .is('deleted_at', null)

  if (updateError) throw updateError
  return { sourceTaskId, completed: true, alreadyCompleted: false, missing: false }
}

async function persistCodexThreadClosure(input: {
  supabase: SupabaseServerClient
  task: CodexTaskRow
  threadId: string
  current: Record<string, unknown>
  reason: Extract<CodexReviewReason, 'archived' | 'thread_deleted' | 'thread_unavailable'>
  nowIso: string
  previousRunState: string | null
  hadThreadId: boolean
  row?: CodexThreadRow | null
  visibleActivityEvents?: Array<{
    role: AiTaskActivityRole
    kind: AiTaskActivityKind
    body: string
    dedupeKey: string
    importance?: 'normal' | 'important'
    createdAt?: string | null
  }>
}) {
  const {
    supabase,
    task,
    threadId,
    current,
    reason,
    nowIso,
    previousRunState,
    hadThreadId,
    row = null,
    visibleActivityEvents = [],
  } = input
  const sourceTaskId = task.source_task_id?.trim() || null
  const sourceCompletionSuppressed = current.codex_source_task_completion_suppressed === true
  const shouldCompleteSourceTask = shouldCompleteSourceTaskForCodexReview(reason)
  const alreadyPersisted = codexClosureAlreadyRecorded({
    task,
    threadId,
    current,
    reason,
    sourceTaskId,
  })

  let sourceTaskCompletion: SourceTaskCompletionResult = {
    sourceTaskId,
    completed: false,
    alreadyCompleted: alreadyPersisted && current.codex_source_task_completed === true,
    missing: alreadyPersisted && current.codex_source_task_missing === true,
  }

  if (!alreadyPersisted && !sourceCompletionSuppressed && shouldCompleteSourceTask) {
    sourceTaskCompletion = await completeSourceMindmapTaskForCodexClosure(supabase, task, nowIso)
  }

  const sourceTaskCompleted = shouldCompleteSourceTask && (sourceTaskCompletion.completed || sourceTaskCompletion.alreadyCompleted)
  const nextAiTaskStatus = shouldCompleteSourceTask && !sourceCompletionSuppressed ? 'completed' : 'awaiting_approval'
  const currentStep = sourceCompletionSuppressed
    ? 'Codex thread終了。内容を確認してください'
    : codexClosureStep(reason)
  const message = sourceCompletionSuppressed
    ? 'Codex threadは終了済みです。ノードは未完了に戻されているため確認待ちです。'
    : codexClosureMessage(reason)
  const stepsBase = Array.isArray(current.steps) ? current.steps : []
  const stepsWithThread = upsertStep(stepsBase, {
    key: 'thread_visible',
    label: `Codex.app thread検出 (${threadId.slice(0, 8)})`,
    status: 'done',
    at: nowIso,
  })
  const steps = upsertStep(stepsWithThread, {
    key: 'source_task_completed',
    label: sourceTaskCompleted ? 'Focusmapノード完了' : 'Codex thread終了',
    status: sourceTaskCompleted ? 'done' : 'active',
    at: nowIso,
  })
  const compactVisibleMessages = visibleActivityEvents.map(event => ({
    role: event.role,
    kind: event.kind,
    body: event.body,
    importance: event.importance ?? 'normal',
    created_at: event.createdAt ?? nowIso,
  }))
  const shouldPersistVisibleMessagesFallback =
    compactVisibleMessages.length > 0 &&
    visibleMessagesChanged(current.codex_visible_messages, compactVisibleMessages) &&
    !isTursoConfigured()

  const result = {
    ...current,
    executor: task.executor,
    codex_manual_handoff: current.codex_manual_handoff === true,
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: 'awaiting_approval',
    codex_review_reason: reason,
    codex_source_task_completed: sourceTaskCompleted,
    codex_source_task_id: sourceTaskCompletion.sourceTaskId,
    codex_source_task_completion_reason: reason,
    codex_source_task_completion_suppressed: sourceCompletionSuppressed,
    codex_source_task_missing: sourceTaskCompletion.missing,
    codex_last_checked_at: nowIso,
    last_activity_at: row ? threadUpdatedAtIso(row) ?? nowIso : nowIso,
    live_log: undefined,
    message,
    current_step: currentStep,
    ...(shouldPersistVisibleMessagesFallback
      ? { codex_visible_messages: compactVisibleMessages }
      : Array.isArray(current.codex_visible_messages)
        ? { codex_visible_messages: current.codex_visible_messages }
        : {}),
    session_health: 'stopped',
    awaiting_approval_at: typeof current.awaiting_approval_at === 'string' ? current.awaiting_approval_at : nowIso,
    ...(row
      ? {
          codex_thread_snapshot: {
            title: row.title ?? null,
            preview: null,
            preview_chars: typeof row.preview === 'string' ? row.preview.length : 0,
            tokens_used: row.tokens_used ?? null,
            has_user_event: row.has_user_event ?? null,
            archived: row.archived === 1 || row.archived === true,
            updated_at_ms: row.updated_at_ms ?? null,
            source: row.source ?? null,
            cwd: row.cwd ?? null,
          },
        }
      : {}),
    steps,
  }

  if (!alreadyPersisted || shouldPersistVisibleMessagesFallback) {
    const { error: updateError } = await supabase
      .from('ai_tasks')
      .update({
        status: nextAiTaskStatus,
        completed_at: nextAiTaskStatus === 'completed' ? nowIso : null,
        codex_thread_id: threadId,
        result,
      })
      .eq('id', task.id)

    if (updateError) throw updateError

    try {
      await mirrorCodexSyncToTurso({
        task,
        status: nextAiTaskStatus,
        threadId,
        currentStep,
        summary: message,
        codexState: 'awaiting_approval',
        previousRunState,
        hadThreadId,
        resumedFromApproval: false,
        completedAt: nextAiTaskStatus === 'completed' ? nowIso : null,
      })
    } catch (tursoError) {
      console.error('[codex/sync-node turso closure]', tursoError)
    }

    const activityEvents: Array<{
      role: AiTaskActivityRole
      kind: AiTaskActivityKind
      body: string
      dedupeKey: string
      importance?: 'normal' | 'important'
      createdAt?: string | null
    }> = [
      ...visibleActivityEvents,
      {
        role: 'status',
        kind: nextAiTaskStatus === 'completed' ? 'completed' : 'approval',
        body: message,
        dedupeKey: `thread:${threadId}:closed:${reason}`,
        importance: 'important',
        createdAt: nowIso,
      },
    ]

    await Promise.all(activityEvents.map(event => insertAiTaskActivityMessage(supabase, {
      taskId: task.id,
      userId: task.user_id,
      role: event.role,
      kind: event.kind,
      body: event.body,
      importance: event.importance,
      dedupeKey: event.dedupeKey,
      createdAt: event.createdAt ?? undefined,
    })))
  }

  return {
    persisted: !alreadyPersisted || shouldPersistVisibleMessagesFallback,
    status: nextAiTaskStatus,
    sourceTaskCompleted,
    sourceTaskId: sourceTaskCompletion.sourceTaskId,
    sourceTaskMissing: sourceTaskCompletion.missing,
  }
}

export async function POST(req: NextRequest) {
  if (!canUseLocalSync(req)) {
    return NextResponse.json(
      { error: 'Codex.app の状態同期はローカル環境からのみ利用できます' },
      { status: 403 },
    )
  }
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'Codex.app の状態同期は macOS でのみ利用できます' }, { status: 400 })
  }

  const dbPath = resolveCodexStateDbPath()
  if (!dbPath) {
    return NextResponse.json({ error: 'Codex state DB が見つかりません' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as SyncNodeBody
  const sourceTaskId = typeof body.source_task_id === 'string' ? body.source_task_id.trim() : ''
  const aiTaskId = typeof body.ai_task_id === 'string' ? body.ai_task_id.trim() : ''
  const includeVisibleActivity = body.include_visible_activity === true
  if (!sourceTaskId && !aiTaskId) {
    return NextResponse.json({ error: 'source_task_id or ai_task_id required' }, { status: 400 })
  }

  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  let query = supabase
    .from('ai_tasks')
    .select('id, user_id, space_id, prompt, codex_thread_id, cwd, result, status, started_at, created_at, source_task_id, executor')
    .eq('user_id', user.id)
    .in('executor', ['codex', 'codex_app'])
    .order('created_at', { ascending: false })
    .limit(1)

  query = aiTaskId
    ? query.eq('id', aiTaskId)
    : query.eq('source_task_id', sourceTaskId)

  const { data: tasks, error } = await query
  if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 })
  const task = (tasks?.[0] ?? null) as CodexTaskRow | null
  if (!task) return NextResponse.json({ task: null, synced: false })

  const nowIso = new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const current = asRecord(task.result)
  const previousRunState = typeof current.codex_run_state === 'string' ? current.codex_run_state : null
  const wasAwaitingApproval =
    task.status === 'awaiting_approval' ||
    task.status === 'needs_input' ||
    previousRunState === 'awaiting_approval'
  const hadThreadId = Boolean(codexTaskThreadId(task))
  let threadId = codexTaskThreadId(task)

  if (!threadId) {
    threadId = await findMatchingCodexThread(dbPath, task)
    if (!threadId) {
      return NextResponse.json({
        task_id: task.id,
        thread_id: null,
        state: 'prompt_waiting',
        synced: true,
        persisted: false,
        checked_at: nowIso,
      })
    }
  }

  const row = await readCodexThread(dbPath, threadId)
  if (!row) {
    try {
      const closure = await persistCodexThreadClosure({
        supabase,
        task,
        threadId,
        current,
        reason: 'thread_unavailable',
        nowIso,
        previousRunState,
        hadThreadId,
      })
      return NextResponse.json({
        task_id: task.id,
        thread_id: threadId,
        state: closure.status,
        synced: true,
        persisted: closure.persisted,
        source_task_completed: closure.sourceTaskCompleted,
        source_task_id: closure.sourceTaskId,
        source_task_missing: closure.sourceTaskMissing,
      })
    } catch (closureError) {
      console.error('[codex/sync-node closure thread_unavailable]', closureError)
      return NextResponse.json({ error: 'Codex thread closure sync failed' }, { status: 500 })
    }
  }

  let rolloutRaw = ''
  if (row.rollout_path && fs.existsSync(row.rollout_path)) {
    rolloutRaw = fs.readFileSync(row.rollout_path, 'utf-8')
  }

  const archived = row.archived === 1 || row.archived === true
  const parsed = parseCodexRollout(rolloutRaw, { archived, snapshot: row })
  if (archived && shouldCompleteSourceTaskForCodexReview('archived')) {
    const visibleActivityEventsForClosure = visibleCodexActivityEvents(row, parsed, task)
    try {
      const closure = await persistCodexThreadClosure({
        supabase,
        task,
        threadId,
        current,
        reason: 'archived',
        nowIso,
        previousRunState,
        hadThreadId,
        row,
        visibleActivityEvents: visibleActivityEventsForClosure,
      })
      return NextResponse.json({
        task_id: task.id,
        thread_id: threadId,
        state: closure.status,
        synced: true,
        persisted: closure.persisted,
        source_task_completed: closure.sourceTaskCompleted,
        source_task_id: closure.sourceTaskId,
        source_task_missing: closure.sourceTaskMissing,
      })
    } catch (closureError) {
      console.error('[codex/sync-node closure archived]', closureError)
      return NextResponse.json({ error: 'Codex thread closure sync failed' }, { status: 500 })
    }
  }
  const sentInCodex = parsed.sawTaskStarted || parsed.sawTerminalEvent
  const resumedFromApproval = wasAwaitingApproval && detectCodexResumeAfterApproval(
    parsed,
    current.awaiting_approval_at,
  )
  const visibleCodexOutput = hasVisibleCodexOutput(row, parsed, task)
  const threadMoved = threadMovedSinceLastSync(current, row)
  const codexState: CodexRunState = resumedFromApproval
    ? 'running'
    : sentInCodex
      ? parsed.state
      : visibleCodexOutput
        ? (threadMoved ? 'running' : 'awaiting_approval')
        : 'prompt_waiting'
  const reviewReason: CodexReviewReason = resumedFromApproval
    ? 'started'
    : sentInCodex
      ? parsed.reviewReason
      : visibleCodexOutput
        ? 'completed'
        : 'manual_handoff'
  const currentStep = codexPulseStep(codexState, reviewReason)
  const lastActivityAt = parsed.lastActivityAt ?? threadUpdatedAtIso(row) ?? (typeof current.last_activity_at === 'string' ? current.last_activity_at : nowIso)
  const summary = codexPulseSummary(codexState, reviewReason, lastActivityAt)
  const shouldPrefetchVisibleActivity =
    codexState === 'awaiting_approval' &&
    task.status !== 'awaiting_approval' &&
    previousRunState !== 'awaiting_approval' &&
    !resumedFromApproval
  const shouldCollectVisibleActivity = includeVisibleActivity || shouldPrefetchVisibleActivity
  const visibleActivityEventsForResult = shouldCollectVisibleActivity
    ? visibleCodexActivityEvents(row, parsed, task)
    : []
  const compactVisibleMessages = visibleActivityEventsForResult.map(event => ({
    role: event.role,
    kind: event.kind,
    body: event.body,
    importance: event.importance ?? 'normal',
    created_at: event.createdAt ?? nowIso,
  }))
  const shouldUpdateVisibleMessages =
    shouldCollectVisibleActivity &&
    visibleMessagesChanged(current.codex_visible_messages, compactVisibleMessages)
  const shouldPersistVisibleMessagesFallback =
    shouldUpdateVisibleMessages &&
    !isTursoConfigured()

  const nextStatus =
    codexState === 'prompt_waiting'
      ? 'needs_input'
      : codexState === 'running'
        ? 'running'
        : 'awaiting_approval'

  const steps = Array.isArray(current.steps) ? [...current.steps] : []
  if (!steps.some(step => asRecord(step).key === 'thread_visible')) {
    steps.push({
      key: 'thread_visible',
      label: `Codex.app thread検出 (${threadId.slice(0, 8)})`,
      status: 'done',
      at: nowIso,
    })
  }
  if (codexState === 'running' && !steps.some(step => asRecord(step).key === 'turn_started')) {
    steps.push({ key: 'turn_started', label: 'Codex.appで実行中', status: 'active', at: nowIso })
  }
  if (codexState === 'awaiting_approval') {
    const completedIndex = steps.findIndex(step => asRecord(step).key === 'completed')
    const completedStep = {
      key: 'completed',
      label: reviewReasonLabel(parsed.reviewReason),
      status: 'active',
      at: nowIso,
    }
    if (completedIndex >= 0) steps[completedIndex] = completedStep
    else steps.push(completedStep)
  }

  const shouldRecordProgress = codexState === 'running' && shouldWriteProgressActivity(current, currentStep, nowMs)
  const nextProgressSummary = codexProgressSummary({
    current,
    state: codexState,
    currentStep,
    summary,
    lastActivityAt,
    nowIso,
  })
  const result = {
    ...current,
    executor: task.executor,
    codex_manual_handoff: current.codex_manual_handoff === true,
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: codexState,
    codex_review_reason: reviewReason,
    codex_last_checked_at: nowIso,
    last_activity_at: lastActivityAt,
    live_log: undefined,
    message: codexState === 'awaiting_approval'
      ? 'Codex セッションは確認待ちです。内容を確認して完了にしてください。'
      : summary,
    current_step: currentStep,
    progress_summary: nextProgressSummary,
    ...(shouldPersistVisibleMessagesFallback
      ? { codex_visible_messages: compactVisibleMessages }
      : Array.isArray(current.codex_visible_messages)
        ? { codex_visible_messages: current.codex_visible_messages }
        : {}),
    session_health: codexState === 'running' ? 'active' : codexState === 'awaiting_approval' ? 'stopped' : 'unknown',
    awaiting_approval_at: codexState === 'awaiting_approval'
      ? (typeof current.awaiting_approval_at === 'string' ? current.awaiting_approval_at : nowIso)
      : null,
    codex_thread_snapshot: {
      title: row.title ?? null,
      preview: null,
      preview_chars: typeof row.preview === 'string' ? row.preview.length : 0,
      tokens_used: row.tokens_used ?? null,
      has_user_event: row.has_user_event ?? null,
      archived,
      updated_at_ms: row.updated_at_ms ?? null,
      source: row.source ?? null,
      cwd: row.cwd ?? null,
    },
    ...(shouldRecordProgress
      ? {
          codex_activity_last_progress_step: currentStep,
          codex_activity_last_progress_at: nowIso,
        }
      : {}),
    steps,
  }

  const shouldUpdateSupabase =
    nextStatus !== task.status ||
    !hadThreadId ||
    resumedFromApproval ||
    previousRunState !== codexState ||
    current.current_step !== currentStep ||
    progressSummaryChanged(current.progress_summary, nextProgressSummary) ||
    shouldPersistVisibleMessagesFallback

  if (shouldUpdateSupabase) {
    const { error: updateError } = await supabase
      .from('ai_tasks')
      .update({
        status: nextStatus,
        started_at: task.started_at ?? nowIso,
        codex_thread_id: threadId,
        result,
      })
      .eq('id', task.id)

    if (updateError) {
      console.error('[codex/sync-node update]', updateError.message)
      return NextResponse.json({ error: 'Codex state update failed' }, { status: 500 })
    }
  }

  const shouldMirrorToTurso =
    !hadThreadId ||
    resumedFromApproval ||
    previousRunState !== codexState ||
    current.current_step !== currentStep

  if (shouldMirrorToTurso) {
    try {
      await mirrorCodexSyncToTurso({
        task,
        status: nextStatus,
        threadId,
        currentStep,
        summary,
        codexState,
        previousRunState,
        hadThreadId,
        resumedFromApproval,
      })
    } catch (tursoError) {
      console.error('[codex/sync-node turso]', tursoError)
    }
  }

  const activityEvents: Array<{
    role: AiTaskActivityRole
    kind: AiTaskActivityKind
    body: string
    dedupeKey: string
    importance?: 'normal' | 'important'
    createdAt?: string | null
  }> = []

  if (!hadThreadId && (!wasAwaitingApproval || resumedFromApproval)) {
    activityEvents.push({
      role: 'status',
      kind: 'sent',
      body: `Codex threadを検出しました (${threadId.slice(0, 8)})`,
      dedupeKey: `thread:${threadId}:sent`,
    })
  }

  if (resumedFromApproval) {
    activityEvents.push({
      role: 'status',
      kind: 'resumed',
      body: '確認待ち後の追加プロンプトを検知しました。Codex実行を再開します。',
      dedupeKey: `thread:${threadId}:resumed:${textFingerprint(String(current.awaiting_approval_at ?? ''))}`,
    })
  } else if (previousRunState !== codexState) {
    if (codexState === 'running') {
      activityEvents.push({
        role: 'status',
        kind: 'progress',
        body: 'Codex実行を開始しました。',
        dedupeKey: `thread:${threadId}:running`,
        importance: 'important',
      })
    } else if (codexState === 'awaiting_approval' && !wasAwaitingApproval) {
      const reviewActivity = activityForReviewReason(reviewReason)
      if (reviewActivity) {
        activityEvents.push({
          ...reviewActivity,
          dedupeKey: `thread:${threadId}:review:${reviewReason}`,
        })
      }
    }
  }

  if (shouldCollectVisibleActivity) {
    for (const visibleActivityEvent of visibleActivityEventsForResult) {
      if (!activityEvents.some(event => textFingerprint(event.body) === textFingerprint(visibleActivityEvent.body))) {
        activityEvents.push(visibleActivityEvent)
      }
    }
  }

  if (
    codexState === 'running' &&
    !resumedFromApproval &&
    activityEvents.length === 0 &&
    shouldWriteProgressActivity(current, currentStep, nowMs)
  ) {
    activityEvents.push({
      role: 'codex',
      kind: 'progress',
      body: currentStep,
      dedupeKey: `thread:${threadId}:progress:${textFingerprint(currentStep)}:${Math.floor(nowMs / CODEX_PROGRESS_ACTIVITY_INTERVAL_MS)}`,
      importance: 'normal',
    })
  }

  await Promise.all(activityEvents.map(event => insertAiTaskActivityMessage(supabase, {
    taskId: task.id,
    userId: task.user_id,
    role: event.role,
    kind: event.kind,
    body: event.body,
    importance: event.importance,
    dedupeKey: event.dedupeKey,
    createdAt: event.createdAt ?? undefined,
  })))

  return NextResponse.json({
    task_id: task.id,
    thread_id: threadId,
    state: codexState,
    synced: true,
  })
}
