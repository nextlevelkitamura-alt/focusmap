import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/utils/supabase/server'
import { getGoogleEventTaskKey, pickPreferredGoogleEventTask } from '@/lib/google-event-task-dedupe'

interface EventPayload {
  google_event_id: string
  calendar_id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
  is_completed?: boolean
  fingerprint: string
}

type ExistingGoogleEventTaskRow = {
  id: string
  google_event_id: string | null
  google_event_fingerprint: string | null
  status: string | null
  source: string | null
  calendar_id: string | null
  scheduled_at: string | null
  updated_at: string | null
  created_at: string | null
  deleted_at: string | null
}

export interface ImportEventsRequest {
  events: EventPayload[]
}

export interface ImportEventsResponse {
  success: boolean
  result?: {
    inserted: number
    updated: number
    softDeleted: number
    skipped: number
    tasks?: unknown[] // upserted tasks for client-side merge
  }
  error?: { code: string; message: string }
}

const RECENTLY_UPDATED_THRESHOLD_MS = 5 * 60 * 1000 // 5分
const EXISTING_GOOGLE_EVENT_TASK_COLUMNS = 'id, google_event_id, google_event_fingerprint, status, source, calendar_id, scheduled_at, updated_at, created_at, deleted_at'
const UPSERTED_GOOGLE_EVENT_TASK_COLUMNS = 'id, user_id, title, status, stage, scheduled_at, estimated_time, google_event_id, calendar_id, source, deleted_at, google_event_fingerprint, created_at, updated_at'
const QUERY_EVENT_ID_CHUNK_SIZE = 100

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

function isImportedGoogleEventTask(task: { source?: string | null }): boolean {
  return !task.source || task.source === 'google_event'
}

function getEventPayloadKey(event: Pick<EventPayload, 'calendar_id' | 'google_event_id'>): string {
  return `${event.calendar_id || 'unknown'}::${event.google_event_id}`
}

function createStableGoogleEventTaskId(userId: string, calendarId: string, googleEventId: string): string {
  const chars = createHash('sha256')
    .update(`${userId}:${calendarId}:${googleEventId}`)
    .digest('hex')
    .slice(0, 32)
    .split('')

  chars[12] = '5'
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16)

  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-')
}

function getImportedTaskCompletionFields(event: Pick<EventPayload, 'is_completed'>) {
  return event.is_completed === true
    ? { stage: 'done', status: 'done' }
    : { stage: 'scheduled', status: 'todo' }
}

function getCompletedEventPatch(
  event: Pick<EventPayload, 'is_completed'>,
  task: ExistingGoogleEventTaskRow
): { stage: string; status: string } | null {
  if (event.is_completed !== true) return null
  if (!isImportedGoogleEventTask(task)) return null
  if (task.status === 'done') return null
  return { stage: 'done', status: 'done' }
}

function groupIncomingGoogleEventIdsByCalendar(events: EventPayload[]): Map<string, string[]> {
  const idsByCalendar = new Map<string, Set<string>>()
  for (const event of events) {
    if (!event.calendar_id || !event.google_event_id) continue
    const ids = idsByCalendar.get(event.calendar_id) ?? new Set<string>()
    ids.add(event.google_event_id)
    idsByCalendar.set(event.calendar_id, ids)
  }
  return new Map([...idsByCalendar.entries()].map(([calendarId, ids]) => [calendarId, [...ids]]))
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function selectImportedGoogleEventTasksByIncomingKeys(
  supabase: SupabaseClient,
  userId: string,
  eventIdsByCalendar: Map<string, string[]>,
  deletedState: 'active' | 'deleted'
): Promise<{ data: ExistingGoogleEventTaskRow[]; error: { message: string } | null }> {
  const queries: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>[] = []

  for (const [calendarId, googleEventIds] of eventIdsByCalendar.entries()) {
    for (const googleEventIdChunk of chunkArray(googleEventIds, QUERY_EVENT_ID_CHUNK_SIZE)) {
      if (googleEventIdChunk.length === 0) continue
      const query = supabase
        .from('tasks')
        .select(EXISTING_GOOGLE_EVENT_TASK_COLUMNS)
        .eq('user_id', userId)
        .eq('source', 'google_event')
        .eq('calendar_id', calendarId)
        .in('google_event_id', googleEventIdChunk)

      queries.push(
        deletedState === 'active'
          ? query.is('deleted_at', null)
          : query.not('deleted_at', 'is', null)
      )
    }
  }

  if (queries.length === 0) return { data: [], error: null }

  const results = await Promise.all(queries)
  const error = results.find(result => result.error)?.error ?? null
  if (error) return { data: [], error }

  return {
    data: results.flatMap(result => result.data || []) as ExistingGoogleEventTaskRow[],
    error: null,
  }
}

/**
 * カレンダーイベントをタスクとして取り込む
 * POST /api/tasks/import-events
 */
export async function POST(request: NextRequest): Promise<NextResponse<ImportEventsResponse>> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { events } = body as ImportEventsRequest

    // バリデーション
    if (!events || !Array.isArray(events)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'events array is required' } },
        { status: 400 }
      )
    }

    const dedupedEvents = [...new Map(events.map(event => [getEventPayloadKey(event), event])).values()]
    const incomingEventKeys = new Set(dedupedEvents.map(getEventPayloadKey))
    const incomingCalendarIds = new Set(dedupedEvents.map(e => e.calendar_id).filter(Boolean))
    const incomingEventIdsByCalendar = groupIncomingGoogleEventIdsByCalendar(dedupedEvents)
    const incomingStartTimes = dedupedEvents
      .map(e => new Date(e.start_time).getTime())
      .filter(time => !Number.isNaN(time))
    const incomingEndTimes = dedupedEvents
      .map(e => new Date(e.end_time).getTime())
      .filter(time => !Number.isNaN(time))
    const importScopeStart = incomingStartTimes.length > 0 ? Math.min(...incomingStartTimes) : null
    const importScopeEnd = incomingEndTimes.length > 0 ? Math.max(...incomingEndTimes) : null

    // 空配列の場合は即成功
    if (dedupedEvents.length === 0) {
      return NextResponse.json({
        success: true,
        result: { inserted: 0, updated: 0, softDeleted: 0, skipped: 0 },
      })
    }

    // 1. 既存の Google 連携済みタスクを取得する。全履歴は読まず、
    // active は import scope、deleted 復活候補は incoming key に限定する。
    const importScopeStartIso = importScopeStart == null ? null : new Date(importScopeStart).toISOString()
    const importScopeEndIso = importScopeEnd == null ? null : new Date(importScopeEnd).toISOString()
    const incomingCalendarIdList = [...incomingCalendarIds]
    const hasImportScope = !!importScopeStartIso && !!importScopeEndIso && incomingCalendarIdList.length > 0

    let activeTasks: ExistingGoogleEventTaskRow[] = []
    if (hasImportScope) {
      const { data, error: activeSelectError } = await supabase
        .from('tasks')
        .select(EXISTING_GOOGLE_EVENT_TASK_COLUMNS)
        .eq('user_id', user.id)
        .not('google_event_id', 'is', null)
        .in('calendar_id', incomingCalendarIdList)
        .gte('scheduled_at', importScopeStartIso)
        .lt('scheduled_at', importScopeEndIso)
        .is('deleted_at', null)

      if (activeSelectError) {
        console.error('[import-events] Active select error:', activeSelectError)
        return NextResponse.json(
          { success: false, error: { code: 'DB_ERROR', message: activeSelectError.message } },
          { status: 500 }
        )
      }
      activeTasks = (data || []) as ExistingGoogleEventTaskRow[]
    }

    const isInImportScope = (task: { calendar_id?: string | null; scheduled_at?: string | null }) => {
      if (importScopeStart == null || importScopeEnd == null) return false
      if (!task.calendar_id || !incomingCalendarIds.has(task.calendar_id)) return false
      if (!task.scheduled_at) return false
      const scheduledAt = new Date(task.scheduled_at).getTime()
      return !Number.isNaN(scheduledAt) && scheduledAt >= importScopeStart && scheduledAt < importScopeEnd
    }

    const activeTasksToReconcile = activeTasks.filter(task =>
      incomingEventKeys.has(getGoogleEventTaskKey(task) || '') || (isImportedGoogleEventTask(task) && isInImportScope(task))
    )

    const activeTasksByGoogleEventKey = new Map<string, ExistingGoogleEventTaskRow[]>()
    for (const task of activeTasksToReconcile) {
      const eventKey = getGoogleEventTaskKey(task)
      if (!eventKey) continue
      const tasksForEvent = activeTasksByGoogleEventKey.get(eventKey) ?? []
      tasksForEvent.push(task)
      activeTasksByGoogleEventKey.set(eventKey, tasksForEvent)
    }

    const canonicalActiveTasks: ExistingGoogleEventTaskRow[] = []
    const duplicateActiveTaskIds: string[] = []
    for (const tasksForEvent of activeTasksByGoogleEventKey.values()) {
      const preferred = pickPreferredGoogleEventTask(tasksForEvent)
      if (!preferred) continue
      canonicalActiveTasks.push(preferred)
      for (const task of tasksForEvent) {
        if (task.id !== preferred.id && isImportedGoogleEventTask(task)) duplicateActiveTaskIds.push(task.id)
      }
    }

    // 削除済みタスク（復活候補）
    const {
      data: deletedResurrectionCandidates,
      error: deletedSelectError,
    } = await selectImportedGoogleEventTasksByIncomingKeys(
      supabase,
      user.id,
      incomingEventIdsByCalendar,
      'deleted'
    )

    if (deletedSelectError) {
      console.error('[import-events] Deleted resurrection select error:', deletedSelectError)
      return NextResponse.json(
        { success: false, error: { code: 'DB_ERROR', message: deletedSelectError.message } },
        { status: 500 }
      )
    }

    const deletedTasksByGoogleEventKey = new Map<string, ExistingGoogleEventTaskRow[]>()
    for (const task of deletedResurrectionCandidates.filter(t =>
      isImportedGoogleEventTask(t) &&
      t.deleted_at &&
      t.google_event_id &&
      incomingEventKeys.has(getGoogleEventTaskKey(t) || '')
    )) {
      const eventKey = getGoogleEventTaskKey(task)
      if (!eventKey) continue
      const tasksForEvent = deletedTasksByGoogleEventKey.get(eventKey) ?? []
      tasksForEvent.push(task)
      deletedTasksByGoogleEventKey.set(eventKey, tasksForEvent)
    }
    const deletedTaskMap = new Map<string, ExistingGoogleEventTaskRow>()
    for (const [eventKey, tasksForEvent] of deletedTasksByGoogleEventKey.entries()) {
      const preferred = pickPreferredGoogleEventTask(tasksForEvent)
      if (preferred) deletedTaskMap.set(eventKey, preferred)
    }

    const existingMap = new Map<string, ExistingGoogleEventTaskRow>()
    for (const task of canonicalActiveTasks) {
      const eventKey = getGoogleEventTaskKey(task)
      if (eventKey) existingMap.set(eventKey, task)
    }

    let inserted = 0
    let updated = 0
    let skipped = 0
    let softDeleted = 0

    // 2. 各イベントを処理: INSERT or UPDATE or SKIP
    const toUpsert: Array<Record<string, unknown>> = []

    for (const event of dedupedEvents) {
      const eventKey = getEventPayloadKey(event)
      const existing = existingMap.get(eventKey)

      if (existing) {
        // updated_at が5分以内ならスキップ（ユーザー操作中保護）
        if (existing.updated_at) {
          const diff = Date.now() - new Date(existing.updated_at).getTime()
          if (diff < RECENTLY_UPDATED_THRESHOLD_MS) {
            skipped++
            continue
          }
        }

        const completedPatch = getCompletedEventPatch(event, existing)

        // fingerprint 一致ならスキップ。ただし完了済み予定から作られた自動取り込みtaskだけは補正する。
        if (existing.google_event_fingerprint === event.fingerprint) {
          if (completedPatch) {
            toUpsert.push({
              id: existing.id,
              user_id: user.id,
              ...completedPatch,
            })
            updated++
            continue
          }
          skipped++
          continue
        }

        // fingerprint 不一致 → UPDATE
        toUpsert.push({
          id: existing.id,
          user_id: user.id,
          title: event.title,
          google_event_id: event.google_event_id,
          calendar_id: event.calendar_id,
          scheduled_at: event.start_time,
          estimated_time: Math.round(
            (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
          ),
          source: existing.source || 'google_event',
          stage: completedPatch?.stage || 'scheduled',
          ...(completedPatch ? { status: completedPatch.status } : {}),
          google_event_fingerprint: event.fingerprint,
        })
        updated++
      } else {
        // 削除済みタスクが存在する場合は復活させる（重複作成防止）
        const deletedTask = deletedTaskMap.get(eventKey)
        if (deletedTask) {
          const completionFields = getImportedTaskCompletionFields(event)
          toUpsert.push({
            id: deletedTask.id,
            user_id: user.id,
            title: event.title,
            google_event_id: event.google_event_id,
            calendar_id: event.calendar_id,
            scheduled_at: event.start_time,
            estimated_time: Math.round(
              (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
            ),
            source: 'google_event',
            stage: completionFields.stage,
            status: completionFields.status,
            deleted_at: null, // 復活
            google_event_fingerprint: event.fingerprint,
          })
          updated++
        } else {
          const completionFields = getImportedTaskCompletionFields(event)
          // 完全新規 → INSERT（同時 import でも同じ予定は同じ id に収束させる）
          toUpsert.push({
            id: createStableGoogleEventTaskId(user.id, event.calendar_id, event.google_event_id),
            user_id: user.id,
            title: event.title,
            google_event_id: event.google_event_id,
            calendar_id: event.calendar_id,
            scheduled_at: event.start_time,
            estimated_time: Math.round(
              (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
            ),
            source: 'google_event',
            stage: completionFields.stage,
            status: completionFields.status,
            google_event_fingerprint: event.fingerprint,
          })
          inserted++
        }
      }
    }

    // UPSERT 実行（.select() で結果を返す）
    let upsertedTasks: unknown[] = []
    if (toUpsert.length > 0) {
      const { data: upsertData, error: upsertError } = await supabase
        .from('tasks')
        .upsert(toUpsert)
        .select(UPSERTED_GOOGLE_EVENT_TASK_COLUMNS)

      if (upsertError) {
        if (upsertError.code === '23505') {
          console.warn('[import-events] Concurrent import hit unique google_event_id constraint; keeping existing task rows')
        } else {
          console.error('[import-events] Upsert error:', upsertError)
          return NextResponse.json(
            { success: false, error: { code: 'DB_ERROR', message: upsertError.message } },
            { status: 500 }
          )
        }
      } else {
        upsertedTasks = upsertData || []
      }
    }

    // 3. ソフトデリート: アクティブなタスクのうち incoming にないもの + 重複行
    const orphanIds = activeTasksToReconcile
      .filter(t => isImportedGoogleEventTask(t) && isInImportScope(t) && !incomingEventKeys.has(getGoogleEventTaskKey(t) || ''))
      .map(t => t.id)
    const softDeleteIds = new Set([...orphanIds, ...duplicateActiveTaskIds])

    // 同時 import が select 後に重複行を作った場合も、このリクエストの完了時点で畳み込む。
    const {
      data: postUpsertActiveTasks,
      error: postUpsertSelectError,
    } = await selectImportedGoogleEventTasksByIncomingKeys(
      supabase,
      user.id,
      incomingEventIdsByCalendar,
      'active'
    )

    if (postUpsertSelectError) {
      console.error('[import-events] Post-upsert select error:', postUpsertSelectError)
      return NextResponse.json(
        { success: false, error: { code: 'DB_ERROR', message: postUpsertSelectError.message } },
        { status: 500 }
      )
    }

    const postUpsertTasksByGoogleEventKey = new Map<string, typeof activeTasks>()
    for (const task of postUpsertActiveTasks || []) {
      const eventKey = getGoogleEventTaskKey(task)
      if (!eventKey) continue
      const tasksForEvent = postUpsertTasksByGoogleEventKey.get(eventKey) ?? []
      tasksForEvent.push(task)
      postUpsertTasksByGoogleEventKey.set(eventKey, tasksForEvent)
    }

    for (const tasksForEvent of postUpsertTasksByGoogleEventKey.values()) {
      if (tasksForEvent.length < 2) continue
      const preferred = pickPreferredGoogleEventTask(tasksForEvent)
      if (!preferred) continue
      for (const task of tasksForEvent) {
        if (task.id !== preferred.id) softDeleteIds.add(task.id)
      }
    }

    const uniqueSoftDeleteIds = [...softDeleteIds]
    if (uniqueSoftDeleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('tasks')
        .update({
          deleted_at: new Date().toISOString(),
          is_timer_running: false,
          last_started_at: null,
        })
        .eq('user_id', user.id)
        .in('id', uniqueSoftDeleteIds)

      if (deleteError) {
        return NextResponse.json(
          { success: false, error: { code: 'DB_ERROR', message: deleteError.message } },
          { status: 500 }
        )
      }
      softDeleted = uniqueSoftDeleteIds.length
    }

    return NextResponse.json({
      success: true,
      result: { inserted, updated, softDeleted, skipped, tasks: upsertedTasks },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[import-events] Error:', err)
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message } },
      { status: 500 }
    )
  }
}
