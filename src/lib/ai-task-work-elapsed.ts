export type AiTaskWorkElapsedLike = {
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  result?: Record<string, unknown> | null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function parseAiTaskWorkTimeMs(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  return null
}

export function getAiTaskWorkStartedMs(task: AiTaskWorkElapsedLike | null | undefined) {
  if (!task) return null
  const result = recordValue(task.result)
  return parseAiTaskWorkTimeMs(result.started_at) ??
    parseAiTaskWorkTimeMs(task.started_at) ??
    parseAiTaskWorkTimeMs(task.created_at)
}

export function getAiTaskWorkFinishedMs(task: AiTaskWorkElapsedLike | null | undefined) {
  if (!task) return null
  const result = recordValue(task.result)
  const progressSummary = recordValue(result.progress_summary)
  return parseAiTaskWorkTimeMs(result.awaiting_approval_at) ??
    parseAiTaskWorkTimeMs(task.completed_at) ??
    parseAiTaskWorkTimeMs(result.last_activity_at) ??
    parseAiTaskWorkTimeMs(progressSummary.checked_at) ??
    parseAiTaskWorkTimeMs(progressSummary.last_activity_at)
}

export function getAiTaskWorkElapsedMs(
  task: AiTaskWorkElapsedLike | null | undefined,
  options: { nowMs?: number; active?: boolean } = {},
) {
  const startedMs = getAiTaskWorkStartedMs(task)
  if (startedMs === null) return null
  const endedMs = options.active
    ? options.nowMs ?? Date.now()
    : getAiTaskWorkFinishedMs(task)
  if (endedMs === null) return null
  return Math.max(0, endedMs - startedMs)
}

export function formatAiTaskWorkElapsedMs(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest > 0 ? `${hours}h ${minuteRest}m` : `${hours}h`
}

export function formatAiTaskWorkLabel(ms: number | null | undefined, active: boolean) {
  const elapsed = formatAiTaskWorkElapsedMs(ms)
  if (!elapsed) return null
  return active ? `作業中 ${elapsed}` : `作業時間 ${elapsed}`
}
