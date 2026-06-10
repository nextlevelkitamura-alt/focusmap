import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import { formatBillingCycle } from '@/lib/format'
import { isTursoConfigured } from '@/lib/turso/client'
import { upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

const CODEX_INBOX_GROUP_TITLE = 'Codex Inbox'
const MAX_PROMPT_CHARS = 8_000

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactString(value: unknown, max = 2_000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
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
  const candidates = [
    thread.title,
    thread.first_user_message?.split('\n').find(line => line.trim()),
    thread.preview,
  ]
  const title = candidates
    .map(value => compactString(value, 120))
    .find(Boolean)
  if (title) return title.replace(/\s+/g, ' ').slice(0, 120)
  return `Codex thread ${thread.id.slice(0, 8)}`
}

export function promptFromImportedThread(thread: ImportedCodexThread) {
  return compactString(thread.first_user_message, MAX_PROMPT_CHARS)
    ?? compactString(thread.preview, MAX_PROMPT_CHARS)
    ?? compactString(thread.title, MAX_PROMPT_CHARS)
    ?? `Codex thread ${thread.id}`
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

async function firstProjectByQuery(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  options: { cwd?: string | null; any?: boolean } = {},
): Promise<TargetProject | null> {
  let query = supabase
    .from('projects')
    .select('id, space_id, title, repo_path, created_at')
    .eq('user_id', token.user_id)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
    .limit(1)

  if (token.space_id) query = query.eq('space_id', token.space_id)
  if (options.cwd && !options.any) query = query.eq('repo_path', options.cwd)

  const { data, error } = await query
  if (error) throw error
  const row = data?.[0] as TargetProject | undefined
  return row ?? null
}

async function firstOwnedSpaceId(supabase: SupabaseServiceClient, userId: string) {
  const { data, error } = await supabase
    .from('spaces')
    .select('id')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return typeof data?.[0]?.id === 'string' ? data[0].id : null
}

async function ensureTargetProject(
  supabase: SupabaseServiceClient,
  token: AgentTokenRecord,
  thread: ImportedCodexThread,
): Promise<TargetProject | null> {
  const cwd = thread.cwd ?? null
  if (cwd) {
    const exact = await firstProjectByQuery(supabase, token, { cwd })
    if (exact) return exact
  }

  const existing = await firstProjectByQuery(supabase, token, { any: true })
  if (existing) return existing

  const spaceId = token.space_id ?? await firstOwnedSpaceId(supabase, token.user_id)
  if (!spaceId) return null

  const repoName = cwd ? path.basename(cwd) : null
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: token.user_id,
      space_id: spaceId,
      title: repoName ? `Codex Inbox: ${repoName}` : 'Codex Inbox',
      description: 'Codex.appで直接開始したスレッドの取り込み先',
      status: 'active',
      priority: 0,
      color_theme: 'slate',
      repo_path: cwd,
    })
    .select('id, space_id, title, repo_path')
    .single()
  if (error) throw error
  return data as TargetProject
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

    const project = await ensureTargetProject(supabase, token, thread)
    if (!project) {
      return NextResponse.json({ imported: false, reason: 'no_project_or_space' })
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
          memo: promptFromImportedThread(thread),
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
