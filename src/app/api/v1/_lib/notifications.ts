import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Schedule notifications for a task based on user's notification settings.
 * Fire-and-forget: errors are logged but don't propagate.
 */
export async function scheduleNotificationsForTask(
  serviceClient: SupabaseClient,
  userId: string,
  task: { id: string; title: string; scheduled_at: string },
): Promise<void> {
  // Get user's notification settings
  const { data: settings } = await serviceClient
    .from('notification_settings')
    .select('notification_type, is_enabled, advance_minutes')
    .eq('user_id', userId)
    .in('notification_type', ['task_start', 'task_due'])

  if (!settings || settings.length === 0) return

  const scheduledAt = new Date(task.scheduled_at)
  if (isNaN(scheduledAt.getTime())) return

  const notifications = settings
    .filter(s => s.is_enabled)
    .map(s => {
      const notifyAt = new Date(scheduledAt.getTime() - (s.advance_minutes ?? 15) * 60 * 1000)
      // Skip if notification time is in the past
      if (notifyAt <= new Date()) return null
      return {
        user_id: userId,
        target_type: 'task',
        target_id: task.id,
        notification_type: s.notification_type,
        title: s.notification_type === 'task_start' ? 'タスク開始' : 'タスク期限',
        body: task.title,
        scheduled_at: notifyAt.toISOString(),
        action_url: `/dashboard`,
      }
    })
    .filter(Boolean)

  if (notifications.length === 0) return

  const { error } = await serviceClient
    .from('notification_queue')
    .insert(notifications)

  if (error) {
    console.warn('[v1/notifications] Failed to schedule:', error.message)
  }
}

/**
 * Cancel pending notifications for a task.
 */
export async function cancelNotificationsForTask(
  serviceClient: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await serviceClient
    .from('notification_queue')
    .delete()
    .eq('user_id', userId)
    .eq('target_type', 'task')
    .eq('target_id', taskId)
    .eq('is_sent', false)

  if (error) {
    console.warn('[v1/notifications] Failed to cancel:', error.message)
  }
}
