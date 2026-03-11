import type { SupabaseClient } from '@supabase/supabase-js'
import { syncTaskToCalendar } from '@/lib/google-calendar'

/**
 * REST API v1用のカレンダー同期ヘルパー。
 * ユーザーのカレンダー設定を確認し、有効な場合のみ同期する。
 * Fire-and-forget: エラーはログのみ。
 */
export async function syncTaskToCalendarV1(
  serviceClient: SupabaseClient,
  userId: string,
  task: {
    id: string
    title: string
    scheduled_at: string
    estimated_time: number
    google_event_id?: string | null
    calendar_id?: string
  },
): Promise<{ googleEventId?: string }> {
  // カレンダー同期が有効か確認
  const { data: settings } = await serviceClient
    .from('user_calendar_settings')
    .select('is_sync_enabled, default_calendar_id')
    .eq('user_id', userId)
    .single()

  if (!settings?.is_sync_enabled) {
    return {}
  }

  try {
    const result = await syncTaskToCalendar(
      userId,
      task.id,
      {
        title: task.title,
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        google_event_id: task.google_event_id,
        calendar_id: task.calendar_id || settings.default_calendar_id,
      },
      serviceClient,
    )
    return { googleEventId: result.googleEventId }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[v1/calendar-sync] Failed to sync:', message)
    return {}
  }
}
