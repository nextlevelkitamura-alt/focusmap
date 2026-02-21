import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/utils/supabase/server'

interface EventPayload {
  google_event_id: string
  calendar_id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
  fingerprint: string
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

    // 空配列の場合は即成功
    if (events.length === 0) {
      return NextResponse.json({
        success: true,
        result: { inserted: 0, updated: 0, softDeleted: 0, skipped: 0 },
      })
    }

    // 1. 既存の取り込み済みタスクを取得
    const { data: existingTasks, error: selectError } = await supabase
      .from('tasks')
      .select('id, google_event_id, google_event_fingerprint, updated_at, deleted_at')
      .eq('user_id', user.id)
      .eq('source', 'google_event')
      .is('deleted_at', null)

    if (selectError) {
      console.error('[import-events] Select error:', selectError)
      return NextResponse.json(
        { success: false, error: { code: 'DB_ERROR', message: selectError.message } },
        { status: 500 }
      )
    }

    const existingMap = new Map(
      (existingTasks || []).map(t => [t.google_event_id, t])
    )
    const incomingIds = new Set(events.map(e => e.google_event_id))

    let inserted = 0
    let updated = 0
    let skipped = 0
    let softDeleted = 0

    // 2. 各イベントを処理: INSERT or UPDATE or SKIP
    const toUpsert: Array<Record<string, unknown>> = []

    for (const event of events) {
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
          source: 'google_event',
          stage: 'scheduled',
          google_event_fingerprint: event.fingerprint,
        })
        updated++
      } else {
        // 新規 → INSERT（id を明示的に生成して upsert の null id を防ぐ）
        toUpsert.push({
          id: randomUUID(),
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

    // UPSERT 実行（.select() で結果を返す）
    let upsertedTasks: unknown[] = []
    if (toUpsert.length > 0) {
      const { data: upsertData, error: upsertError } = await supabase
        .from('tasks')
        .upsert(toUpsert)
        .select()

      if (upsertError) {
        console.error('[import-events] Upsert error:', upsertError)
        return NextResponse.json(
          { success: false, error: { code: 'DB_ERROR', message: upsertError.message } },
          { status: 500 }
        )
      }
      upsertedTasks = upsertData || []
    }

    // 3. ソフトデリート: 既存にあるが incoming にないもの
    const orphanIds = (existingTasks || [])
      .filter(t => !incomingIds.has(t.google_event_id) && !t.deleted_at)
      .map(t => t.id)

    if (orphanIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('id', orphanIds)

      if (deleteError) {
        return NextResponse.json(
          { success: false, error: { code: 'DB_ERROR', message: deleteError.message } },
          { status: 500 }
        )
      }
      softDeleted = orphanIds.length
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
