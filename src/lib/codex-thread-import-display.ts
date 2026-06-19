const SECTION_HEADING_RE = /^##\s+(.+?)\s*$/
const IMPORTED_THREAD_UPDATED_AT_RE = /(?:^|\n)\s*-\s*最終更新:\s*([^\n]+)/u

function compactDisplayText(value: unknown, maxChars = 2_000) {
  if (typeof value !== "string") return null
  const text = value.replace(/\r\n?/g, "\n").trim()
  return text ? text.slice(0, maxChars) : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isoFromTime(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 10_000_000_000 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  const text = stringValue(value)
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? text : null
}

function firstValidTime(...values: unknown[]) {
  for (const value of values) {
    const iso = isoFromTime(value)
    if (iso) return iso
  }
  return null
}

export function markdownSectionBody(markdown: unknown, heading: string) {
  if (typeof markdown !== "string" || !markdown.trim()) return null
  const target = heading.trim()
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const body: string[] = []
  let inSection = false

  for (const line of lines) {
    const match = line.match(SECTION_HEADING_RE)
    if (match) {
      if (inSection) break
      inSection = match[1]?.trim() === target
      continue
    }
    if (inSection) body.push(line)
  }

  return compactDisplayText(body.join("\n"))
}

export function codexThreadPromptPreviewFromMemo(memo: unknown, fallback?: unknown) {
  return markdownSectionBody(memo, "初回依頼") ?? compactDisplayText(fallback)
}

export function codexThreadDisplayTitle(input: {
  taskTitle?: unknown
  progressTitle?: unknown
  aiResult?: unknown
  fallback?: unknown
}) {
  const result = recordValue(input.aiResult)
  const meta = recordValue(result?.meta)
  const taskTitle = compactDisplayText(input.taskTitle, 120)
  const progressTitle = compactDisplayText(input.progressTitle, 120)

  return compactDisplayText(meta?.source_task_title, 120)
    ?? (progressTitle && progressTitle !== taskTitle ? progressTitle : null)
    ?? compactDisplayText(meta?.thread_title, 120)
    ?? progressTitle
    ?? taskTitle
    ?? compactDisplayText(input.fallback, 120)
}

export function importedCodexThreadUpdatedAtFromMemo(memo: unknown) {
  const metadata = markdownSectionBody(memo, "取り込み情報")
  const match = metadata?.match(IMPORTED_THREAD_UPDATED_AT_RE)
  return firstValidTime(match?.[1])
}

export function codexThreadImportActivityAt(input: {
  task?: {
    memo?: unknown
    updated_at?: string | null
    created_at?: string | null
  } | null
  aiTask?: {
    result?: unknown
    completed_at?: string | null
    started_at?: string | null
    created_at?: string | null
  } | null
  progressTask?: {
    updated_at?: string | null
  } | null
  codexRun?: {
    lastActivityAt?: string | null
    updatedAt?: string | null
  } | null
}) {
  const result = recordValue(input.aiTask?.result)

  // Keep list ordering tied to Codex work, not Focusmap import/sync writes.
  // task/progress updated_at can change when old threads are imported or cards are
  // background-refreshed, which otherwise makes the top row jump every poll.
  return firstValidTime(
    result?.codex_turn_completed_at,
    result?.awaiting_approval_at,
    result?.codex_turn_started_at,
    importedCodexThreadUpdatedAtFromMemo(input.task?.memo),
  )
}

export type CodexThreadRallyWorkTiming = {
  workStartedAt: string | null
  workAwaitingApprovalAt: string | null
  workCompletedAt: string | null
  workLastActivityAt: string | null
}

export function codexThreadRallyWorkTiming(input: {
  aiTask?: {
    result?: unknown
  } | null
  aiResult?: Record<string, unknown> | null
}): CodexThreadRallyWorkTiming {
  const result = input.aiResult ?? recordValue(input.aiTask?.result)
  const startedAt = firstValidTime(result?.codex_turn_started_at)
  const finishedAt = firstValidTime(
    result?.codex_turn_completed_at,
    result?.awaiting_approval_at,
  )

  return {
    workStartedAt: startedAt,
    workAwaitingApprovalAt: finishedAt,
    workCompletedAt: finishedAt,
    // Deliberately never use last_activity_at here. It can move because of
    // background sync/title/summary updates and would turn one-rally time into
    // whole-thread time.
    workLastActivityAt: null,
  }
}

export function getCodexThreadRallyWorkElapsedMs(
  timing: {
    workStartedAt?: string | null
    workAwaitingApprovalAt?: string | null
    workCompletedAt?: string | null
  } | null | undefined,
  options: { nowMs?: number; active?: boolean } = {},
) {
  if (!timing?.workStartedAt) return null
  const startedAt = firstValidTime(timing.workStartedAt)
  if (!startedAt) return null
  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs)) return null

  const finishedMs = options.active
    ? options.nowMs ?? Date.now()
    : (() => {
        const finishedAt = firstValidTime(timing.workCompletedAt, timing.workAwaitingApprovalAt)
        if (!finishedAt) return null
        const ms = Date.parse(finishedAt)
        return Number.isFinite(ms) ? ms : null
      })()
  if (finishedMs === null) return null
  return Math.max(0, finishedMs - startedMs)
}
