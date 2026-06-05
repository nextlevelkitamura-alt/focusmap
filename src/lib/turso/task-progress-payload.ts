const MAX_TASK_PROGRESS_JSON_CHARS = 6_000

const BLOCKED_PROGRESS_JSON_KEYS = new Set([
  'live_log',
  'output',
  'raw_log',
  'raw_output',
  'thread_full_history',
  'codex_thread_snapshot',
  'image',
  'image_body',
  'screenshot',
  'body',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeTaskProgressJson(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.slice(0, 600)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= 3) return value.length
    return value.slice(-20).map(item => sanitizeTaskProgressJson(item, depth + 1))
  }
  if (!isRecord(value)) return null
  if (depth >= 3) return { keys: Object.keys(value).slice(0, 20) }

  const entries = Object.entries(value)
    .filter(([key]) => !BLOCKED_PROGRESS_JSON_KEYS.has(key.toLowerCase()))
    .slice(0, 40)
    .map(([key, item]) => [key.slice(0, 80), sanitizeTaskProgressJson(item, depth + 1)])
  return Object.fromEntries(entries)
}

export function boundedTaskProgressJson(value: unknown) {
  if (value === undefined || value === null) return null
  const sanitized = sanitizeTaskProgressJson(value)
  const serialized = JSON.stringify(sanitized)
  if (serialized.length > MAX_TASK_PROGRESS_JSON_CHARS) {
    throw new Error(`json payload must be ${MAX_TASK_PROGRESS_JSON_CHARS} chars or less`)
  }
  return sanitized
}
