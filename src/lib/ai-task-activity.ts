import { createHash } from 'node:crypto'
import { ensureTursoAiTaskStub, insertTaskProgress } from './turso/codex-monitoring'
import { isTursoConfigured } from './turso/client'

export type AiTaskActivityRole = 'system' | 'codex' | 'user' | 'status'

export type AiTaskActivityKind =
  | 'prompt_waiting'
  | 'sent'
  | 'progress'
  | 'question'
  | 'approval'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'user_answer'

export type AiTaskActivityImportance = 'normal' | 'important'

export type AiTaskActivityMessage = {
  id: string
  task_id: string
  user_id: string
  role: AiTaskActivityRole
  kind: AiTaskActivityKind
  body: string
  importance: AiTaskActivityImportance
  metadata: Record<string, unknown>
  created_at: string
}

export type AiTaskActivityMessageForPrune = Pick<
  AiTaskActivityMessage,
  'id' | 'kind' | 'importance' | 'created_at'
>

export type InsertAiTaskActivityMessageInput = {
  taskId: string
  userId: string
  role: AiTaskActivityRole
  kind: AiTaskActivityKind
  body: string
  importance?: AiTaskActivityImportance
  metadata?: Record<string, unknown>
  dedupeKey?: string
  createdAt?: string
}

export const AI_TASK_ACTIVITY_MAX_MESSAGES = 50

export const AI_TASK_ACTIVITY_PROTECTED_KINDS = new Set<AiTaskActivityKind>([
  'prompt_waiting',
  'sent',
  'question',
  'approval',
  'resumed',
  'completed',
  'failed',
  'user_answer',
])

export function defaultAiTaskActivityImportance(kind: AiTaskActivityKind): AiTaskActivityImportance {
  return AI_TASK_ACTIVITY_PROTECTED_KINDS.has(kind) ? 'important' : 'normal'
}

export function normalizeAiTaskActivityBody(body: string, maxChars = 8_000): string {
  return body.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, maxChars)
}

function byCreatedAtAsc(a: AiTaskActivityMessageForPrune, b: AiTaskActivityMessageForPrune): number {
  const aMs = Date.parse(a.created_at)
  const bMs = Date.parse(b.created_at)
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs
  return a.id.localeCompare(b.id)
}

export function selectAiTaskActivityMessageIdsToDelete(
  messages: AiTaskActivityMessageForPrune[],
  maxMessages = AI_TASK_ACTIVITY_MAX_MESSAGES,
): string[] {
  if (messages.length <= maxMessages) return []

  const sorted = [...messages].sort(byCreatedAtAsc)
  const deleteIds: string[] = []
  const selected = new Set<string>()
  let remaining = sorted.length

  const take = (candidates: AiTaskActivityMessageForPrune[]) => {
    for (const message of candidates) {
      if (remaining <= maxMessages) return
      if (selected.has(message.id)) continue
      selected.add(message.id)
      deleteIds.push(message.id)
      remaining -= 1
    }
  }

  take(sorted.filter(message => message.importance === 'normal' && message.kind === 'progress'))
  take(sorted.filter(message => message.importance === 'normal' && !AI_TASK_ACTIVITY_PROTECTED_KINDS.has(message.kind)))
  take(sorted.filter(message => !AI_TASK_ACTIVITY_PROTECTED_KINDS.has(message.kind)))
  take(sorted)

  return deleteIds
}

// Supabase's generated table types do not include this new table in the repo yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

const ACTIVITY_DEDUPE_CACHE_MAX = 4_000
const activityDedupeCache = new Map<string, number>()

export function tursoActivityPrimaryEnabled() {
  return process.env.FOCUSMAP_TURSO_ACTIVITY_PRIMARY !== '0'
}

function activityProgressId(input: InsertAiTaskActivityMessageInput, body: string) {
  const key = input.dedupeKey
    ? `dedupe:${input.dedupeKey}`
    : [
        input.taskId,
        input.userId,
        input.role,
        input.kind,
        input.createdAt ?? '',
        body,
      ].join('\u001f')
  return `activity:${createHash('sha256').update(key).digest('hex')}`
}

function rememberActivityDedupe(key: string | null) {
  if (!key) return
  activityDedupeCache.set(key, Date.now())
  while (activityDedupeCache.size > ACTIVITY_DEDUPE_CACHE_MAX) {
    const oldestKey = activityDedupeCache.keys().next().value as string | undefined
    if (!oldestKey) break
    activityDedupeCache.delete(oldestKey)
  }
}

function isMissingOptionalSupabaseTable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  return record.code === 'PGRST205'
    || (typeof record.message === 'string' && record.message.includes('Could not find the table'))
}

async function mirrorAiTaskActivityToTurso(
  input: InsertAiTaskActivityMessageInput,
  body: string,
  importance: AiTaskActivityImportance,
  metadata: Record<string, unknown>,
): Promise<AiTaskActivityMessage | null> {
  if (!isTursoConfigured()) return null

  const createdAt = input.createdAt ?? new Date().toISOString()
  const id = activityProgressId(input, body)
  await ensureTursoAiTaskStub({
    id: input.taskId,
    user_id: input.userId,
    created_at: createdAt,
    updated_at: createdAt,
  })
  await insertTaskProgress({
    id,
    task_id: input.taskId,
    user_id: input.userId,
    phase: `activity:${input.kind}`,
    message: body,
    progress_json: {
      source: 'activity_message',
      role: input.role,
      kind: input.kind,
      importance,
      metadata,
    },
    created_at: createdAt,
  })

  return {
    id,
    task_id: input.taskId,
    user_id: input.userId,
    role: input.role,
    kind: input.kind,
    body,
    importance,
    metadata,
    created_at: createdAt,
  }
}

export async function pruneAiTaskActivityMessages(
  supabase: SupabaseLike,
  taskId: string,
  maxMessages = AI_TASK_ACTIVITY_MAX_MESSAGES,
): Promise<{ deleted: number; error?: unknown }> {
  const { data, error } = await supabase
    .from('ai_task_activity_messages')
    .select('id, kind, importance, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) return { deleted: 0, error }

  const deleteIds = selectAiTaskActivityMessageIdsToDelete(
    (data ?? []) as AiTaskActivityMessageForPrune[],
    maxMessages,
  )

  if (deleteIds.length === 0) return { deleted: 0 }

  const { error: deleteError } = await supabase
    .from('ai_task_activity_messages')
    .delete()
    .eq('task_id', taskId)
    .in('id', deleteIds)

  if (deleteError) return { deleted: 0, error: deleteError }
  return { deleted: deleteIds.length }
}

export async function insertAiTaskActivityMessage(
  supabase: SupabaseLike,
  input: InsertAiTaskActivityMessageInput,
): Promise<{ inserted: boolean; message?: AiTaskActivityMessage; error?: unknown }> {
  const body = normalizeAiTaskActivityBody(input.body)
  if (!body) return { inserted: false }

  const importance = input.importance ?? defaultAiTaskActivityImportance(input.kind)
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
  }

  const dedupeCacheKey = input.dedupeKey ? activityProgressId(input, body) : null
  if (dedupeCacheKey && activityDedupeCache.has(dedupeCacheKey)) {
    return { inserted: false }
  }

  if (input.dedupeKey && !tursoActivityPrimaryEnabled()) {
    const { data: existing, error: existingError } = await supabase
      .from('ai_task_activity_messages')
      .select('id, task_id, user_id, role, kind, body, importance, metadata, created_at')
      .eq('task_id', input.taskId)
      .contains('metadata', { dedupe_key: input.dedupeKey })
      .limit(1)
      .maybeSingle()

    if (existingError && !isMissingOptionalSupabaseTable(existingError)) {
      return { inserted: false, error: existingError }
    }
    if (existing) {
      rememberActivityDedupe(dedupeCacheKey)
      return { inserted: false, message: existing as AiTaskActivityMessage }
    }
  }

  let tursoMessage: AiTaskActivityMessage | null = null
  try {
    tursoMessage = await mirrorAiTaskActivityToTurso(input, body, importance, metadata)
  } catch (tursoError) {
    console.error('[ai-task-activity turso]', tursoError)
  }

  if (tursoMessage && tursoActivityPrimaryEnabled()) {
    rememberActivityDedupe(dedupeCacheKey)
    return { inserted: true, message: tursoMessage }
  }

  if (input.dedupeKey && tursoActivityPrimaryEnabled()) {
    const { data: existing, error: existingError } = await supabase
      .from('ai_task_activity_messages')
      .select('id, task_id, user_id, role, kind, body, importance, metadata, created_at')
      .eq('task_id', input.taskId)
      .contains('metadata', { dedupe_key: input.dedupeKey })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      if (tursoMessage && isMissingOptionalSupabaseTable(existingError)) {
        rememberActivityDedupe(dedupeCacheKey)
        return { inserted: true, message: tursoMessage }
      }
      return { inserted: false, error: existingError }
    }
    if (existing) {
      rememberActivityDedupe(dedupeCacheKey)
      return { inserted: false, message: existing as AiTaskActivityMessage }
    }
  }

  const { data, error } = await supabase
    .from('ai_task_activity_messages')
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      role: input.role,
      kind: input.kind,
      body,
      importance,
      metadata,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    })
    .select('id, task_id, user_id, role, kind, body, importance, metadata, created_at')
    .maybeSingle()

  if (error) {
    if (tursoMessage && isMissingOptionalSupabaseTable(error)) {
      rememberActivityDedupe(dedupeCacheKey)
      return { inserted: true, message: tursoMessage }
    }
    return { inserted: false, error }
  }

  const pruneResult = await pruneAiTaskActivityMessages(supabase, input.taskId)
  rememberActivityDedupe(dedupeCacheKey)
  if (pruneResult.error) return { inserted: true, message: data as AiTaskActivityMessage, error: pruneResult.error }
  return { inserted: true, message: data as AiTaskActivityMessage }
}
