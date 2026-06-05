export type TaskProgressStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'needs_input'
  | 'completed'
  | 'failed'

export type TaskProgressSnapshotTask = {
  id: string
  title: string | null
  status: TaskProgressStatus
  executor: string | null
  codex_thread_id: string | null
  current_step: string | null
  progress_percent: number | null
  summary: string | null
  updated_at: string
  source_type?: string | null
  source_id?: string | null
}

export type TaskProgressSnapshotResponse = {
  source: string
  server_time: string
  cursor: string | null
  tasks: TaskProgressSnapshotTask[]
}

export type TaskProgressLogEntry = {
  id: string
  task_id: string
  user_id?: string
  phase?: string | null
  message?: string | null
  progress_json?: Record<string, unknown> | null
  created_at?: string | null
}

export type TaskProgressEventEntry = {
  id: string
  task_id: string
  user_id?: string
  event_type: string
  payload_json?: Record<string, unknown> | null
  created_at?: string | null
}

export type TaskProgressDetailResponse = {
  source: string
  task: TaskProgressSnapshotTask & {
    error_message?: string | null
    started_at?: string | null
    completed_at?: string | null
    last_activity_at?: string | null
  }
  progress: TaskProgressLogEntry[]
  events: TaskProgressEventEntry[]
}
