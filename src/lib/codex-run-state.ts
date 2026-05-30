export type CodexRunState = "running" | "awaiting_approval"

export type CodexReviewReason =
  | "started"
  | "manual_handoff"
  | "completed"
  | "aborted"
  | "archived"
  | "thread_deleted"
  | "approval_requested"
  | "monitoring_lost"
  | "unknown"

export type CodexThreadSnapshot = {
  title?: string | null
  preview?: string | null
  tokens_used?: number | null
  has_user_event?: number | boolean | null
  archived?: number | boolean | null
  updated_at_ms?: number | null
  rollout_path?: string | null
  source?: string | null
  cwd?: string | null
}

export type CodexRolloutSummary = {
  state: CodexRunState
  reviewReason: CodexReviewReason
  liveLog: string
  lastActivityAt: string | null
  sawTaskStarted: boolean
  sawTerminalEvent: boolean
}

export type CodexTaskLike = {
  status?: string | null
  executor?: string | null
  result?: Record<string, unknown> | null
}

export type CodexTaskUiState = {
  state: CodexRunState
  label: string
}

const MAX_LIVE_LOG_CHARS = 80_000

export function shouldCompleteSourceTaskForCodexReview(
  reason: CodexReviewReason,
): reason is Extract<CodexReviewReason, "archived" | "thread_deleted"> {
  return reason === "archived" || reason === "thread_deleted"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function safeText(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join("")
  if (!isRecord(value)) return ""

  if (typeof value.text === "string") return value.text
  if (typeof value.message === "string") return value.message
  if (typeof value.summary === "string") return value.summary
  if (typeof value.content === "string") return value.content
  if (Array.isArray(value.content)) return value.content.map(safeText).filter(Boolean).join("")
  if (Array.isArray(value.parts)) return value.parts.map(safeText).filter(Boolean).join("")
  if (isRecord(value.message)) return safeText(value.message)
  return ""
}

function timestampToIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  return null
}

function compactLine(value: string, max = 12_000) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max)
}

function isInternalUserMessage(value: string): boolean {
  const text = value.trim()
  return text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.includes("\n<environment_context>")
}

function summarizeToolCall(payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name : "tool"
  const rawArgs = typeof payload.arguments === "string" ? payload.arguments : ""
  if (!rawArgs) return name

  try {
    const args = JSON.parse(rawArgs) as Record<string, unknown>
    const command = typeof args.cmd === "string"
      ? args.cmd
      : typeof args.command === "string"
        ? args.command
        : ""
    if (command) return command

    const query = typeof args.q === "string"
      ? args.q
      : typeof args.query === "string"
        ? args.query
        : ""
    if (query) return `${name}: ${query}`
  } catch {
    return `${name}: ${rawArgs.slice(0, 240)}`
  }

  return name
}

function appendLog(logs: string[], line: string) {
  const text = compactLine(line)
  if (!text) return
  const key = text.replace(/\s+/g, " ")
  if (logs.some(log => log.replace(/\s+/g, " ") === key)) return
  logs.push(text)
  while (logs.join("\n").length > MAX_LIVE_LOG_CHARS && logs.length > 1) {
    logs.shift()
  }
}

export function parseCodexRollout(
  rawJsonl: string,
  options: { archived?: boolean; snapshot?: CodexThreadSnapshot } = {},
): CodexRolloutSummary {
  const logs: string[] = []
  let state: CodexRunState = options.archived ? "awaiting_approval" : "running"
  let reviewReason: CodexReviewReason = options.archived ? "archived" : "unknown"
  let lastActivityAt: string | null = timestampToIso(options.snapshot?.updated_at_ms ?? null)
  let sawTaskStarted = false
  let sawTerminalEvent = false

  for (const line of rawJsonl.split("\n")) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row)) continue

    const rowTime = timestampToIso(row.timestamp)
    if (rowTime) lastActivityAt = rowTime

    const payload = isRecord(row.payload) ? row.payload : {}
    const payloadType = typeof payload.type === "string" ? payload.type : ""
    const payloadTime = timestampToIso(payload.timestamp ?? payload.started_at ?? payload.completed_at)
    if (payloadTime) lastActivityAt = payloadTime

    if (payloadType === "task_started") {
      sawTaskStarted = true
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      appendLog(logs, "[Codex] 実行開始")
      continue
    }

    if (payloadType === "task_complete") {
      sawTerminalEvent = true
      state = "awaiting_approval"
      reviewReason = "completed"
      appendLog(logs, "[Codex] 実行完了。確認待ちです")
      continue
    }

    if (payloadType === "turn_aborted") {
      sawTerminalEvent = true
      state = "awaiting_approval"
      reviewReason = "aborted"
      appendLog(logs, "[Codex] ターンが停止しました。確認待ちです")
      continue
    }

    if (payloadType === "agent_message") {
      const text = safeText(payload)
      if (text) appendLog(logs, `[assistant] ${text}`)
      continue
    }

    if (payloadType === "user_message") {
      const text = safeText(payload)
      if (text && !isInternalUserMessage(text)) appendLog(logs, `[user] ${text}`)
      continue
    }

    if (payloadType === "message") {
      const role = typeof payload.role === "string" ? payload.role : "message"
      if (role === "developer" || role === "system" || role === "user") continue
      const text = safeText(payload)
      if (text) appendLog(logs, `[${role}] ${text}`)
      continue
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      appendLog(logs, `[command:started] ${summarizeToolCall(payload)}`)
      continue
    }

    if (payloadType === "web_search_call" || payloadType === "tool_search_call") {
      const query = safeText(payload.action) || safeText(payload)
      appendLog(logs, `[command:started] ${payloadType.replace(/_call$/, "")}${query ? `: ${query}` : ""}`)
      continue
    }

    if (
      payloadType === "function_call_output" ||
      payloadType === "custom_tool_call_output" ||
      payloadType === "web_search_end" ||
      payloadType === "tool_search_output"
    ) {
      continue
    }
  }

  if (options.archived) {
    state = "awaiting_approval"
    reviewReason = reviewReason === "unknown" || reviewReason === "started" ? "archived" : reviewReason
  }

  if (logs.length === 0 && options.snapshot?.preview) {
    appendLog(logs, options.snapshot.preview)
  }

  return {
    state,
    reviewReason,
    liveLog: logs.join("\n\n").slice(-MAX_LIVE_LOG_CHARS),
    lastActivityAt,
    sawTaskStarted,
    sawTerminalEvent,
  }
}

export function getCodexTaskUiState(task: CodexTaskLike | null | undefined): CodexTaskUiState | null {
  if (!task || (task.executor !== "codex" && task.executor !== "codex_app")) return null
  if (task.status === "completed") return null

  const result = isRecord(task.result) ? task.result : {}
  const rawState = result.codex_run_state
  const isManualHandoff = result.codex_manual_handoff === true
  const hasThreadId = typeof result.codex_thread_id === "string" && result.codex_thread_id.trim().length > 0

  if (isManualHandoff && !hasThreadId) {
    return { state: "awaiting_approval", label: "実行待ち" }
  }

  if (rawState === "awaiting_approval") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  if (task.status === "awaiting_approval" || task.status === "needs_input" || task.status === "failed") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  if (rawState === "running") {
    return { state: "running", label: "実行中" }
  }
  if (task.status === "pending" || task.status === "running") {
    return { state: "running", label: "実行中" }
  }

  return null
}
