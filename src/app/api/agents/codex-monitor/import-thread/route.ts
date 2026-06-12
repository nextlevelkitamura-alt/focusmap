import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import { formatBillingCycle } from '@/lib/format'
import { isTursoConfigured } from '@/lib/turso/client'
import { upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

const CODEX_INBOX_GROUP_TITLE = 'Codex Inbox'
const MAX_PROMPT_CHARS = 8_000
const FOCUSMAP_HANDOFF_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000
const PROMPT_MATCH_PREFIX_CHARS = 500
const MIN_PROMPT_MATCH_CHARS = 120

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

export type ImportedCodexThread = {
  id: string
  title?: string | null
  preview?: string | null
  first_user_message?: string | null
  cwd?: string | null
  updated_at_ms?: number | null
}

type TargetProject = {
  id: string
  space_id: string | null
  title?: string | null
  repo_path?: string | null
  codex_thread_import_enabled_since?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max = 2_000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function promptMatchText(value: unknown) {
  return compactString(value, MAX_PROMPT_CHARS)
    ?.toLowerCase()
    .replace(/\s+/g, ' ') ?? ''
}

function promptsLikelyMatch(leftValue: unknown, rightValue: unknown) {
  const left = promptMatchText(leftValue)
  const right = promptMatchText(rightValue)
  if (!left || !right) return false
  if (left === right) return true

  const prefixLength = Math.min(PROMPT_MATCH_PREFIX_CHARS, left.length, right.length)
  return prefixLength >= MIN_PROMPT_MATCH_CHARS &&
    left.slice(0, prefixLength) === right.slice(0, prefixLength)
}

function parseThreadId(value: unknown) {
  const text = compactString(value, 200)
  if (!text || !/^[A-Za-z0-9._:-]{8,200}$/.test(text)) return null
  return text
}

function parseThread(input: unknown): ImportedCodexThread | null {
  const record = isRecord(input) ? input : {}
  const id = parseThreadId(record.id)
  if (!id) return null
  const updatedAtMs = typeof record.updated_at_ms === 'number' && Number.isFinite(record.updated_at_ms)
    ? record.updated_at_ms
    : null
  return {
    id,
    title: compactString(record.title, 240),
    preview: compactString(record.preview, 2_000),
    first_user_message: compactString(record.first_user_message, MAX_PROMPT_CHARS),
    cwd: compactString(record.cwd, 500),
    updated_at_ms: updatedAtMs,
  }
}

export function titleFromImportedThread(thread: ImportedCodexThread) {
  const threadTitle = compactString(thread.title, 240)
  if (threadTitle && !looksLikeRawPromptTitle(threadTitle)) {
    const normalizedTitle = oneLineTitle(threadTitle)
    if (normalizedTitle) return normalizedTitle
  }

  const promptTitle = oneLineTitle(firstNonEmptyLine(thread.first_user_message))
  if (promptTitle) return promptTitle

  const previewTitle = oneLineTitle(thread.preview)
  if (previewTitle) return previewTitle

  const fallbackTitle = oneLineTitle(threadTitle)
  if (fallbackTitle) return fallbackTitle
  return `Codex thread ${thread.id.slice(0, 8)}`
}

export function promptFromImportedThread(thread: ImportedCodexThread) {
  return compactString(thread.first_user_message, MAX_PROMPT_CHARS)
    ?? compactString(thread.preview, MAX_PROMPT_CHARS)
    ?? compactString(thread.title, MAX_PROMPT_CHARS)
    ?? `Codex thread ${thread.id}`
}

export function memoFromImportedThread(thread: ImportedCodexThread) {
  const lines = [
    `# ${titleFromImportedThread(thread)}`,
    '',
    '## 取り込み情報',
    `- Thread ID: ${thread.id}`,
    `- Repository: ${thread.cwd ?? 'unknown'}`,
    `- 最終更新: ${threadUpdatedAtIso(thread)}`,
  ]
  const firstUserMessage = compactString(thread.first_user_message, MAX_PROMPT_CHARS)
  if (firstUserMessage) {
    lines.push('', '## 初回依頼', firstUserMessage)
  }
  const preview = compactString(thread.preview, MAX_PROMPT_CHARS)
  if (preview && preview !== firstUserMessage) {
    lines.push('', '## 最新プレビュー', preview)
  }
  return lines.join('\n')
}

export function threadUpdatedAtIso(thread: ImportedCodexThread, fallback = new Date()) {
  if (typeof thread.updated_at_ms === 'number' && Number.isFinite(thread.updated_at_ms) && thread.updated_at_ms > 0) {
    return new Date(thread.updated_at_ms).toISOString()
  }
  return fallback.toISOString()
}

export function importedThreadResult(thread: ImportedCodexThread, sourceTaskId: string, nowIso: string) {
  const lastActivityAt = threadUpdatedAtIso(thread, new Date(nowIso))
  return {
    executor: 'codex_app',
    codex_manual_handoff: false,
    codex_external_origin: 'codex_app_thread_import',
    codex_thread_id: thread.id,
    codex_thread_url: `codex://threads/${thread.id}`,
    codex_run_state: 'running',
    codex_review_reason: 'external_thread_import',
    codex_source_task_id: sourceTaskId,
    current_step: 'Codex.appで開始されたスレッドを取り込みました',
    message: 'Codex.appで直接開始されたスレッドをFocusmapへ取り込みました。',
    last_activity_at: lastActivityAt,
    steps: [
      {
        key: 'thread_imported',
        label: 'Codex.app thread 取り込み',
        status: 'done',
        at: nowIso,
      },
    ],
    meta: {
      imported_by: 'focusmap-agent',
      thread_title: thread.title ?? null,
      thread_preview_chars: thread.preview?.length ?? 0,
      cwd: thread.cwd ?? null,
    },
  }
}

function firstNonEmptyLine(value: unknown) {
  if (typeof value !== 'string') return null
  return value.split('\n').map(line => line.trim()).find(Boolean) ?? null
}

function oneLineTitle(value: unknown, max = 80) {
  const text = compactString(value, 240)
  if (!text) return null
  return text.replace(/\s+/g, ' ').slice(0, max)
}

function looksLikeRawPromptTitle(value: string) {
  const text = value.trim()
  if (!text) return false
  if (text.includes('\n')) return true
  if (text.length > 90) return true
  return text.startsWith('# AGENTS.md instructions') || text.includes('<environment_context>')
}

function timeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function isThreadNearManualHandoffTime(thread: ImportedCodexThread, task: Record<string, unknown>) {
  const threadMs = timeMs(thread.updated_at_ms)
  const taskMs = timeMs(task.started_at) ?? timeMs(task.created_at)
  if (threadMs === null || taskMs === null) return true
  return threadMs >= taskMs - 5 * 60 * 1000 &&
    threadMs - taskMs <= FOCUSMAP_HANDOFF_THREAD_WINDOW_MS
}

export function isImportedThreadMatchingManualHandoff(
  thread: ImportedCodexThread,
  task: Record<string, unknown>,
) {
  const firstUserMessage = compactString(thread.first_user_message, MAX_PROMPT_CHARS)
  if (!firstUserMessage || isInternalCodexUserMessage(firstUserMessage)) return false
  if (compactString(task.executor, 80) !== 'codex_app') return false
  if (!compactString(task.source_task_id, 120)) return false
  if (compactString(task.codex_thread_id, 200)) return false
  const result = isRecord(task.result) ? task.result : {}
  if (compactString(result.codex_thread_id, 200)) return false
  if (result.codex_manual_handoff !== true) return false
  const threadCwd = compactString(thread.cwd, 500)
  const taskCwd = compactString(task.cwd, 500)
  if (threadCwd && taskCwd && threadCwd !== taskCwd) return false
  if (!isThreadNearManualHandoffTime(thread, task)) return false
  return promptsLikelyMatch(task.prompt, firstUserMessage)
}

function isInternalCodexUserMessage(value: string) {
  const text = value.trim()
  return text.startsWith('# AGENTS.md instructions') ||
    text.startsWith('<environment_context>') ||
    text.includes('\n<environment_context>')
}

export function isThreadWithinProjectImportScope(
  thread: ImportedCodexThread,
  project: TargetProject,
  fallbackNowMs = Date.now(),
) {
  const cwd = compactString(thread.cwd, 500)
  const repoPath = compactString(project.repo_path, 500)
  if (!cwd || !repoPath || cwd !== repoPath) return false

  const enabledSinceMs = timeMs(project.codex_thread_import_enabled_since)
  if (enabledSinceMs === null) return true

  const updatedMs = timeMs(thread.updated_at_ms) ?? fallbackNowMs
  return updatedMs >= enabledSinceMs
}

async function findEnabledImportProject(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  thread: ImportedCodexThread,
): Promise<{ project: TargetProject | null; reason?: string }> {
  const cwd = compactString(thread.cwd, 500)
  if (!cwd) return { project: null, reason: 'missing_cwd' }

  let query = supabase
    .from('projects')
    .select('id, space_id, title, repo_path, codex_thread_import_enabled_since, created_at')
    .eq('user_id', token.user_id)
    .neq('status', 'archived')
    .eq('repo_path', cwd)
    .eq('codex_thread_import_enabled', true)
    .order('created_at', { ascending: true })
    .limit(10)

  if (token.space_id) query = query.eq('space_id', token.space_id)

  const { data, error } = await query
  if (error) throw error

  const project = (Array.isArray(data) ? data : [])
    .map(row => row as TargetProject)
    .find(candidate => isThreadWithinProjectImportScope(thread, candidate))
  return project ? { project } : { project: null, reason: 'repo_import_scope_disabled' }
}

async function nextOrderIndex(
  supabase: SupabaseServiceClient,
  userId: string,
  projectId: string,
  parentTaskId: string | null,
) {
  let query = supabase
    .from('tasks')
    .select('order_index')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('order_index', { ascending: false })
    .limit(1)
  query = parentTaskId ? query.eq('parent_task_id', parentTaskId) : query.is('parent_task_id', null)
  const { data, error } = await query
  if (error) throw error
  const current = typeof data?.[0]?.order_index === 'number' ? data[0].order_index : -1
  return current + 1
}

async function ensureInboxGroup(
  supabase: SupabaseServiceClient,
  userId: string,
  projectId: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .eq('is_group', true)
    .eq('title', CODEX_INBOX_GROUP_TITLE)
    .is('parent_task_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (existingError) throw existingError
  if (existing?.[0]?.id) return String(existing[0].id)

  const orderIndex = await nextOrderIndex(supabase, userId, projectId, null)
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      project_id: projectId,
      parent_task_id: null,
      is_group: true,
      title: CODEX_INBOX_GROUP_TITLE,
      status: 'todo',
      stage: 'plan',
      order_index: orderIndex,
      actual_time_minutes: 0,
      estimated_time: 0,
      source: 'codex_inbox',
    })
    .select('id')
    .single()
  if (error) throw error
  return String(data.id)
}

async function existingImport(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  threadId: string,
) {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, source_task_id, codex_thread_id, result')
    .eq('codex_thread_id', threadId)
    .eq('user_id', token.user_id)
    .limit(1)
  if (error) throw error
  if (data?.[0]?.id) return { ai_task_id: String(data[0].id), source_task_id: compactString(data[0].source_task_id, 120) }

  const { data: byResult, error: byResultError } = await supabase
    .from('ai_tasks')
    .select('id, source_task_id')
    .eq('user_id', token.user_id)
    .contains('result', { codex_thread_id: threadId })
    .limit(1)
  if (byResultError) throw byResultError
  if (byResult?.[0]?.id) {
    return { ai_task_id: String(byResult[0].id), source_task_id: compactString(byResult[0].source_task_id, 120) }
  }

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', token.user_id)
    .eq('codex_thread_id', threadId)
    .is('deleted_at', null)
    .limit(1)
  if (taskError) throw taskError
  if (task?.[0]?.id) return { ai_task_id: null, source_task_id: String(task[0].id) }
  return null
}

async function existingManualHandoffForThread(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  thread: ImportedCodexThread,
) {
  if (!compactString(thread.first_user_message, MAX_PROMPT_CHARS)) return null

  const { data, error } = await supabase
    .from('ai_tasks')
    .select('id, source_task_id, prompt, cwd, executor, codex_thread_id, result, created_at, started_at')
    .eq('user_id', token.user_id)
    .eq('executor', 'codex_app')
    .not('source_task_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const match = (Array.isArray(data) ? data : [])
    .map(row => row as Record<string, unknown>)
    .find(row => isImportedThreadMatchingManualHandoff(thread, row))
  if (!match) return null
  return {
    ai_task_id: String(match.id),
    source_task_id: compactString(match.source_task_id, 120),
  }
}

async function assertRunnerCanImport(
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
  if (!executors.some(executor => executor === 'codex_app' || executor === 'codex')) {
    return { ok: false as const, status: 403, error: 'Runner is not allowed to import Codex threads' }
  }
  return { ok: true as const }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const body = await request.json().catch(() => ({}))
    const runnerId = compactString(isRecord(body) ? body.runner_id : null, 120)
    const thread = parseThread(isRecord(body) ? body.thread : null)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    if (!thread) return NextResponse.json({ error: 'valid thread is required' }, { status: 400 })

    const runnerCheck = await assertRunnerCanImport(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    const imported = await existingImport(supabase, token, thread.id)
    if (imported?.ai_task_id) {
      return NextResponse.json({ imported: false, reason: 'already_imported', ...imported })
    }

    const focusmapManualHandoff = await existingManualHandoffForThread(supabase, token, thread)
    if (focusmapManualHandoff) {
      return NextResponse.json({
        imported: false,
        reason: 'focusmap_manual_handoff',
        ...focusmapManualHandoff,
      })
    }

    const { project, reason } = await findEnabledImportProject(supabase, token, thread)
    if (!project) {
      return NextResponse.json({ imported: false, reason: reason ?? 'repo_import_scope_disabled' })
    }

    const inboxGroupId = await ensureInboxGroup(supabase, token.user_id, project.id)
    const sourceTaskId = imported?.source_task_id ?? null
    let taskId = sourceTaskId
    if (!taskId) {
      const orderIndex = await nextOrderIndex(supabase, token.user_id, project.id, inboxGroupId)
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          user_id: token.user_id,
          project_id: project.id,
          parent_task_id: inboxGroupId,
          is_group: false,
          title: titleFromImportedThread(thread),
          status: 'todo',
          stage: 'plan',
          order_index: orderIndex,
          actual_time_minutes: 0,
          estimated_time: 0,
          source: 'codex_app_thread',
          memo: memoFromImportedThread(thread),
          codex_thread_id: thread.id,
          codex_status: 'running',
          codex_work_dir: thread.cwd ?? null,
        })
        .select('id')
        .single()
      if (taskError) throw taskError
      taskId = String(task.id)
    }

    const nowIso = new Date().toISOString()
    const result = importedThreadResult(thread, taskId, nowIso)
    const { data: aiTask, error: aiTaskError } = await supabase
      .from('ai_tasks')
      .insert({
        user_id: token.user_id,
        space_id: project.space_id,
        prompt: promptFromImportedThread(thread),
        skill_id: null,
        approval_type: 'auto',
        parent_task_id: null,
        status: 'running',
        started_at: nowIso,
        cwd: thread.cwd ?? null,
        executor: 'codex_app',
        run_visibility: project.space_id ? 'space' : 'private',
        billing_cycle: formatBillingCycle(),
        codex_thread_id: thread.id,
        source_task_id: taskId,
        result,
      })
      .select('id, created_at')
      .single()
    if (aiTaskError) throw aiTaskError

    if (isTursoConfigured()) {
      try {
        await upsertTursoAiTask({
          id: String(aiTask.id),
          user_id: token.user_id,
          space_id: project.space_id,
          title: titleFromImportedThread(thread),
          status: 'running',
          executor: 'codex_app',
          dispatch_mode: 'manual',
          codex_thread_id: thread.id,
          current_step: result.current_step,
          summary: result.message,
          created_at: typeof aiTask.created_at === 'string' ? aiTask.created_at : nowIso,
          started_at: nowIso,
          updated_at: result.last_activity_at,
        })
      } catch (tursoError) {
        console.error('[codex-monitor/import-thread turso]', tursoError)
      }
    }

    return NextResponse.json({
      imported: true,
      ai_task_id: String(aiTask.id),
      source_task_id: taskId,
      project_id: project.id,
      inbox_group_id: inboxGroupId,
    }, { status: 201 })
  } catch (error) {
    console.error('[codex-monitor/import-thread]', error)
    const message = error instanceof Error ? error.message : 'Codex thread import failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json(
      { error: message },
      { status: authFailure ? 401 : 500 },
    )
  }
}
