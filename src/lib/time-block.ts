/**
 * TimeBlock: タスクとカレンダーイベントを統一的に扱う型と変換関数
 *
 * カレンダー/今日ビューでは、Googleカレンダーイベントもタスクも
 * 同じ「TimeBlock」として表示する。
 */

import type { Task } from '@/types/database'
import type { CalendarEvent } from '@/types/calendar'

// ============================================================
// TimeBlock 型定義
// ============================================================

export interface TimeBlock {
  id: string
  source: 'google_event' | 'task'
  title: string
  startTime: Date
  endTime: Date
  // 表示属性
  color: string
  isCompleted: boolean
  isTimerRunning: boolean
  // 参照ID
  taskId?: string
  googleEventId?: string
  calendarId?: string
  projectId?: string
  // タスク固有
  estimatedTime?: number
  priority?: 'high' | 'medium' | 'low'
  totalElapsedSeconds?: number
  // 元データ（編集時に使用）
  originalTask?: Task
  originalEvent?: CalendarEvent
}

// ============================================================
// 変換関数
// ============================================================

const DEFAULT_TASK_COLOR = '#3B82F6'      // blue-500
const DEFAULT_EVENT_COLOR = '#039BE5'     // Google Calendar default
const DEFAULT_DURATION_MINUTES = 30

/**
 * Task → TimeBlock 変換
 */
export function taskToTimeBlock(
  task: Task,
  projectColor?: string,
  calendarColor?: string,
  originalEvent?: CalendarEvent
): TimeBlock {
  const start = new Date(task.scheduled_at!)
  const durationMinutes = task.estimated_time || DEFAULT_DURATION_MINUTES
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)

  let priority: TimeBlock['priority'] = undefined
  if (task.priority === 3) priority = 'high'
  else if (task.priority === 2) priority = 'medium'
  else if (task.priority === 1) priority = 'low'

  // Treat any Google-linked task as calendar-backed for color consistency.
  const isGoogleLinked = !!task.google_event_id

  // Google-linked tasks use calendar color, manual tasks use project color
  const color = isGoogleLinked
    ? (calendarColor || DEFAULT_EVENT_COLOR)
    : (projectColor || DEFAULT_TASK_COLOR)

  return {
    id: task.id,
    source: isGoogleLinked ? 'google_event' : 'task',
    title: task.title,
    startTime: start,
    endTime: end,
    color,
    isCompleted: task.status === 'done',
    isTimerRunning: task.is_timer_running,
    taskId: task.id,
    googleEventId: task.google_event_id || undefined,
    calendarId: task.calendar_id || undefined,
    projectId: task.project_id || undefined,
    estimatedTime: task.estimated_time,
    priority,
    totalElapsedSeconds: task.total_elapsed_seconds,
    originalTask: task,
    originalEvent,
  }
}

/**
 * CalendarEvent → TimeBlock 変換
 */
export function eventToTimeBlock(event: CalendarEvent): TimeBlock {
  return {
    id: event.id,
    source: 'google_event',
    title: event.title,
    startTime: new Date(event.start_time),
    endTime: new Date(event.end_time),
    color: event.background_color || DEFAULT_EVENT_COLOR,
    isCompleted: event.is_completed ?? false,
    isTimerRunning: false,
    googleEventId: event.google_event_id,
    calendarId: event.calendar_id,
    taskId: event.task_id,
    priority: event.priority,
    estimatedTime: event.estimated_time,
    originalEvent: event,
  }
}

/**
 * タスクとイベントをマージして TimeBlock[] を生成
 *
 * - タスクに google_event_id がある場合、対応するイベントは除外（タスクが優先）
 * - 終日イベントは除外
 * - 時間順にソート
 */
export function mergeTimeBlocks(
  events: CalendarEvent[],
  tasks: Task[],
  projectColorMap?: Map<string, string>,
  calendarColorMap?: Map<string, string>
): TimeBlock[] {
  const eventByGoogleId = new Map(
    events.map((event) => [event.google_event_id, event] as const)
  )

  // タスクが持つ google_event_id を集める
  const taskGoogleIds = new Set(
    tasks
      .filter((t) => t.google_event_id)
      .map((t) => t.google_event_id!)
  )

  // タスクを TimeBlock に変換
  const taskBlocks = tasks.map((t) =>
    taskToTimeBlock(
      t,
      projectColorMap?.get(t.project_id || ''),
      calendarColorMap?.get(t.calendar_id || ''),
      t.google_event_id ? eventByGoogleId.get(t.google_event_id) : undefined
    )
  )

  // イベントを TimeBlock に変換（タスク重複・終日を除外）
  const eventBlocks = events
    .filter(
      (e) => !e.is_all_day && !taskGoogleIds.has(e.google_event_id)
    )
    .map((e) => eventToTimeBlock(e))

  // マージしてソート
  return [...taskBlocks, ...eventBlocks].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  )
}
