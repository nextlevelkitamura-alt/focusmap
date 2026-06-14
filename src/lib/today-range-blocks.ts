import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { eventToTimeBlock, taskToTimeBlock, type TimeBlock } from "@/lib/time-block"
import { dedupeGoogleEventTasks } from "@/lib/google-event-task-dedupe"

const DEFAULT_CALENDAR_EVENT_COLOR = "#039BE5"

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() + 1)
  return d
}

function overlapsDay(start: Date, end: Date, dayStart: Date, dayEnd: Date): boolean {
  return end.getTime() > dayStart.getTime() && start.getTime() < dayEnd.getTime()
}

function isDisplayableTask(task: Task, habitGroupIds: Set<string>): boolean {
  if (task.deleted_at) return false
  if (task.is_group) return false
  if (task.is_habit) return false
  if (habitGroupIds.has(task.parent_task_id ?? "")) return false
  if (!task.scheduled_at) return false
  return true
}

export function buildTimeBlocksForDay({
  date,
  events,
  tasks,
  calendarColorMap,
}: {
  date: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
}): TimeBlock[] {
  const dayStart = startOfDay(date)
  const dayEnd = endOfDay(date)
  const habitGroupIds = new Set(tasks.filter((task) => task.is_habit).map((task) => task.id))
  const dayTasks = dedupeGoogleEventTasks(tasks.filter((task) => {
    if (!isDisplayableTask(task, habitGroupIds) || !task.scheduled_at) return false
    const start = new Date(task.scheduled_at)
    const duration = task.estimated_time || 30
    const end = new Date(start.getTime() + duration * 60 * 1000)
    return overlapsDay(start, end, dayStart, dayEnd)
  }))

  const scheduledTaskIds = new Set(dayTasks.map((task) => task.id))
  const taskGoogleEventKeys = new Set(
    dayTasks
      .filter((task) => task.google_event_id && task.calendar_id)
      .map((task) => `${task.calendar_id}::${task.google_event_id}`),
  )
  const scheduledTaskEventKeys = new Set(
    dayTasks
      .filter((task) => task.scheduled_at && task.calendar_id)
      .map((task) => {
        const minute = Math.floor(new Date(task.scheduled_at!).getTime() / 60000)
        return `${task.calendar_id || ""}|${task.title.trim().toLowerCase()}|${minute}`
      }),
  )
  const eventLikeTaskKeys = new Set(
    dayTasks
      .filter((task) => task.source === "google_event" && !!task.scheduled_at)
      .map((task) => {
        const minute = Math.floor(new Date(task.scheduled_at!).getTime() / 60000)
        return `${task.calendar_id || ""}|${task.title.trim().toLowerCase()}|${minute}`
      }),
  )

  const items: TimeBlock[] = []

  for (const event of events) {
    if (event.is_all_day) continue
    const start = new Date(event.start_time)
    const end = new Date(event.end_time)
    if (!overlapsDay(start, end, dayStart, dayEnd)) continue
    if (event.task_id && scheduledTaskIds.has(event.task_id)) continue
    if (event.google_event_id && taskGoogleEventKeys.has(`${event.calendar_id}::${event.google_event_id}`)) continue

    const eventMinute = Math.floor(start.getTime() / 60000)
    const eventKey = `${event.calendar_id || ""}|${event.title.trim().toLowerCase()}|${eventMinute}`
    if (scheduledTaskEventKeys.has(eventKey)) continue
    if (eventLikeTaskKeys.has(eventKey)) continue

    const color =
      calendarColorMap?.get(event.calendar_id || "") ||
      event.background_color ||
      (event.sync_status === "pending" ? "#F59E0B" : DEFAULT_CALENDAR_EVENT_COLOR)

    const block = eventToTimeBlock({ ...event, background_color: color })
    if (block.startTime.getTime() < dayStart.getTime()) block.startTime = new Date(dayStart)
    if (block.endTime.getTime() > dayEnd.getTime()) block.endTime = new Date(dayEnd)
    items.push(block)
  }

  for (const task of dayTasks) {
    if (!task.scheduled_at) continue
    const color = task.google_event_id && task.calendar_id
      ? calendarColorMap?.get(task.calendar_id || "")
      : undefined
    const block = taskToTimeBlock(task, undefined, color)
    if (block.startTime.getTime() < dayStart.getTime()) block.startTime = new Date(dayStart)
    if (block.endTime.getTime() > dayEnd.getTime()) block.endTime = new Date(dayEnd)
    items.push(block)
  }

  return items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
}

export function getAllDayEventsForDay({
  date,
  events,
  calendarColorMap,
}: {
  date: Date
  events: CalendarEvent[]
  calendarColorMap?: Map<string, string>
}): CalendarEvent[] {
  const dayStart = startOfDay(date)
  const dayEnd = endOfDay(date)

  return events
    .filter((event) => {
      if (!event.is_all_day) return false
      return overlapsDay(new Date(event.start_time), new Date(event.end_time), dayStart, dayEnd)
    })
    .map((event) => ({
      ...event,
      background_color: calendarColorMap?.get(event.calendar_id || "") || event.background_color || DEFAULT_CALENDAR_EVENT_COLOR,
    }))
}

export function countScheduleItemsForDay({
  date,
  events,
  tasks,
  calendarColorMap,
}: {
  date: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
}): number {
  return (
    getAllDayEventsForDay({ date, events, calendarColorMap }).length +
    buildTimeBlocksForDay({ date, events, tasks, calendarColorMap }).length
  )
}

export function countScheduleItemsForDateRange({
  startDate,
  dayCount,
  events,
  tasks,
  calendarColorMap,
}: {
  startDate: Date
  dayCount: number
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
}): number {
  let count = 0
  for (let i = 0; i < dayCount; i += 1) {
    const date = startOfDay(startDate)
    date.setDate(date.getDate() + i)
    count += countScheduleItemsForDay({ date, events, tasks, calendarColorMap })
  }
  return count
}

export function countScheduleItemsForMonth({
  date,
  events,
  tasks,
  calendarColorMap,
}: {
  date: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
}): number {
  const cursor = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  let count = 0

  while (cursor <= end) {
    count += countScheduleItemsForDay({ date: cursor, events, tasks, calendarColorMap })
    cursor.setDate(cursor.getDate() + 1)
  }

  return count
}
