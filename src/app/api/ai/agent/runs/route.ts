import { after, NextRequest, NextResponse } from 'next/server'
import type { UIMessage } from 'ai'
import { createClient } from '@/utils/supabase/server'
import {
  friendlyAgentError,
  generateAgentChatReply,
  type AgentChatMode,
} from '@/lib/ai/agent-chat-background'
import {
  agentToolLabel,
  createAgentProgressMessage,
  type AgentMindmapMutationMetadata,
  upsertAgentProgressMessage,
} from '@/lib/ai/agent-chat-progress'
import {
  AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE,
  isMissingAgentChatSessionsTable,
} from '@/lib/ai/agent-chat-db'
import {
  normalizeAgentModelMode,
  type AgentModelMode,
} from '@/lib/ai/agent-model-mode'

export const maxDuration = 600

type AgentChatStatus = 'idle' | 'running' | 'completed' | 'failed'

interface AgentChatSessionRow {
  id: string
  user_id: string
  scope_key: string
  chat_mode: AgentChatMode
  space_id: string | null
  project_id: string | null
  title: string
  messages: UIMessage[] | null
  status: AgentChatStatus
  last_error: string | null
  run_started_at: string | null
  run_completed_at: string | null
  created_at: string
  updated_at: string
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractSavedMindmapDraftAction(output: unknown) {
  if (!isRecord(output) || output.success === false || typeof output.draftId !== 'string') return null
  return {
    draftId: output.draftId,
    projectId: typeof output.projectId === 'string' ? output.projectId : null,
    summary: isRecord(output.summary) ? output.summary : null,
    nodeCount: typeof output.nodeCount === 'number' ? output.nodeCount : null,
    canApply: true,
  }
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function extractProjectContextProposalAction(output: unknown) {
  if (!isRecord(output) || output.success === false || typeof output.projectId !== 'string') return null
  const nextQuestions = Array.isArray(output.nextQuestions)
    ? output.nextQuestions.filter((item): item is string => typeof item === 'string' && item.trim()).slice(0, 3)
    : []
  return {
    version: 1,
    projectId: output.projectId,
    projectTitle: nullableString(output.projectTitle),
    projectDescription: nullableString(output.projectDescription),
    heading: nullableString(output.heading),
    details: nullableString(output.details),
    progress: nullableString(output.progress),
    progressStatus: nullableString(output.progressStatus),
    reason: nullableString(output.reason),
    nextQuestions,
    canApply: output.canApply === true,
  }
}

function extractProjectIdFromToolOutput(output: unknown): string | null {
  if (!isRecord(output) || output.success === false) return null
  for (const key of ['projectId', 'project_id', 'targetProjectId', 'target_project_id']) {
    const value = output[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  for (const key of ['task', 'group', 'node', 'createdStructuredLink']) {
    const value = output[key]
    if (!isRecord(value)) continue
    const projectId = value.projectId ?? value.project_id
    if (typeof projectId === 'string' && projectId.trim()) return projectId
  }
  return null
}

const MINDMAP_TASK_MUTATION_TOOLS = new Set([
  'addTask',
  'addMindmapGroup',
  'addMindmapTask',
  'updateMindmapNode',
  'moveMindmapNode',
])

const MINDMAP_REFRESH_MUTATION_TOOLS = new Set([
  'updateMindmapMemoLink',
])

function sanitizeMindmapTaskForProgress(task: Record<string, unknown>): Record<string, unknown> {
  return {
    id: task.id,
    user_id: task.user_id,
    project_id: task.project_id ?? null,
    parent_task_id: task.parent_task_id ?? null,
    is_group: task.is_group === true,
    title: typeof task.title === 'string' ? task.title : '',
    status: typeof task.status === 'string' ? task.status : 'todo',
    stage: typeof task.stage === 'string' ? task.stage : 'plan',
    priority: typeof task.priority === 'number' ? task.priority : null,
    order_index: typeof task.order_index === 'number' ? task.order_index : 0,
    scheduled_at: typeof task.scheduled_at === 'string' ? task.scheduled_at : null,
    estimated_time: typeof task.estimated_time === 'number' ? task.estimated_time : 0,
    actual_time_minutes: typeof task.actual_time_minutes === 'number' ? task.actual_time_minutes : 0,
    google_event_id: typeof task.google_event_id === 'string' ? task.google_event_id : null,
    calendar_event_id: typeof task.calendar_event_id === 'string' ? task.calendar_event_id : null,
    calendar_id: typeof task.calendar_id === 'string' ? task.calendar_id : null,
    total_elapsed_seconds: typeof task.total_elapsed_seconds === 'number' ? task.total_elapsed_seconds : 0,
    last_started_at: typeof task.last_started_at === 'string' ? task.last_started_at : null,
    is_timer_running: task.is_timer_running === true,
    created_at: typeof task.created_at === 'string' ? task.created_at : new Date().toISOString(),
    updated_at: typeof task.updated_at === 'string' ? task.updated_at : new Date().toISOString(),
    source: typeof task.source === 'string' ? task.source : 'manual',
    deleted_at: typeof task.deleted_at === 'string' ? task.deleted_at : null,
    google_event_fingerprint: typeof task.google_event_fingerprint === 'string' ? task.google_event_fingerprint : null,
    is_habit: task.is_habit === true,
    habit_frequency: typeof task.habit_frequency === 'string' ? task.habit_frequency : null,
    habit_icon: typeof task.habit_icon === 'string' ? task.habit_icon : null,
    habit_start_date: typeof task.habit_start_date === 'string' ? task.habit_start_date : null,
    habit_end_date: typeof task.habit_end_date === 'string' ? task.habit_end_date : null,
    node_width: typeof task.node_width === 'number' ? task.node_width : null,
    mindmap_collapsed: task.mindmap_collapsed === true,
    codex_work_dir: typeof task.codex_work_dir === 'string' ? task.codex_work_dir : null,
    codex_thread_id: typeof task.codex_thread_id === 'string' ? task.codex_thread_id : null,
    codex_status: typeof task.codex_status === 'string' ? task.codex_status : null,
  }
}

function extractTaskRecordFromToolOutput(output: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['task', 'group', 'node']) {
    const value = output[key]
    if (isRecord(value) && typeof value.id === 'string') return sanitizeMindmapTaskForProgress(value)
  }
  return null
}

function extractMindmapMutationFromToolOutput(toolName: string, output: unknown): AgentMindmapMutationMetadata | null {
  if (!isRecord(output) || output.success === false) return null
  const projectId = extractProjectIdFromToolOutput(output)

  if (MINDMAP_TASK_MUTATION_TOOLS.has(toolName)) {
    const task = extractTaskRecordFromToolOutput(output)
    if (task) {
      return {
        version: 1,
        type: 'upsert-task',
        projectId,
        previousProjectId: nullableString(output.previousProjectId),
        tasks: [task],
      }
    }
  }

  if (projectId && MINDMAP_REFRESH_MUTATION_TOOLS.has(toolName)) {
    return {
      version: 1,
      type: 'refresh',
      projectId,
    }
  }

  return null
}

function normalizeScopeKey(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 && trimmed.length <= 180 ? trimmed : 'general'
}

function normalizeChatMode(value: unknown): AgentChatMode {
  return value === 'project' ? 'project' : 'general'
}

function isUiMessage(value: unknown): value is UIMessage {
  const message = value as UIMessage | null
  return !!message &&
    typeof message === 'object' &&
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
    Array.isArray(message.parts)
}

function isUiMessageArray(value: unknown): value is UIMessage[] {
  return Array.isArray(value) && value.every(isUiMessage)
}

function textFromMessage(message: UIMessage) {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join(' ')
    .trim()
}

function deriveTitle(messages: UIMessage[]) {
  const firstUser = messages.find(message => message.role === 'user')
  if (!firstUser) return '新しいチャット'
  const text = textFromMessage(firstUser).replace(/\s+/g, ' ').trim()
  if (!text) return '新しいチャット'
  return text.length > 28 ? `${text.slice(0, 28)}...` : text
}

function createAssistantMessage(text: string, metadata?: Record<string, unknown>): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    ...(metadata ? { metadata } : {}),
    parts: [{ type: 'text', text }],
  }
}

function runDurationMs(startedAt: string | null | undefined, completedAt: string) {
  const startMs = startedAt ? Date.parse(startedAt) : NaN
  const completedMs = Date.parse(completedAt)
  if (!Number.isFinite(startMs) || !Number.isFinite(completedMs)) return undefined
  return Math.max(0, Math.round(completedMs - startMs))
}

function withUserRunMetadata(message: UIMessage, modelMode: AgentModelMode, startedAt: string): UIMessage {
  const metadata = isRecord(message.metadata) ? message.metadata : {}
  return {
    ...message,
    metadata: {
      ...metadata,
      focusmapAgentRun: {
        version: 1,
        modelMode,
        startedAt,
      },
    },
  }
}

function runResultMetadata(modelMode: AgentModelMode, startedAt: string | null | undefined, completedAt: string) {
  return {
    version: 1,
    modelMode,
    startedAt: startedAt ?? null,
    completedAt,
    durationMs: runDurationMs(startedAt, completedAt),
  }
}

function normalizeSession(row: AgentChatSessionRow) {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    chatMode: row.chat_mode,
    spaceId: row.space_id,
    projectId: row.project_id,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    status: row.status,
    lastError: row.last_error,
    runStartedAt: row.run_started_at,
    runCompletedAt: row.run_completed_at,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

async function runPersistentAgentSession(sessionId: string, userId: string, modelMode: AgentModelMode) {
  const supabase = await createClient()
  const { data: session, error: loadError } = await supabase
    .from('agent_chat_sessions')
    .select('id, user_id, scope_key, chat_mode, space_id, project_id, title, messages, status, last_error, run_started_at, run_completed_at, created_at, updated_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (loadError) {
    console.error('[agent/runs] load session failed:', loadError)
    return
  }
  if (!session || (session as AgentChatSessionRow).status !== 'running') return

  const row = session as AgentChatSessionRow
  let liveMessages: UIMessage[] = Array.isArray(row.messages) ? row.messages : []
  const toolStartedAt = new Map<string, string>()
  let savedMindmapDraftAction: ReturnType<typeof extractSavedMindmapDraftAction> | null = null
  let projectContextProposalAction: ReturnType<typeof extractProjectContextProposalAction> | null = null

  async function persistProgressMessage(progressMessage: UIMessage) {
    liveMessages = upsertAgentProgressMessage(liveMessages, progressMessage)
    const { error } = await supabase
      .from('agent_chat_sessions')
      .update({ messages: liveMessages })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'running')

    if (error) {
      console.error('[agent/runs] progress update failed:', error)
    }
  }

  try {
    const result = await generateAgentChatReply({
      userId,
      chatSessionId: sessionId,
      messages: liveMessages,
      spaceId: row.space_id,
      projectId: row.project_id,
      chatMode: row.chat_mode,
      modelMode,
      onToolCallStart: async event => {
        const toolCallId = event.toolCall.toolCallId
        const toolName = event.toolCall.toolName
        const startedAt = new Date().toISOString()
        toolStartedAt.set(toolCallId, startedAt)
        await persistProgressMessage(createAgentProgressMessage({
          id: `agent-progress:${toolCallId}`,
          state: 'running',
          label: agentToolLabel(toolName),
          toolName,
          stepNumber: event.stepNumber,
          startedAt,
        }))
      },
      onToolCallFinish: async event => {
        const toolCallId = event.toolCall.toolCallId
        const toolName = event.toolCall.toolName
        const completedAt = new Date().toISOString()
        const startedAt = toolStartedAt.get(toolCallId) ??
          new Date(Date.now() - Math.max(0, event.durationMs)).toISOString()
        const projectId = event.success ? extractProjectIdFromToolOutput(event.output) : null
        const mindmapMutation = event.success ? extractMindmapMutationFromToolOutput(toolName, event.output) : null
        await persistProgressMessage(createAgentProgressMessage({
          id: `agent-progress:${toolCallId}`,
          state: event.success ? 'done' : 'failed',
          label: agentToolLabel(toolName),
          toolName,
          projectId,
          mindmapMutation,
          stepNumber: event.stepNumber,
          startedAt,
          completedAt,
          durationMs: event.durationMs,
        }))
        if (event.success && toolName === 'saveMindmapDraft') {
          savedMindmapDraftAction = extractSavedMindmapDraftAction(event.output)
        }
        if (event.success && toolName === 'prepareProjectContextSaveProposal') {
          projectContextProposalAction = extractProjectContextProposalAction(event.output)
        }
      },
    })
    const replyText = result.text?.trim() || '完了しました。'
    const completedAt = new Date().toISOString()
    const replyMetadata = {
      focusmapAgentRunResult: runResultMetadata(modelMode, row.run_started_at, completedAt),
      ...(savedMindmapDraftAction ? { focusmapMindmapDraftReady: savedMindmapDraftAction } : {}),
      ...(projectContextProposalAction ? { focusmapProjectContextProposalReady: projectContextProposalAction } : {}),
    }
    const nextMessages = [...liveMessages, createAssistantMessage(replyText, replyMetadata)]

    const { error } = await supabase
      .from('agent_chat_sessions')
      .update({
        messages: nextMessages,
        status: 'completed',
        last_error: null,
        run_completed_at: completedAt,
      })
      .eq('id', sessionId)
      .eq('user_id', userId)

    if (error) console.error('[agent/runs] complete update failed:', error)
  } catch (error) {
    const message = friendlyAgentError(error)
    const failedAt = new Date().toISOString()
    const nextMessages = [...liveMessages, createAssistantMessage(message, {
      focusmapAgentRunResult: runResultMetadata(modelMode, row.run_started_at, failedAt),
    })]
    const { error: updateError } = await supabase
      .from('agent_chat_sessions')
      .update({
        messages: nextMessages,
        status: 'failed',
        last_error: message,
        run_completed_at: failedAt,
      })
      .eq('id', sessionId)
      .eq('user_id', userId)

    if (updateError) console.error('[agent/runs] failed update failed:', updateError)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const sessionId = isUuid(body?.sessionId) ? body.sessionId : crypto.randomUUID()
  const scopeKey = normalizeScopeKey(body?.scopeKey)
  const chatMode = normalizeChatMode(body?.chatMode)
  const modelMode = normalizeAgentModelMode(body?.modelMode)
  const spaceId = isUuid(body?.spaceId) ? body.spaceId : null
  const projectId = chatMode === 'project' && isUuid(body?.projectId) ? body.projectId : null
  const previousMessages = isUiMessageArray(body?.previousMessages) ? body.previousMessages : []
  const userMessage = isUiMessage(body?.userMessage) && body.userMessage.role === 'user'
    ? body.userMessage
    : null

  if (!userMessage) {
    return NextResponse.json({ error: 'userMessage is required' }, { status: 400 })
  }
  if (chatMode === 'project' && !projectId) {
    return NextResponse.json({ error: 'projectId is required for project chat' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('agent_chat_sessions')
    .select('id, user_id, scope_key, chat_mode, space_id, project_id, title, messages, status, last_error, run_started_at, run_completed_at, created_at, updated_at')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingError) {
    if (isMissingAgentChatSessionsTable(existingError)) {
      return NextResponse.json({ error: AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE }, { status: 503 })
    }
    console.error('[agent/runs] existing session lookup failed:', existingError)
    return NextResponse.json({ error: 'Failed to load chat session' }, { status: 500 })
  }

  const existingRow = existing as AgentChatSessionRow | null
  if (existingRow?.status === 'running') {
    return NextResponse.json({ error: 'session is already running' }, { status: 409 })
  }

  const baseMessages: UIMessage[] = existingRow && Array.isArray(existingRow.messages)
    ? existingRow.messages
    : previousMessages
  const startedAt = new Date().toISOString()
  const stampedUserMessage = withUserRunMetadata(userMessage, modelMode, startedAt)
  const messages = baseMessages.some(message => message.id === userMessage.id)
    ? baseMessages.map(message => message.id === userMessage.id ? stampedUserMessage : message)
    : [...baseMessages, stampedUserMessage]
  const payload = {
    id: sessionId,
    user_id: user.id,
    scope_key: scopeKey,
    chat_mode: chatMode,
    space_id: spaceId,
    project_id: projectId,
    title: existingRow?.title && existingRow.title !== '新しいチャット'
      ? existingRow.title
      : deriveTitle(messages),
    messages,
    status: 'running',
    last_error: null,
    run_started_at: startedAt,
    run_completed_at: null,
  }

  const query = existingRow
    ? supabase
      .from('agent_chat_sessions')
      .update(payload)
      .eq('id', sessionId)
      .eq('user_id', user.id)
    : supabase
      .from('agent_chat_sessions')
      .insert(payload)

  const { data, error } = await query
    .select('id, user_id, scope_key, chat_mode, space_id, project_id, title, messages, status, last_error, run_started_at, run_completed_at, created_at, updated_at')
    .single()

  if (error) {
    if (isMissingAgentChatSessionsTable(error)) {
      return NextResponse.json({ error: AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE }, { status: 503 })
    }
    console.error('[agent/runs] start failed:', error)
    return NextResponse.json({ error: 'Failed to start chat run' }, { status: 500 })
  }

  after(async () => {
    await runPersistentAgentSession(sessionId, user.id, modelMode)
  })

  return NextResponse.json({ session: normalizeSession(data as AgentChatSessionRow) })
}
