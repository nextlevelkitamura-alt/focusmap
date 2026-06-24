export type CodexRunState = "prompt_waiting" | "running" | "awaiting_approval" | "connection_failed"
export type CodexTaskUiStateName = CodexRunState | "completed"

export type CodexReviewReason =
  | "started"
  | "manual_handoff"
  | "completed"
  | "aborted"
  | "archived"
  | "thread_deleted"
  | "thread_unavailable"
  | "approval_requested"
  | "monitoring_lost"
  | "external_app_handoff"
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

export type CodexRolloutVisibleMessage = {
  role: "assistant" | "user"
  body: string
  kind: "progress" | "question" | "completed" | "user_answer"
  createdAt: string | null
  turnStartedAt?: string | null
  turnCompletedAt?: string | null
}

export type CodexRolloutSummary = {
  state: CodexRunState
  reviewReason: CodexReviewReason
  liveLog: string
  visibleMessages: CodexRolloutVisibleMessage[]
  currentStep: string
  lastActivityAt: string | null
  latestUserMessageAt: string | null
  latestTaskStartedAt: string | null
  latestTaskCompleteAt: string | null
  latestRunningActivityAt: string | null
  latestAgentMessage: string | null
  latestQuestion: string | null
  sawTaskStarted: boolean
  sawTerminalEvent: boolean
}

export type CodexTaskLike = {
  status?: string | null
  executor?: string | null
  codex_thread_id?: string | null
  source_task_id?: string | null
  result?: Record<string, unknown> | null
}

export type CodexTaskUiState = {
  state: CodexTaskUiStateName
  label: string
}

const CODEX_VISIBLE_ACTIVITY_RUNNING_WINDOW_MS = 45_000

const MAX_LIVE_LOG_CHARS = 80_000

export function shouldCompleteSourceTaskForCodexReview(
  reason: CodexReviewReason,
): boolean {
  void reason
  return false
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

function compactStep(value: string, max = 240) {
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function looksLikeQuestion(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/[?？]/.test(text)) return true
  return /(確認してください|教えてください|選んでください|必要ですか|よいですか|しますか|どちら|どれ)/.test(text.slice(-160))
}

function isContextMaintenanceEvent(payloadType: string, payload: Record<string, unknown>): boolean {
  const type = payloadType.toLowerCase()
  if (/(context|window).*(compact|compaction|compress|compression|summariz|summary)/.test(type)) return true
  if (/(compact|compaction|compress|compression).*(context|window)/.test(type)) return true
  const text = safeText(payload).toLowerCase()
  return /context (compaction|compression)|compacting context|compressing context|コンテキスト圧縮|圧縮中/.test(text)
}

function isInternalUserMessage(value: string): boolean {
  const text = value.trim()
  return text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.includes("\n<environment_context>")
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

function appendVisibleMessage(
  messages: CodexRolloutVisibleMessage[],
  input: Omit<CodexRolloutVisibleMessage, "body"> & { body: string },
) {
  const body = compactLine(input.body, 2_000)
  if (!body) return
  const inputTurnKey = input.role === "assistant" ? input.turnStartedAt ?? "" : input.createdAt ?? ""
  const key = `${input.role}:${inputTurnKey}:${body.replace(/\s+/g, " ")}`
  const existing = messages.find(message => {
    const messageTurnKey = message.role === "assistant" ? message.turnStartedAt ?? "" : message.createdAt ?? ""
    return `${message.role}:${messageTurnKey}:${message.body.replace(/\s+/g, " ")}` === key
  })
  if (existing) {
    existing.turnStartedAt = existing.turnStartedAt ?? input.turnStartedAt
    existing.turnCompletedAt = existing.turnCompletedAt ?? input.turnCompletedAt
    if (existing.role === "assistant" && input.kind === "completed") existing.kind = input.kind
    existing.createdAt = input.createdAt ?? existing.createdAt
    return
  }
  messages.push({ ...input, body })
  while (messages.length > 40) messages.shift()
}

function completeLatestAssistantVisibleMessage(
  messages: CodexRolloutVisibleMessage[],
  turnStartedAt: string | null,
  turnCompletedAt: string | null,
) {
  if (!turnCompletedAt) return
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== "assistant") continue
    if (turnStartedAt && message.turnStartedAt && message.turnStartedAt !== turnStartedAt) continue
    message.turnStartedAt = message.turnStartedAt ?? turnStartedAt
    message.turnCompletedAt = message.turnCompletedAt ?? turnCompletedAt
    message.createdAt = turnCompletedAt ?? message.createdAt
    if (message.kind !== "question") message.kind = "completed"
    return
  }
}

export function codexVisibleMessageWorkMetadata(message: CodexRolloutVisibleMessage): Record<string, unknown> {
  if (message.role !== "assistant") return {}
  const startedAt = message.turnStartedAt ?? null
  const completedAt = message.turnCompletedAt ?? null
  const startedMs = parseTimeMsForResume(startedAt)
  const completedMs = parseTimeMsForResume(completedAt)
  const elapsedMs = startedMs !== null && completedMs !== null
    ? Math.max(0, completedMs - startedMs)
    : null
  return {
    ...(startedAt ? { turn_started_at: startedAt } : {}),
    ...(completedAt ? { turn_completed_at: completedAt } : {}),
    ...(elapsedMs !== null ? { work_elapsed_ms: elapsedMs } : {}),
  }
}

function shouldTreatCodexActivityAsRunning(input: {
  eventTime: string | null
  latestTaskCompleteAt: string | null
  latestUserMessageAt: string | null
  latestTaskStartedAt: string | null
}) {
  const completeMs = parseTimeMsForResume(input.latestTaskCompleteAt)
  if (completeMs === null) return true
  const eventMs = parseTimeMsForResume(input.eventTime)
  if (eventMs !== null && eventMs <= completeMs) return true
  const restartMs = Math.max(
    parseTimeMsForResume(input.latestUserMessageAt) ?? 0,
    parseTimeMsForResume(input.latestTaskStartedAt) ?? 0,
  )
  return restartMs > completeMs
}

export function parseCodexRollout(
  rawJsonl: string,
  options: { archived?: boolean; snapshot?: CodexThreadSnapshot } = {},
): CodexRolloutSummary {
  const logs: string[] = []
  const visibleMessages: CodexRolloutVisibleMessage[] = []
  let state: CodexRunState = options.archived ? "awaiting_approval" : "running"
  let reviewReason: CodexReviewReason = options.archived ? "archived" : "unknown"
  let lastActivityAt: string | null = timestampToIso(options.snapshot?.updated_at_ms ?? null)
  let latestUserMessageAt: string | null = null
  let latestTaskStartedAt: string | null = null
  let latestTaskCompleteAt: string | null = null
  let latestRunningActivityAt: string | null = null
  let latestAgentMessage: string | null = null
  let latestQuestion: string | null = null
  let currentStep = options.archived ? "Codex thread は確認待ちです" : "Codex.appで実行中"
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

    const previousLastActivityAt = lastActivityAt
    const rowTime = timestampToIso(row.timestamp)
    if (rowTime) lastActivityAt = rowTime

    const payload = isRecord(row.payload) ? row.payload : {}
    const payloadType = typeof payload.type === "string" ? payload.type : ""
    const payloadTime = timestampToIso(payload.timestamp ?? payload.started_at ?? payload.completed_at)
    if (payloadTime) lastActivityAt = payloadTime
    const eventTime = payloadTime ?? rowTime ?? lastActivityAt

    if (payloadType === "task_started") {
      sawTaskStarted = true
      latestTaskStartedAt = eventTime
      latestRunningActivityAt = eventTime
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      currentStep = "Codexが実行を開始しました"
      appendLog(logs, "[Codex] 実行開始")
      continue
    }

    if (payloadType === "task_complete") {
      const text = safeText(payload.last_agent_message)
      if (text) {
        latestAgentMessage = compactLine(text, 2_000)
        if (looksLikeQuestion(text)) latestQuestion = latestAgentMessage
        appendLog(logs, `[assistant] ${text}`)
        appendVisibleMessage(visibleMessages, {
          role: "assistant",
          body: text,
          kind: looksLikeQuestion(text) ? "question" : "completed",
          createdAt: eventTime,
          turnStartedAt: latestTaskStartedAt,
          turnCompletedAt: eventTime,
        })
      } else {
        completeLatestAssistantVisibleMessage(visibleMessages, latestTaskStartedAt, eventTime)
      }
      sawTerminalEvent = true
      latestTaskCompleteAt = eventTime
      state = "awaiting_approval"
      reviewReason = "completed"
      currentStep = "Codexが実行完了し確認待ちです"
      appendLog(logs, "[Codex] 実行完了。確認待ちです")
      continue
    }

    if (payloadType === "turn_aborted") {
      sawTerminalEvent = true
      latestTaskCompleteAt = eventTime
      state = "awaiting_approval"
      reviewReason = "aborted"
      currentStep = "Codexのターンが停止し確認待ちです"
      appendLog(logs, "[Codex] ターンが停止しました。確認待ちです")
      completeLatestAssistantVisibleMessage(visibleMessages, latestTaskStartedAt, eventTime)
      continue
    }

    if (payloadType === "agent_message") {
      const text = safeText(payload)
      if (text) {
        if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
          lastActivityAt = previousLastActivityAt
          continue
        }
        latestRunningActivityAt = eventTime
        sawTerminalEvent = false
        state = "running"
        reviewReason = "started"
        latestAgentMessage = compactLine(text, 2_000)
        currentStep = compactStep(text)
        if (looksLikeQuestion(text)) latestQuestion = latestAgentMessage
        appendLog(logs, `[assistant] ${text}`)
        appendVisibleMessage(visibleMessages, {
          role: "assistant",
          body: text,
          kind: looksLikeQuestion(text) ? "question" : "progress",
          createdAt: eventTime,
          turnStartedAt: latestTaskStartedAt,
        })
      }
      continue
    }

    if (payloadType === "user_message") {
      const text = safeText(payload)
      if (text && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime
        appendLog(logs, `[user] ${text}`)
        appendVisibleMessage(visibleMessages, {
          role: "user",
          body: text,
          kind: "user_answer",
          createdAt: eventTime,
        })
      }
      continue
    }

    if (isContextMaintenanceEvent(payloadType, payload)) {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt
        continue
      }
      latestRunningActivityAt = eventTime
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      currentStep = "Codexがコンテキストを整理中"
      continue
    }

    if (payloadType === "message") {
      const role = typeof payload.role === "string" ? payload.role : "message"
      const text = safeText(payload)
      if (role === "developer" || role === "system") {
        if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
          lastActivityAt = previousLastActivityAt
        }
        continue
      }
      if (role === "user") {
        if (text && !isInternalUserMessage(text)) {
          latestUserMessageAt = eventTime
          appendLog(logs, `[user] ${text}`)
          appendVisibleMessage(visibleMessages, {
            role: "user",
            body: text,
            kind: "user_answer",
            createdAt: eventTime,
          })
        } else if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
          lastActivityAt = previousLastActivityAt
        }
        continue
      }
      if (text) {
        if (role === "assistant") {
          if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
            lastActivityAt = previousLastActivityAt
            continue
          }
          latestRunningActivityAt = eventTime
          sawTerminalEvent = false
          state = "running"
          reviewReason = "started"
          latestAgentMessage = compactLine(text, 2_000)
          currentStep = compactStep(text)
          if (looksLikeQuestion(text)) latestQuestion = latestAgentMessage
          appendVisibleMessage(visibleMessages, {
            role: "assistant",
            body: text,
            kind: looksLikeQuestion(text) ? "question" : "progress",
            createdAt: eventTime,
            turnStartedAt: latestTaskStartedAt,
          })
        }
        appendLog(logs, `[${role}] ${text}`)
      }
      continue
    }

    if (
      payloadType === "function_call" ||
      payloadType === "custom_tool_call" ||
      payloadType === "web_search_call" ||
      payloadType === "tool_search_call"
    ) {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt
        continue
      }
      latestRunningActivityAt = eventTime
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      currentStep = "Codexがツールを実行中"
      continue
    }

    if (
      payloadType === "function_call_output" ||
      payloadType === "custom_tool_call_output" ||
      payloadType === "web_search_end" ||
      payloadType === "tool_search_output"
    ) {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt
        continue
      }
      latestRunningActivityAt = eventTime
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      currentStep = "Codexが実行結果を確認中"
      continue
    }

    if (payloadType === "reasoning") {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt
        continue
      }
      latestRunningActivityAt = eventTime
      sawTerminalEvent = false
      state = "running"
      reviewReason = "started"
      currentStep = "Codexが内容を検討中"
      continue
    }

    if (payloadType && !shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
      lastActivityAt = previousLastActivityAt
    }
  }

  if (options.archived) {
    state = "awaiting_approval"
    reviewReason = reviewReason === "unknown" || reviewReason === "started" ? "archived" : reviewReason
  }

  if (logs.length === 0 && options.snapshot?.preview) {
    appendLog(logs, options.snapshot.preview)
    if (currentStep === "Codex.appで実行中") {
      currentStep = compactStep(options.snapshot.preview)
    }
  }

  return {
    state,
    reviewReason,
    liveLog: logs.join("\n\n").slice(-MAX_LIVE_LOG_CHARS),
    visibleMessages,
    currentStep,
    lastActivityAt,
    latestUserMessageAt,
    latestTaskStartedAt,
    latestTaskCompleteAt,
    latestRunningActivityAt,
    latestAgentMessage,
    latestQuestion,
    sawTaskStarted,
    sawTerminalEvent,
  }
}

export function detectCodexResumeAfterApproval(
  summary: Pick<CodexRolloutSummary, "latestUserMessageAt" | "latestTaskStartedAt"> & { latestRunningActivityAt?: string | null },
  awaitingApprovalAt: unknown,
): boolean {
  const approvalMs = parseTimeMsForResume(awaitingApprovalAt)
  if (approvalMs == null) return false

  const userMessageMs = parseTimeMsForResume(summary.latestUserMessageAt)
  if (userMessageMs != null && userMessageMs > approvalMs) return true

  const taskStartedMs = parseTimeMsForResume(summary.latestTaskStartedAt)
  if (taskStartedMs != null && taskStartedMs > approvalMs) return true

  const runningActivityMs = parseTimeMsForResume(summary.latestRunningActivityAt)
  if (runningActivityMs != null && runningActivityMs > approvalMs) return true

  return false
}

function parseTimeMsForResume(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value.trim() : ""
}

function hasCodexActivityEvidence(result: Record<string, unknown>) {
  const progressSummary = isRecord(result.progress_summary) ? result.progress_summary : {}
  const snapshot = isRecord(result.codex_thread_snapshot) ? result.codex_thread_snapshot : {}
  const values = [
    stringFromRecord(result, "current_step"),
    stringFromRecord(result, "message"),
    stringFromRecord(result, "live_log"),
    stringFromRecord(progressSummary, "current_step"),
    stringFromRecord(progressSummary, "summary"),
    stringFromRecord(snapshot, "preview"),
  ]

  return values.some((value) => {
    if (!value) return false
    return !/プロンプト待ち|送信待ち|Codex\.appで送信|Focusmapはthread状態|Focusmapは状態と出力だけを同期|プロンプトはコピー済み/u.test(value)
  })
}

function latestVisibleActivityMs(result: Record<string, unknown>): number | null {
  const progressSummary = isRecord(result.progress_summary) ? result.progress_summary : {}
  const snapshot = isRecord(result.codex_thread_snapshot) ? result.codex_thread_snapshot : {}
  const values = [
    result.last_activity_at,
    progressSummary.last_activity_at,
    snapshot.updated_at_ms,
  ]

  let latest: number | null = null
  for (const value of values) {
    const ms = parseTimeMsForResume(value)
    if (ms == null) continue
    latest = latest == null ? ms : Math.max(latest, ms)
  }
  return latest
}

function stateForVisibleCodexActivity(result: Record<string, unknown>): CodexTaskUiState {
  const latestMs = latestVisibleActivityMs(result)
  if (latestMs != null && Date.now() - latestMs <= CODEX_VISIBLE_ACTIVITY_RUNNING_WINDOW_MS) {
    return { state: "running", label: "実行中" }
  }
  return { state: "awaiting_approval", label: "確認待ち" }
}

export function getCodexTaskUiState(task: CodexTaskLike | null | undefined): CodexTaskUiState | null {
  if (!task || (task.executor !== "codex" && task.executor !== "codex_app")) return null

  const result = isRecord(task.result) ? task.result : {}
  const rawState = result.codex_run_state
  const isManualHandoff = result.codex_manual_handoff === true
  const hasThreadId =
    (typeof task.codex_thread_id === "string" && task.codex_thread_id.trim().length > 0) ||
    (typeof result.codex_thread_id === "string" && result.codex_thread_id.trim().length > 0)

  if (task.status === "failed") {
    return { state: "connection_failed", label: "接続失敗" }
  }
  if (rawState === "stale_no_terminal_event") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  const reviewReason = typeof result.codex_review_reason === "string" ? result.codex_review_reason : ""
  const sourceCompletionReason = typeof result.codex_source_task_completion_reason === "string"
    ? result.codex_source_task_completion_reason
    : ""
  if (
    result.codex_source_task_completed === true &&
    result.codex_source_task_completion_suppressed !== true &&
    reviewReason !== "thread_deleted" &&
    reviewReason !== "thread_unavailable" &&
    sourceCompletionReason !== "thread_deleted" &&
    sourceCompletionReason !== "thread_unavailable"
  ) {
    return { state: "completed", label: "完了済み" }
  }
  if (result.codex_source_task_completion_suppressed === true) {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  if (task.status === "completed") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  if (task.status === "pending") {
    if (hasCodexActivityEvidence(result) && (hasThreadId || rawState === "running")) {
      return stateForVisibleCodexActivity(result)
    }
    return { state: "prompt_waiting", label: "未送信" }
  }
  if (rawState === "prompt_waiting") {
    return { state: "prompt_waiting", label: "未送信" }
  }

  if (isManualHandoff && !hasThreadId) {
    return { state: "prompt_waiting", label: "未送信" }
  }

  if (task.status === "running") {
    return { state: "running", label: "実行中" }
  }
  if (rawState === "awaiting_approval") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }

  if (task.status === "awaiting_approval" || task.status === "needs_input") {
    return { state: "awaiting_approval", label: "確認待ち" }
  }
  if (rawState === "running") {
    return { state: "running", label: "実行中" }
  }

  return null
}
