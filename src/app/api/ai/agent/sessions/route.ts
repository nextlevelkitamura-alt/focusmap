import { NextRequest, NextResponse } from 'next/server'
import type { UIMessage } from 'ai'
import { createClient } from '@/utils/supabase/server'
import type { AgentChatMode } from '@/lib/ai/agent-chat-background'
import {
  AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE,
  isMissingAgentChatSessionsTable,
} from '@/lib/ai/agent-chat-db'

const MAX_SESSIONS = 50

type AgentChatStatus = 'idle' | 'running' | 'completed' | 'failed'

interface AgentChatSessionRow {
  id: string
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

function normalizeScopeKey(value: string | null | undefined) {
  const trimmed = (value || 'general').trim()
  return trimmed.length > 0 && trimmed.length <= 180 ? trimmed : 'general'
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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeChatMode(value: unknown): AgentChatMode {
  return value === 'project' ? 'project' : 'general'
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const scopeKey = normalizeScopeKey(searchParams.get('scope_key'))
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || MAX_SESSIONS, 1), MAX_SESSIONS)

  const { data, error } = await supabase
    .from('agent_chat_sessions')
    .select('id, scope_key, chat_mode, space_id, project_id, title, messages, status, last_error, run_started_at, run_completed_at, created_at, updated_at')
    .eq('user_id', user.id)
    .eq('scope_key', scopeKey)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    if (isMissingAgentChatSessionsTable(error)) {
      return NextResponse.json({ sessions: [], dbReady: false })
    }
    console.error('[agent/sessions] list failed:', error)
    return NextResponse.json({ error: 'Failed to load chat sessions' }, { status: 500 })
  }

  return NextResponse.json({ sessions: (data ?? []).map(row => normalizeSession(row as AgentChatSessionRow)) })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const id = isUuid(body?.id) ? body.id : crypto.randomUUID()
  const scopeKey = normalizeScopeKey(body?.scopeKey)
  const chatMode = normalizeChatMode(body?.chatMode)
  const spaceId = isUuid(body?.spaceId) ? body.spaceId : null
  const projectId = chatMode === 'project' && isUuid(body?.projectId) ? body.projectId : null

  const { data, error } = await supabase
    .from('agent_chat_sessions')
    .upsert({
      id,
      user_id: user.id,
      scope_key: scopeKey,
      chat_mode: chatMode,
      space_id: spaceId,
      project_id: projectId,
      title: '新しいチャット',
      messages: [],
      status: 'idle',
      last_error: null,
    }, { onConflict: 'id' })
    .select('id, scope_key, chat_mode, space_id, project_id, title, messages, status, last_error, run_started_at, run_completed_at, created_at, updated_at')
    .single()

  if (error) {
    if (isMissingAgentChatSessionsTable(error)) {
      return NextResponse.json({ error: AGENT_CHAT_SESSIONS_NOT_READY_MESSAGE }, { status: 503 })
    }
    console.error('[agent/sessions] create failed:', error)
    return NextResponse.json({ error: 'Failed to create chat session' }, { status: 500 })
  }

  return NextResponse.json({ session: normalizeSession(data as AgentChatSessionRow) })
}
