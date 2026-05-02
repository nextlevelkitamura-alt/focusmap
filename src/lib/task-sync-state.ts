import type { Task } from "@/types/database"

export function isTaskSyncing(task: Task): boolean {
    return !!task.calendar_id && !!task.scheduled_at && !task.google_event_id
}
