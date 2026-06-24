export type TaskCodexProjectionStatus =
  | 'running'
  | 'awaiting_approval'
  | 'failed'
  | 'archived'
  | 'done'

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isUsableCodexSourceTaskRecord(value: unknown) {
  if (!isRecord(value)) return false
  if (value.deleted_at != null || value.deletedAt != null) return false
  return stringValue(value.source) !== 'codex_inbox'
}

export function codexThreadIdFromAgentResult(result: unknown) {
  if (!isRecord(result)) return null
  return stringValue(result.codex_thread_id)
}

export function taskCodexStatusFromAiHistory(input: {
  status?: unknown
  archived?: unknown
  deleted_at?: unknown
  deletedAt?: unknown
}): TaskCodexProjectionStatus | null {
  if (input.archived === true || input.deleted_at || input.deletedAt) return 'archived'
  switch (stringValue(input.status)) {
    case 'running':
      return 'running'
    case 'awaiting_approval':
    case 'needs_input':
    case 'completed':
      return 'awaiting_approval'
    case 'failed':
    case 'connection_failed':
      return 'failed'
    case 'done':
      return 'done'
    default:
      return null
  }
}

export function taskCodexStatusFromAiTaskState(input: {
  status?: unknown
  result?: unknown
}): TaskCodexProjectionStatus | null {
  const result = isRecord(input.result) ? input.result : {}
  const meta = isRecord(result.meta) ? result.meta : {}
  if (
    result.codex_review_reason === 'archived' ||
    result.codex_thread_archived === true ||
    meta.thread_archived === true
  ) {
    return 'archived'
  }

  const status = stringValue(input.status)
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'awaiting_approval'

  const runState = stringValue(result.codex_run_state)
  if (runState === 'running') return 'running'
  if (runState === 'awaiting_approval' || runState === 'stale_no_terminal_event') return 'awaiting_approval'

  switch (status) {
    case 'running':
      return 'running'
    case 'awaiting_approval':
    case 'needs_input':
    case 'completed':
      return 'awaiting_approval'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}
