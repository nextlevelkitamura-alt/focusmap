import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/utils/supabase/server'
import { pickPreferredGoogleEventTask } from '@/lib/google-event-task-dedupe'

interface EventPayload {
  google_event_id: string
  calendar_id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
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

function isImportedGoogleEventTask(task: { source?: string | null }): boolean {
  return !task.source || task.source === 'google_event'
}

function createStableGoogleEventTaskId(userId: string, googleEventId: string): string {
  const chars = createHash('sha256')
    .update(`${userId}:${googleEventId}`)
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

    const dedupedEvents = [...new Map(events.map(event => [event.google_event_id, event])).values()]
    const incomingIds = new Set(dedupedEvents.map(e => e.google_event_id))
    const incomingCalendarIds = new Set(dedupedEvents.map(e => e.calendar_id).filter(Boolean))
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

    // 1. 既存の Google 連携済みタスクを取得（削除済みも含む — 復活させるため）
    const { data: allExistingTasks, error: selectError } = await supabase
      .from('tasks')
      .select('id, google_event_id, google_event_fingerprint, status, source, calendar_id, scheduled_at, updated_at, created_at, deleted_at')
      .eq('user_id', user.id)
      .not('google_event_id', 'is', null)

    if (selectError) {
      console.error('[import-events] Select error:', selectError)
      return NextResponse.json(
        { success: false, error: { code: 'DB_ERROR', message: selectError.message } },
        { status: 500 }
      )
    }

    const existingTasks = (allExistingTasks || []) as ExistingGoogleEventTaskRow[]
    // アクティブなタスク（deleted_at = null）
    const activeTasks = existingTasks.filter(t => !t.deleted_at)
    const isInImportScope = (task: { calendar_id?: string | null; scheduled_at?: string | null }) => {
      if (importScopeStart == null || importScopeEnd == null) return false
      if (!task.calendar_id || !incomingCalendarIds.has(task.calendar_id)) return false
      if (!task.scheduled_at) return false
      const scheduledAt = new Date(task.scheduled_at).getTime()
      return !Number.isNaN(scheduledAt) && scheduledAt >= importScopeStart && scheduledAt < importScopeEnd
    }

    const activeTasksToReconcile = activeTasks.filter(task =>
      incomingIds.has(task.google_event_id || '') || (isImportedGoogleEventTask(task) && isInImportScope(task))
    )

    const activeTasksByGoogleEventId = new Map<string, ExistingGoogleEventTaskRow[]>()
    for (const task of activeTasksToReconcile) {
      if (!task.google_event_id) continue
      const tasksForEvent = activeTasksByGoogleEventId.get(task.google_event_id) ?? []
      tasksForEvent.push(task)
      activeTasksByGoogleEventId.set(task.google_event_id, tasksForEvent)
    }

    const canonicalActiveTasks: ExistingGoogleEventTaskRow[] = []
    const duplicateActiveTaskIds: string[] = []
    for (const tasksForEvent of activeTasksByGoogleEventId.values()) {
      const preferred = pickPreferredGoogleEventTask(tasksForEvent)
      if (!preferred) continue
      canonicalActiveTasks.push(preferred)
      for (const task of tasksForEvent) {
        if (task.id !== preferred.id && isImportedGoogleEventTask(task)) duplicateActiveTaskIds.push(task.id)
      }
    }

    // 削除済みタスク（復活候補）
    const deletedTasksByGoogleEventId = new Map<string, ExistingGoogleEventTaskRow[]>()
    for (const task of existingTasks.filter(t => isImportedGoogleEventTask(t) && t.deleted_at && t.google_event_id)) {
      if (!task.google_event_id) continue
      const tasksForEvent = deletedTasksByGoogleEventId.get(task.google_event_id) ?? []
      tasksForEvent.push(task)
      deletedTasksByGoogleEventId.set(task.google_event_id, tasksForEvent)
    }
    const deletedTaskMap = new Map(
      [...deletedTasksByGoogleEventId.entries()]
        .map(([googleEventId, tasksForEvent]) => [googleEventId, pickPreferredGoogleEventTask(tasksForEvent)])
        .filter((entry): entry is [string, NonNullable<(typeof activeTasks)[number]>] => !!entry[1])
    )

    const existingMap = new Map(
      canonicalActiveTasks.map(t => [t.google_event_id, t])
    )

    let inserted = 0
    let updated = 0
    let skipped = 0
    let softDeleted = 0

    // 2. 各イベントを処理: INSERT or UPDATE or SKIP
    const toUpsert: Array<Record<string, unknown>> = []

    for (const event of dedupedEvents) {
      const existing = existingMap.get(event.google_event_id)

      if (existing) {
        // updated_at が5分以内ならスキップ（ユーザー操作中保護）
        if (existing.updated_at) {
          const diff = Date.now() - new Date(existing.updated_at).getTime()
          if (diff < RECENTLY_UPDATED_THRESHOLD_MS) {
            skipped++
            continue
          }
        }

        // fingerprint 一致ならスキップ
        if (existing.google_event_fingerprint === event.fingerprint) {
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
          stage: 'scheduled',
          google_event_fingerprint: event.fingerprint,
        })
        updated++
      } else {
        // 削除済みタスクが存在する場合は復活させる（重複作成防止）
        const deletedTask = deletedTaskMap.get(event.google_event_id)
        if (deletedTask) {
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
            stage: 'scheduled',
            deleted_at: null, // 復活
            google_event_fingerprint: event.fingerprint,
          })
          updated++
        } else {
          // 完全新規 → INSERT（同時 import でも同じ予定は同じ id に収束させる）
          toUpsert.push({
            id: createStableGoogleEventTaskId(user.id, event.google_event_id),
            user_id: user.id,
            title: event.title,
            google_event_id: event.google_event_id,
            calendar_id: event.calendar_id,
            scheduled_at: event.start_time,
            estimated_time: Math.round(
              (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
            ),
            source: 'google_event',
            stage: 'scheduled',
            status: 'todo',
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
        .select()

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
      .filter(t => isImportedGoogleEventTask(t) && isInImportScope(t) && !incomingIds.has(t.google_event_id || ''))
      .map(t => t.id)
    const softDeleteIds = new Set([...orphanIds, ...duplicateActiveTaskIds])

    // 同時 import が select 後に重複行を作った場合も、このリクエストの完了時点で畳み込む。
    const { data: postUpsertActiveTasks, error: postUpsertSelectError } = await supabase
      .from('tasks')
      .select('id, google_event_id, google_event_fingerprint, status, source, calendar_id, scheduled_at, updated_at, created_at, deleted_at')
      .eq('user_id', user.id)
      .eq('source', 'google_event')
      .in('google_event_id', [...incomingIds])
      .is('deleted_at', null)

    if (postUpsertSelectError) {
      console.error('[import-events] Post-upsert select error:', postUpsertSelectError)
      return NextResponse.json(
        { success: false, error: { code: 'DB_ERROR', message: postUpsertSelectError.message } },
        { status: 500 }
      )
    }

    const postUpsertTasksByGoogleEventId = new Map<string, typeof activeTasks>()
    for (const task of postUpsertActiveTasks || []) {
      if (!task.google_event_id) continue
      const tasksForEvent = postUpsertTasksByGoogleEventId.get(task.google_event_id) ?? []
      tasksForEvent.push(task)
      postUpsertTasksByGoogleEventId.set(task.google_event_id, tasksForEvent)
    }

    for (const tasksForEvent of postUpsertTasksByGoogleEventId.values()) {
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
