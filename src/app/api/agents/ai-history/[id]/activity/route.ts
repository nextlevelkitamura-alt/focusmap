import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, type AgentTokenRecord } from '@/lib/agent-auth'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  AI_HISTORY_DETAIL_KINDS,
  AI_HISTORY_DETAIL_ROLES,
  getAiHistoryItemForUser,
  upsertAiHistoryDetailMessages,
  type AiHistoryDetailMessageUpsertInput,
} from '@/lib/turso/ai-history'
import type {
  AiHistoryDetailMessageKind,
  AiHistoryDetailMessageRole,
  AiHistoryDetailUpsertMessage,
  AiHistoryDetailUpsertRequest,
} from '@/types/ai-history'

type SupabaseServiceClient = Awaited<ReturnType<typeof authenticateAgent>>['supabase']

const VALID_EXECUTORS = ['codex_app', 'codex'] as const
const MAX_MESSAGES_PER_REQUEST = 50
const MAX_DETAIL_BODY_CHARS = 8_000
const MAX_METADATA_JSON_CHARS = 4_000

const BLOCKED_DETAIL_KEYS = new Set([
  'body',
  'full_body',
  'raw_body',
  'messages',
  'full_messages',
  'raw_messages',
  'full_transcript',
  'thread_full_history',
  'raw_thread_history',
  'rollout',
  'rollout_json',
  'raw_rollout',
  'live_log',
  'output',
  'command_output',
  'raw_output',
  'stdout',
  'stderr',
  'screenshot',
  'screenshot_body',
  'image_body',
  'base64',
  'tool_calls',
  'function_call',
  'custom_tool_call',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function field(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  }
  return undefined
}

function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function isoString(value: unknown) {
  const raw = compactString(value, 100)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function integerValue(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) return null
  return parsed
}

function blockedKeyName(key: string) {
  const normalized = key.trim().toLowerCase()
  if (BLOCKED_DETAIL_KEYS.has(normalized)) return normalized
  if (normalized.includes('screenshot') && normalized.includes('body')) return normalized
  if (normalized.includes('command') && normalized.includes('output')) return normalized
  if (normalized.includes('rollout')) return normalized
  if (normalized.includes('base64')) return normalized
  return null
}

function findBlockedPayloadKey(value: unknown, path = '$'): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findBlockedPayloadKey(value[index], `${path}[${index}]`)
      if (found) return found
    }
    return null
  }
  if (!isRecord(value)) return null
  for (const [key, child] of Object.entries(value)) {
    const isAllowedMessageList = path === '$' && key === 'messages'
    const isAllowedDisplayBody = /^\$\.messages\[\d+\]$/u.test(path) && key === 'body'
    if (!isAllowedMessageList && !isAllowedDisplayBody) {
      const blocked = blockedKeyName(key)
      if (blocked) return `${path}.${blocked}`
    }
    const found = findBlockedPayloadKey(child, `${path}.${key}`)
    if (found) return found
  }
  return null
}

function unsafeBodyReason(body: string) {
  if (body.length > MAX_DETAIL_BODY_CHARS) return 'body_too_large'
  if (/data:image\/|;base64,|iVBORw0KGgo|\/9j\//u.test(body)) return 'binary_or_screenshot_body'
  if (/<environment_context>|<INSTRUCTIONS>|# AGENTS\.md instructions/u.test(body)) {
    return 'agent_context_body'
  }
  if (/^\s*\{[\s\S]*"(raw_rollout|rollout|thread_full_history|command_output|screenshot_body|messages)"\s*:/u.test(body)) {
    return 'raw_json_body'
  }
  return null
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return null
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMetadataValue(item, depth + 1))
  if (!isRecord(value)) return null
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (blockedKeyName(key)) continue
    const normalizedKey = key.trim()
    if (!normalizedKey) continue
    output[normalizedKey.slice(0, 80)] = sanitizeMetadataValue(child, depth + 1)
  }
  return output
}

function sanitizeMetadata(value: unknown) {
  const sanitized = sanitizeMetadataValue(value)
  if (!isRecord(sanitized)) return null
  const encoded = JSON.stringify(sanitized)
  if (encoded.length <= MAX_METADATA_JSON_CHARS) return sanitized
  return {
    truncated: true,
    retained_keys: Object.keys(sanitized).slice(0, 40),
  }
}

export function normalizeAiHistoryDetailPayloadMessage(
  value: AiHistoryDetailUpsertMessage,
  index: number,
) {
  const record = value as Record<string, unknown>
  const sequence = integerValue(field(record, 'sequence')) ?? index
  const role = compactString(field(record, 'role'), 40)
  if (!role || !AI_HISTORY_DETAIL_ROLES.has(role as AiHistoryDetailMessageRole)) {
    return { error: `invalid role at messages[${index}]` }
  }
  const kind = compactString(field(record, 'kind'), 60)
  if (!kind || !AI_HISTORY_DETAIL_KINDS.has(kind as AiHistoryDetailMessageKind)) {
    return { error: `invalid kind at messages[${index}]` }
  }
  const body = typeof field(record, 'body') === 'string'
    ? String(field(record, 'body')).replace(/\r\n/g, '\n').trim()
    : ''
  if (!body) return { error: `body is required at messages[${index}]` }
  const unsafeReason = unsafeBodyReason(body)
  if (unsafeReason) return { error: `${unsafeReason} at messages[${index}]` }

  return {
    message: {
      sequence,
      role: role as AiHistoryDetailMessageRole,
      kind: kind as AiHistoryDetailMessageKind,
      body,
      occurred_at: isoString(field(record, 'occurredAt', 'occurred_at')),
      metadata_json: sanitizeMetadata(field(record, 'metadata', 'metadataJson', 'metadata_json')),
    } satisfies AiHistoryDetailMessageUpsertInput,
  }
}

async function assertRunnerCanSync(
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
  if (!executors.some(executor => VALID_EXECUTORS.includes(executor as (typeof VALID_EXECUTORS)[number]))) {
    return { ok: false as const, status: 403, error: 'Runner is not allowed to sync AI history detail activity' }
  }
  return { ok: true as const }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, token } = await authenticateAgent(request)
    const { id } = await params
    const body = await request.json().catch(() => ({})) as AiHistoryDetailUpsertRequest
    if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const blockedKey = findBlockedPayloadKey(body)
    if (blockedKey) {
      return NextResponse.json({
        error: 'Raw detail payload is not accepted',
        blockedKey,
      }, { status: 400 })
    }

    const runnerId = compactString(body.runner_id, 120)
    if (!runnerId) return NextResponse.json({ error: 'runner_id is required' }, { status: 400 })
    const runnerCheck = await assertRunnerCanSync(supabase, token, runnerId)
    if (!runnerCheck.ok) return NextResponse.json({ error: runnerCheck.error }, { status: runnerCheck.status })

    if (!isTursoConfigured()) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }

    const item = await getAiHistoryItemForUser(id, token.user_id)
    if (!item) return NextResponse.json({ error: 'AI history item not found' }, { status: 404 })
    if (item.linked_ai_task_id) {
      return NextResponse.json({
        error: 'Linked AI history uses ai_tasks activity',
        code: 'linked_ai_task_activity_primary',
      }, { status: 409 })
    }

    const rawMessages = Array.isArray(body.messages) ? body.messages.slice(0, MAX_MESSAGES_PER_REQUEST) : []
    if (rawMessages.length === 0) return NextResponse.json({ error: 'messages are required' }, { status: 400 })

    const messages: AiHistoryDetailMessageUpsertInput[] = []
    const errors: Array<{ index: number; error: string }> = []
    rawMessages.forEach((rawMessage, index) => {
      if (!isRecord(rawMessage)) {
        errors.push({ index, error: `messages[${index}] must be an object` })
        return
      }
      const normalized = normalizeAiHistoryDetailPayloadMessage(rawMessage, index)
      if ('error' in normalized) {
        errors.push({ index, error: normalized.error })
        return
      }
      messages.push(normalized.message)
    })
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Invalid detail messages', errors }, { status: 400 })
    }

    const result = await upsertAiHistoryDetailMessages({
      userId: token.user_id,
      historyItemId: item.id,
      provider: item.provider,
      externalThreadId: item.external_thread_id,
      repoPath: item.repo_path,
      messages,
      detailSyncedAt: isoString(body.detail_synced_at),
    })

    return NextResponse.json({
      ok: true,
      historyItemId: item.id,
      upserted: result.upserted,
      messageCount: result.messageCount,
      detailSyncedAt: result.detailSyncedAt,
      policy: {
        sanitizedDisplayOnly: true,
        rawBodiesAccepted: false,
        maxBodyChars: MAX_DETAIL_BODY_CHARS,
      },
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[agents/ai-history activity upsert]', error)
    const message = error instanceof Error ? error.message : 'AI history detail activity upsert failed'
    const authFailure = /agent token|invalid agent|expired|revoked/i.test(message)
    return NextResponse.json({ error: message }, { status: authFailure ? 401 : 500 })
  }
}
