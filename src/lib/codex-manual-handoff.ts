export type ManualCodexHandoffEvent =
  | "external_app_opened"
  | "external_app_returned"
  | "screen_switched"

export type ManualCodexHandoffTaskLike = {
  status?: string | null
  executor?: string | null
  result?: Record<string, unknown> | null
}

export const MANUAL_CODEX_HANDOFF_CONFIRMED_STEP = "ChatGPT/Codexアプリで確認待ち"
export const MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE =
  "ChatGPT/Codexアプリへプロンプトを渡しました。返答はChatGPT側で確認し、必要ならFocusmapへ戻って続けてください。"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function appendUniqueRecordByKey(
  values: unknown,
  nextValue: Record<string, unknown>,
  key: string,
  maxItems = 20,
) {
  const nextKey = stringValue(nextValue[key])
  const existing = Array.isArray(values)
    ? values.filter(isRecord).filter(value => stringValue(value[key]) !== nextKey)
    : []
  return [...existing, nextValue].slice(-maxItems)
}

export function isManualCodexHandoffWaiting(task: ManualCodexHandoffTaskLike | null | undefined) {
  if (!task || task.executor !== "codex_app") return false
  if (task.status === "completed" || task.status === "failed") return false

  const result = isRecord(task.result) ? task.result : {}
  if (result.codex_manual_handoff !== true) return false

  const runState = stringValue(result.codex_run_state)
  if (runState === "awaiting_approval" || runState === "running" || runState === "connection_failed") {
    return false
  }
  const statusCanStillBeWaiting =
    task.status === "needs_input" ||
    task.status === "pending" ||
    task.status === "awaiting_approval"
  return runState === "prompt_waiting" ||
    (!runState && statusCanStillBeWaiting)
}

export function isManualCodexHandoffConfirmed(task: ManualCodexHandoffTaskLike | null | undefined) {
  if (!task || task.executor !== "codex_app") return false
  const result = isRecord(task.result) ? task.result : {}
  return result.codex_manual_handoff === true && stringValue(result.codex_run_state) === "awaiting_approval"
}

export function buildManualCodexHandoffConfirmedResult(
  currentResult: Record<string, unknown> | null | undefined,
  options: {
    nowIso: string
    event?: ManualCodexHandoffEvent | string | null
  },
) {
  const current = isRecord(currentResult) ? currentResult : {}
  const event = options.event || "screen_switched"
  const confirmedAt = stringValue(current.codex_external_handoff_confirmed_at) || options.nowIso
  const awaitingApprovalAt = stringValue(current.awaiting_approval_at) || options.nowIso
  const previousSummary = isRecord(current.progress_summary) ? current.progress_summary : {}
  const nextStep = {
    key: "external_app_handoff_confirmed",
    label: "ChatGPT/Codexアプリへ送信済み",
    status: "active",
    at: options.nowIso,
  }
  const visibleMessage = {
    key: "external_app_handoff_confirmed",
    role: "codex",
    kind: "approval",
    body: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
    created_at: options.nowIso,
  }

  return {
    ...current,
    executor: "codex_app",
    codex_manual_handoff: true,
    codex_run_state: "awaiting_approval",
    codex_review_reason: "external_app_handoff",
    codex_external_handoff_event: event,
    codex_external_handoff_confirmed_at: confirmedAt,
    awaiting_approval_at: awaitingApprovalAt,
    current_step: MANUAL_CODEX_HANDOFF_CONFIRMED_STEP,
    message: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
    live_log: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
    last_activity_at: options.nowIso,
    session_health: "transcript_only",
    progress_summary: {
      ...previousSummary,
      state: "needs_review",
      progress_percent: 100,
      summary: MANUAL_CODEX_HANDOFF_CONFIRMED_MESSAGE,
      current_step: MANUAL_CODEX_HANDOFF_CONFIRMED_STEP,
      evidence: "Focusmap detected an external app screen switch for a manual Codex handoff.",
      recommended_action: "ChatGPT/Codexアプリ側の返答を確認してください。",
      can_mark_completed: false,
      confidence: typeof previousSummary.confidence === "number" ? previousSummary.confidence : 0.6,
      checked_at: options.nowIso,
      source: stringValue(previousSummary.source) || "rule",
      last_activity_at: options.nowIso,
      session_health: "transcript_only",
    },
    steps: appendUniqueRecordByKey(current.steps, nextStep, "key"),
    codex_visible_messages: appendUniqueRecordByKey(current.codex_visible_messages, visibleMessage, "key", 40),
  }
}
