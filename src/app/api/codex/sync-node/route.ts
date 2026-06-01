import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { NextRequest, NextResponse } from 'next/server'
import { isLocalCodexOpenHost } from '@/lib/codex-app-launch'
import { parseCodexRollout, type CodexRunState, type CodexThreadSnapshot } from '@/lib/codex-run-state'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const SQLITE_BIN = '/usr/bin/sqlite3'

type SyncNodeBody = {
  source_task_id?: unknown
  ai_task_id?: unknown
}

type CodexTaskRow = {
  id: string
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

function buildFallbackLog(row: CodexThreadRow): string {
  return [
    `Codex thread ${row.id.slice(0, 8)}`,
    `タイトル: ${row.title ?? '(未設定)'}`,
    `最終更新: ${row.updated_at_ms ? new Date(row.updated_at_ms).toLocaleString('ja-JP') : '(未更新)'}`,
    '',
    row.preview ?? '',
  ].filter(Boolean).join('\n')
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
  if (!sourceTaskId && !aiTaskId) {
    return NextResponse.json({ error: 'source_task_id or ai_task_id required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let query = supabase
    .from('ai_tasks')
    .select('id, prompt, codex_thread_id, cwd, result, status, started_at, created_at, executor')
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
  const current = asRecord(task.result)
  let threadId = codexTaskThreadId(task)

  if (!threadId) {
    threadId = await findMatchingCodexThread(dbPath, task)
    if (!threadId) {
      await supabase
        .from('ai_tasks')
        .update({
          result: {
            ...current,
            codex_last_checked_at: nowIso,
          },
        })
        .eq('id', task.id)
      return NextResponse.json({ task_id: task.id, thread_id: null, state: 'prompt_waiting', synced: true })
    }
  }

  const row = await readCodexThread(dbPath, threadId)
  if (!row) {
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
          live_log: 'Codex thread が見つかりません。Codex.app側の状態確認が必要です。',
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
  const codexState: CodexRunState = sentInCodex ? parsed.state : 'prompt_waiting'
  const liveLog = sentInCodex
    ? (parsed.liveLog || buildFallbackLog(row))
    : (typeof current.live_log === 'string' ? current.live_log : 'プロンプト待ち。Codex.appで送信されると、Focusmapはthread状態とログを同期します。')

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
      label: `確認待ち（${parsed.reviewReason}）`,
      status: 'active',
      at: nowIso,
    }
    if (completedIndex >= 0) steps[completedIndex] = completedStep
    else steps.push(completedStep)
  }

  await supabase
    .from('ai_tasks')
    .update({
      status: nextStatus,
      started_at: task.started_at ?? nowIso,
      codex_thread_id: threadId,
      result: {
        ...current,
        executor: task.executor,
        codex_manual_handoff: current.codex_manual_handoff === true,
        codex_thread_id: threadId,
        codex_thread_url: `codex://threads/${threadId}`,
        codex_run_state: codexState,
        codex_review_reason: sentInCodex ? parsed.reviewReason : 'manual_handoff',
        codex_last_checked_at: nowIso,
        last_activity_at: parsed.lastActivityAt ?? nowIso,
        live_log: liveLog,
        message: codexState === 'awaiting_approval'
          ? `Codex セッションは確認待ちです。内容を確認して完了にしてください。\n\n${liveLog}`
          : liveLog,
        session_health: codexState === 'running' ? 'active' : codexState === 'awaiting_approval' ? 'stopped' : 'unknown',
        codex_thread_snapshot: {
          title: row.title ?? null,
          preview: row.preview ?? null,
          tokens_used: row.tokens_used ?? null,
          has_user_event: row.has_user_event ?? null,
          archived,
          updated_at_ms: row.updated_at_ms ?? null,
          source: row.source ?? null,
          cwd: row.cwd ?? null,
        },
        steps,
      },
    })
    .eq('id', task.id)

  return NextResponse.json({
    task_id: task.id,
    thread_id: threadId,
    state: codexState,
    synced: true,
  })
}
