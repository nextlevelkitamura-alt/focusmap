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
import { isLocalCodexOpenHost } from '@/lib/codex-app-launch'
import {
  detectCodexResumeAfterApproval,
  parseCodexRollout,
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
const CODEX_LAST_CHECKED_WRITE_INTERVAL_MS = 30_000
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
  prompt: string
  codex_thread_id: string | null
  cwd: string | null
  result: Record<string, unknown> | null
  status: string
  started_at: string | null
  created_at: string | null
  executor: 'codex' | 'codex_app'
}

type CodexThreadRow = CodexThreadSnapshot & {
  id: string
  first_user_message?: string | null
}

function canUseLocalSync(req: NextRequest): boolean {
  if (process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_SYNC === 'true') return true
  return isLocalCodexOpenHost(req.nextUrl.hostname)
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
} {
  if (reason === 'completed') {
    return { kind: 'completed', role: 'codex', body: 'Codexの実行が完了しました。結果確認待ちです。' }
  }
  if (reason === 'approval_requested') {
    return { kind: 'approval', role: 'codex', body: 'Codexが承認を待っています。内容を確認してください。' }
  }
  if (reason === 'aborted' || reason === 'monitoring_lost' || reason === 'thread_deleted') {
    return { kind: 'failed', role: 'status', body: 'Codexの実行が停止しました。Codex.app側の状態確認が必要です。' }
  }
  return { kind: 'approval', role: 'status', body: 'Codexセッションは確認待ちです。' }
}

function reviewReasonLabel(reason: CodexReviewReason): string {
  if (reason === 'completed') return '完了確認'
  if (reason === 'approval_requested') return '承認待ち'
  if (reason === 'manual_handoff') return 'プロンプト待ち'
  if (reason === 'monitoring_lost') return '同期確認'
  if (reason === 'thread_deleted') return 'スレッド確認'
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

function shouldWriteLastChecked(current: Record<string, unknown>, nowMs: number) {
  const lastCheckedMs = parseTimeMs(current.codex_last_checked_at)
  return lastCheckedMs == null || nowMs - lastCheckedMs >= CODEX_LAST_CHECKED_WRITE_INTERVAL_MS
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

async function mirrorCodexSyncToTurso(input: {
  task: CodexTaskRow
  status: 'running' | 'awaiting_approval' | 'needs_input'
  threadId: string | null
  currentStep: string
  summary: string
  codexState: CodexRunState | 'prompt_waiting'
  previousRunState: string | null
  hadThreadId: boolean
  resumedFromApproval: boolean
}) {
  if (!isTursoConfigured()) return
  await upsertTursoAiTask({
    id: input.task.id,
    user_id: input.task.user_id,
    status: input.status,
    executor: input.task.executor,
    codex_thread_id: input.threadId,
    current_step: compactText(input.currentStep, MAX_CURRENT_STEP_CHARS),
    summary: compactText(input.summary, MAX_SUMMARY_CHARS),
    updated_at: new Date().toISOString(),
    started_at: input.status === 'running' ? new Date().toISOString() : null,
  })

  const eventType = !input.hadThreadId && input.threadId
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

  const dbPath = path.join(os.homedir(), '.codex', 'state_5.sqlite')
  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: '~/.codex/state_5.sqlite が見つかりません' }, { status: 404 })
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
    .select('id, user_id, prompt, codex_thread_id, cwd, result, status, started_at, created_at, executor')
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
      if (shouldWriteLastChecked(current, nowMs)) {
        await supabase
          .from('ai_tasks')
          .update({
            result: {
              ...current,
              codex_last_checked_at: nowIso,
            },
          })
          .eq('id', task.id)
      }
      return NextResponse.json({ task_id: task.id, thread_id: null, state: 'prompt_waiting', synced: true })
    }
  }

  const row = await readCodexThread(dbPath, threadId)
  if (!row) {
    if (!wasAwaitingApproval) {
      await insertAiTaskActivityMessage(supabase, {
        taskId: task.id,
        userId: task.user_id,
        role: 'status',
        kind: 'failed',
        body: 'Codex threadが見つかりません。Codex.app側の状態確認が必要です。',
        dedupeKey: `thread:${threadId}:deleted`,
      })
    }

    await supabase
      .from('ai_tasks')
      .update({
        status: 'awaiting_approval',
        result: {
          ...current,
          codex_thread_id: threadId,
          codex_run_state: 'awaiting_approval',
          codex_review_reason: 'thread_deleted',
          codex_last_checked_at: nowIso,
          current_step: 'Codex threadが見つかりません',
          live_log: undefined,
          message: 'Codex thread が見つかりません。Codex.app側の状態確認が必要です。',
        },
      })
      .eq('id', task.id)
    return NextResponse.json({ task_id: task.id, thread_id: threadId, state: 'awaiting_approval', synced: true })
  }

  let rolloutRaw = ''
  if (row.rollout_path && fs.existsSync(row.rollout_path)) {
    rolloutRaw = fs.readFileSync(row.rollout_path, 'utf-8')
  }

  const archived = row.archived === 1 || row.archived === true
  const parsed = parseCodexRollout(rolloutRaw, { archived, snapshot: row })
  const sentInCodex = parsed.sawTaskStarted || parsed.sawTerminalEvent
  const resumedFromApproval = wasAwaitingApproval && detectCodexResumeAfterApproval(
    parsed,
    current.awaiting_approval_at,
    row,
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
  const visibleActivityEventsForResult = includeVisibleActivity
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
    includeVisibleActivity &&
    visibleMessagesChanged(current.codex_visible_messages, compactVisibleMessages)

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
    ...(includeVisibleActivity
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
    threadMoved ||
    previousRunState !== codexState ||
    current.current_step !== currentStep ||
    current.last_activity_at !== lastActivityAt ||
    shouldUpdateVisibleMessages ||
    shouldRecordProgress ||
    shouldWriteLastChecked(current, nowMs)

  if (shouldUpdateSupabase) {
    await supabase
      .from('ai_tasks')
      .update({
        status: nextStatus,
        started_at: task.started_at ?? nowIso,
        codex_thread_id: threadId,
        result,
      })
      .eq('id', task.id)
  }

  const shouldMirrorToTurso =
    !hadThreadId ||
    resumedFromApproval ||
    threadMoved ||
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
      activityEvents.push({
        ...reviewActivity,
        dedupeKey: `thread:${threadId}:review:${reviewReason}`,
      })
    }
  }

  if (includeVisibleActivity && codexState === 'awaiting_approval' && !wasAwaitingApproval && parsed.latestQuestion) {
    activityEvents.push({
      role: 'codex',
      kind: 'question',
      body: parsed.latestQuestion,
      dedupeKey: `thread:${threadId}:question:${textFingerprint(parsed.latestQuestion)}`,
    })
  }

  if (includeVisibleActivity) {
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
  })))

  return NextResponse.json({
    task_id: task.id,
    thread_id: threadId,
    state: codexState,
    synced: true,
  })
}
