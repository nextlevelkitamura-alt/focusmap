"use client"

export type FocusmapChatMode = "normal" | "automation"
export type FocusmapChatRole = "user" | "assistant" | "system"
export type FocusmapChatStatus = "idle" | "running" | "completed" | "failed"
export type FocusmapActionStatus = "pending" | "executing" | "success" | "failed"
export type FocusmapPlannerState = "capture_intent" | "propose" | "resolve_conflict" | "confirm_and_execute"

export interface FocusmapChatOption {
  label: string
  value: string
  silent?: boolean
  action?: "restore_input" | "reset"
}

export interface FocusmapChatAction {
  type: string
  params: Record<string, unknown>
  description?: string
}

export interface FocusmapCalendarChoice {
  id: string
  name: string
  isDefault?: boolean
}

export interface FocusmapBestProposal {
  title: string
  startAt: string
  endAt: string
  calendarId?: string
  duration?: number
  reason?: string
}

export interface FocusmapProposalCard {
  id: string
  title: string
  startAt: string
  endAt: string
  calendarId?: string
  reason?: string
  value?: string
}

export interface FocusmapToolResult {
  toolName: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}

export interface FocusmapChatMessage {
  id: string
  role: FocusmapChatRole
  content: string
  createdAt: string
  status?: FocusmapChatStatus
  modelLabel?: string
  taskId?: string | null
  error?: string | null
  hidden?: boolean
  isSummaryDivider?: boolean
  options?: FocusmapChatOption[]
  optionsUsed?: boolean
  selectedOption?: string
  action?: FocusmapChatAction
  pendingAction?: FocusmapChatAction
  actionStatus?: FocusmapActionStatus
  calendarChoices?: FocusmapCalendarChoice[]
  calendarChoiceUsed?: boolean
  plannerState?: FocusmapPlannerState
  bestProposal?: FocusmapBestProposal
  bestProposalStatus?: "pending" | "accepted" | "editing"
  proposalCards?: FocusmapProposalCard[]
  proposalUsed?: boolean
  toolResults?: FocusmapToolResult[]
}

export interface FocusmapChatSession {
  id: string
  mode: FocusmapChatMode
  title: string
  messages: FocusmapChatMessage[]
  summaryContext?: string | null
  createdAt: string
  updatedAt: string
}

interface RuntimeState {
  sessions: FocusmapChatSession[]
  activeSessionId: string | null
}

interface SendOptions {
  mode: FocusmapChatMode
  sessionId?: string | null
  text: string
  spaceId?: string | null
  projectId?: string | null
  silent?: boolean
}

interface ChatApiResponse {
  reply?: string
  action?: FocusmapChatAction
  pendingAction?: FocusmapChatAction
  calendarChoices?: FocusmapCalendarChoice[]
  options?: FocusmapChatOption[]
  plannerState?: FocusmapPlannerState
  bestProposal?: FocusmapBestProposal
  proposalCards?: FocusmapProposalCard[]
  shouldSummarize?: boolean
  skillId?: string
  skillSelector?: Array<{ id: string; label: string; icon?: string; description?: string }>
  contextUpdate?: { category?: string; content?: string }
  projectContextUpdated?: boolean
  toolResults?: FocusmapToolResult[]
  model_label?: string
  error?: string
}

interface ExecuteActionResponse {
  success?: boolean
  message?: string
  eventData?: {
    id: string
    title: string
    scheduled_at: string
    estimated_time: number
    calendar_id?: string | null
  }
  taskData?: {
    id: string
    title: string
    project_id?: string | null
    parent_task_id?: string | null
  }
  continueOptions?: FocusmapChatOption[]
  actionType?: string
  error?: string
}

const STORAGE_PREFIX = "focusmap:chat-runtime:"
const listeners = new Set<() => void>()
const memoryState: Record<FocusmapChatMode, RuntimeState> = {
  normal: { sessions: [], activeSessionId: null },
  automation: { sessions: [], activeSessionId: null },
}
const loadedModes = new Set<FocusmapChatMode>()
const inFlight = new Map<string, Promise<void>>()

let channel: BroadcastChannel | null = null

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function storageKey(mode: FocusmapChatMode) {
  return `${STORAGE_PREFIX}${mode}`
}

function initialTitle(mode: FocusmapChatMode) {
  return mode === "automation" ? "新しい自動化" : "新しいチャット"
}

function titleFromText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return "新しいチャット"
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map(session => ({
      ...session,
      messages: session.messages.map(message => ({ ...message })),
    })),
  }
}

function visibleConversationMessages(session: FocusmapChatSession) {
  return session.messages
    .filter(message => !message.isSummaryDivider && (message.role === "user" || message.role === "assistant"))
    .map(message => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }))
}

function normalizeOptions(data: ChatApiResponse): FocusmapChatOption[] | undefined {
  if (Array.isArray(data.options) && data.options.length > 0) return data.options.slice(0, 4)
  if (Array.isArray(data.skillSelector) && data.skillSelector.length > 0) {
    return data.skillSelector.slice(0, 6).map(skill => ({
      label: skill.label,
      value: `${skill.label}をしたい`,
    }))
  }
  return undefined
}

function applyNormalResponse(target: FocusmapChatMessage, data: ChatApiResponse) {
  target.content = data.reply || "応答を取得しました。"
  target.status = "completed"
  target.modelLabel = data.model_label || "gemini-3.1-flash-lite"
  target.action = data.action
  target.pendingAction = data.pendingAction
  target.calendarChoices = data.calendarChoices?.length ? data.calendarChoices : undefined
  target.actionStatus = data.action || data.pendingAction ? "pending" : undefined
  target.options = normalizeOptions(data)
  target.optionsUsed = false
  target.selectedOption = undefined
  target.plannerState = data.plannerState
  target.bestProposal = data.bestProposal
  target.bestProposalStatus = data.bestProposal ? "pending" : undefined
  target.proposalCards = data.proposalCards?.length ? data.proposalCards : undefined
  target.proposalUsed = false
  target.toolResults = data.toolResults?.length ? data.toolResults : undefined
}

function ensureBrowserSync() {
  if (typeof window === "undefined" || channel) return
  channel = "BroadcastChannel" in window ? new BroadcastChannel("focusmap-chat-runtime") : null
  channel?.addEventListener("message", event => {
    const mode = event.data?.mode as FocusmapChatMode | undefined
    if (mode !== "normal" && mode !== "automation") return
    loadedModes.delete(mode)
    loadMode(mode)
    notify(false)
  })
  window.addEventListener("storage", event => {
    if (!event.key?.startsWith(STORAGE_PREFIX)) return
    const mode = event.key.endsWith("automation") ? "automation" : "normal"
    loadedModes.delete(mode)
    loadMode(mode)
    notify(false)
  })
}

function loadMode(mode: FocusmapChatMode) {
  if (loadedModes.has(mode)) return
  loadedModes.add(mode)
  if (typeof window === "undefined") return
  try {
    const raw = localStorage.getItem(storageKey(mode))
    if (!raw) return
    const parsed = JSON.parse(raw) as RuntimeState
    memoryState[mode] = {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      activeSessionId: parsed.activeSessionId ?? null,
    }
  } catch {
    memoryState[mode] = { sessions: [], activeSessionId: null }
  }
}

function saveMode(mode: FocusmapChatMode, broadcast = true) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify(memoryState[mode]))
    if (broadcast) channel?.postMessage({ mode })
  } catch {
    // 履歴保存に失敗しても、現在の会話はメモリ上で継続する。
  }
}

function notify(broadcast = true) {
  for (const listener of listeners) listener()
  if (broadcast) {
    saveMode("normal", false)
    saveMode("automation", false)
    channel?.postMessage({ mode: "normal" })
    channel?.postMessage({ mode: "automation" })
  }
}

function findSession(mode: FocusmapChatMode, sessionId: string) {
  return memoryState[mode].sessions.find(session => session.id === sessionId) ?? null
}

function ensureSession(mode: FocusmapChatMode, sessionId?: string | null) {
  ensureBrowserSync()
  loadMode(mode)

  if (sessionId) {
    const found = findSession(mode, sessionId)
    if (found) {
      memoryState[mode].activeSessionId = found.id
      saveMode(mode)
      return found
    }
  }

  const existingActive = memoryState[mode].activeSessionId
    ? findSession(mode, memoryState[mode].activeSessionId)
    : null
  if (existingActive) return existingActive

  const createdAt = nowIso()
  const session: FocusmapChatSession = {
    id: createId("chat"),
    mode,
    title: initialTitle(mode),
    messages: [],
    createdAt,
    updatedAt: createdAt,
  }
  memoryState[mode].sessions = [session, ...memoryState[mode].sessions]
  memoryState[mode].activeSessionId = session.id
  saveMode(mode)
  return session
}

function updateSession(mode: FocusmapChatMode, sessionId: string, updater: (session: FocusmapChatSession) => void) {
  const session = findSession(mode, sessionId)
  if (!session) return
  updater(session)
  session.updatedAt = nowIso()
  memoryState[mode].sessions = [
    session,
    ...memoryState[mode].sessions.filter(item => item.id !== sessionId),
  ]
  saveMode(mode)
  for (const listener of listeners) listener()
}

export function subscribeChatRuntime(listener: () => void) {
  ensureBrowserSync()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getChatState(mode: FocusmapChatMode): RuntimeState {
  ensureBrowserSync()
  loadMode(mode)
  return cloneState(memoryState[mode])
}

export function createChatSession(mode: FocusmapChatMode) {
  const createdAt = nowIso()
  const session: FocusmapChatSession = {
    id: createId("chat"),
    mode,
    title: initialTitle(mode),
    messages: [],
    createdAt,
    updatedAt: createdAt,
  }
  loadMode(mode)
  memoryState[mode].sessions = [session, ...memoryState[mode].sessions]
  memoryState[mode].activeSessionId = session.id
  saveMode(mode)
  for (const listener of listeners) listener()
  return session
}

export function selectChatSession(mode: FocusmapChatMode, sessionId: string) {
  loadMode(mode)
  if (!findSession(mode, sessionId)) return
  memoryState[mode].activeSessionId = sessionId
  saveMode(mode)
  for (const listener of listeners) listener()
}

export function deleteChatSession(mode: FocusmapChatMode, sessionId: string) {
  loadMode(mode)
  memoryState[mode].sessions = memoryState[mode].sessions.filter(session => session.id !== sessionId)
  if (memoryState[mode].activeSessionId === sessionId) {
    memoryState[mode].activeSessionId = memoryState[mode].sessions[0]?.id ?? null
  }
  saveMode(mode)
  for (const listener of listeners) listener()
}

export function countRunningMessages(mode: FocusmapChatMode) {
  loadMode(mode)
  return memoryState[mode].sessions.reduce(
    (total, session) => total + session.messages.filter(message => message.status === "running").length,
    0,
  )
}

export function sendChatMessage(options: SendOptions) {
  const text = options.text.trim()
  if (!text) return null

  const session = ensureSession(options.mode, options.sessionId)
  const userMessage: FocusmapChatMessage = {
    id: createId("msg"),
    role: "user",
    content: text,
    createdAt: nowIso(),
    status: "completed",
    hidden: options.silent === true,
  }
  const assistantMessage: FocusmapChatMessage = {
    id: createId("msg"),
    role: "assistant",
    content: options.mode === "automation"
      ? "バックグラウンド実行の準備をしています..."
      : "考えています...",
    createdAt: nowIso(),
    status: "running",
    modelLabel: options.mode === "automation" ? "deepseek-v4-pro" : "gemini-3.1-flash-lite",
  }

  updateSession(options.mode, session.id, current => {
    if (current.messages.length === 0) current.title = titleFromText(text)
    current.messages.push(userMessage, assistantMessage)
  })

  const flightKey = assistantMessage.id
  const run = options.mode === "automation"
    ? runAutomationMessage({ ...options, sessionId: session.id, text, assistantMessageId: assistantMessage.id })
    : runNormalMessage({ ...options, sessionId: session.id, text, assistantMessageId: assistantMessage.id })

  inFlight.set(flightKey, run.finally(() => inFlight.delete(flightKey)))
  return { sessionId: session.id, messageId: assistantMessage.id }
}

async function runNormalMessage(options: SendOptions & { sessionId: string; assistantMessageId: string }) {
  try {
    const session = findSession("normal", options.sessionId)
    const history = session
      ? visibleConversationMessages({
        ...session,
        messages: session.messages.filter(message => message.id !== options.assistantMessageId),
      })
      : []

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.text,
        history,
        context: {
          activeProjectId: options.projectId || undefined,
        },
        summaryContext: session?.summaryContext || undefined,
      }),
    })
    const data = await res.json() as ChatApiResponse
    if (!res.ok) throw new Error(data?.error || "AI応答に失敗しました")

    updateSession("normal", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      applyNormalResponse(target, data)
    })

    if (data.shouldSummarize) {
      await summarizeChatSession("normal", options.sessionId)
    }
  } catch (error) {
    updateSession("normal", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      target.content = "AI応答の取得に失敗しました。履歴には残しているので、再送信できます。"
      target.status = "failed"
      target.error = error instanceof Error ? error.message : "unknown"
      target.options = [
        { label: "リトライ", value: options.text },
        { label: "入力を編集", value: options.text, action: "restore_input" },
      ]
    })
  }
}

async function runAutomationMessage(options: SendOptions & { sessionId: string; assistantMessageId: string }) {
  try {
    const res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.text,
        space_id: options.spaceId ?? null,
        auto_execute: true,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || "自動化タスクの投入に失敗しました")

    updateSession("automation", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      target.modelLabel = data.model_label || "deepseek-v4-pro"
      target.taskId = data.task_id ?? null
      target.status = data.task_id ? "completed" : "failed"
      target.content = data.task_id
        ? "自動化タスクをバックグラウンドに投入しました。他の画面へ移動しても実行状況はここに残ります。"
        : data.intent?.followup_question || data.message || "実行する自動化を判定できませんでした。"
    })
  } catch (error) {
    updateSession("automation", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      target.content = "自動化タスクの投入に失敗しました。接続設定を確認してください。"
      target.status = "failed"
      target.error = error instanceof Error ? error.message : "unknown"
      target.options = [
        { label: "リトライ", value: options.text },
        { label: "入力を編集", value: options.text, action: "restore_input" },
      ]
    })
  }
}

async function summarizeChatSession(mode: FocusmapChatMode, sessionId: string) {
  const session = findSession(mode, sessionId)
  if (!session) return
  const messages = visibleConversationMessages(session)
  if (messages.length < 2) return

  try {
    const res = await fetch("/api/ai/chat/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
    const data = await res.json().catch(() => null) as { summary?: string } | null
    if (!res.ok || !data?.summary) return

    updateSession(mode, sessionId, current => {
      current.summaryContext = data.summary ?? null
      current.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: data.summary ?? "",
        createdAt: nowIso(),
        status: "completed",
        isSummaryDivider: true,
      })
    })
  } catch {
    // 要約に失敗しても会話自体は継続する。
  }
}

export function resetChatSession(mode: FocusmapChatMode, sessionId: string) {
  updateSession(mode, sessionId, session => {
    session.title = initialTitle(mode)
    session.messages = []
    session.summaryContext = null
  })
}

export function markChatOptionUsed(
  mode: FocusmapChatMode,
  sessionId: string,
  messageId: string,
  selectedOption?: string,
) {
  updateSession(mode, sessionId, session => {
    const target = session.messages.find(message => message.id === messageId)
    if (!target) return
    target.optionsUsed = true
    target.selectedOption = selectedOption
  })
}

export function cancelChatAction(mode: FocusmapChatMode, sessionId: string, messageId: string) {
  updateSession(mode, sessionId, session => {
    const target = session.messages.find(message => message.id === messageId)
    if (!target) return
    target.action = undefined
    target.pendingAction = undefined
    target.calendarChoices = undefined
    target.actionStatus = undefined
  })
}

export function setBestProposalStatus(
  mode: FocusmapChatMode,
  sessionId: string,
  messageId: string,
  status: "pending" | "accepted" | "editing",
) {
  updateSession(mode, sessionId, session => {
    const target = session.messages.find(message => message.id === messageId)
    if (!target?.bestProposal) return
    target.bestProposalStatus = status
  })
}

export function markProposalUsed(mode: FocusmapChatMode, sessionId: string, messageId: string) {
  updateSession(mode, sessionId, session => {
    const target = session.messages.find(message => message.id === messageId)
    if (!target) return
    target.proposalUsed = true
  })
}

export async function executeChatAction(
  mode: FocusmapChatMode,
  sessionId: string,
  messageId: string,
): Promise<ExecuteActionResponse | null> {
  const session = findSession(mode, sessionId)
  const target = session?.messages.find(message => message.id === messageId)
  if (!target?.action) return null

  updateSession(mode, sessionId, current => {
    const message = current.messages.find(item => item.id === messageId)
    if (message) message.actionStatus = "executing"
  })

  try {
    const res = await fetch("/api/ai/chat/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: target.action }),
    })
    const data = await res.json().catch(() => ({})) as ExecuteActionResponse
    const success = res.ok && data.success !== false

    updateSession(mode, sessionId, current => {
      const message = current.messages.find(item => item.id === messageId)
      if (message) message.actionStatus = success ? "success" : "failed"
      current.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: data.message || (success ? "実行しました。" : "実行に失敗しました。"),
        createdAt: nowIso(),
        status: success ? "completed" : "failed",
        options: data.continueOptions?.length ? data.continueOptions : undefined,
      })
    })

    return data
  } catch (error) {
    updateSession(mode, sessionId, current => {
      const message = current.messages.find(item => item.id === messageId)
      if (message) message.actionStatus = "failed"
      current.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: "実行に失敗しました。もう一度試してください。",
        createdAt: nowIso(),
        status: "failed",
        error: error instanceof Error ? error.message : "unknown",
      })
    })
    return null
  }
}

export async function selectChatCalendarChoice(
  mode: FocusmapChatMode,
  sessionId: string,
  messageId: string,
  choice: FocusmapCalendarChoice,
): Promise<ExecuteActionResponse | null> {
  const session = findSession(mode, sessionId)
  const target = session?.messages.find(message => message.id === messageId)
  if (!target?.pendingAction) return null

  const action: FocusmapChatAction = {
    ...target.pendingAction,
    params: {
      ...(target.pendingAction.params || {}),
      calendar_id: choice.id,
    },
  }

  updateSession(mode, sessionId, current => {
    const message = current.messages.find(item => item.id === messageId)
    if (!message) return
    message.calendarChoiceUsed = true
    message.actionStatus = "executing"
  })

  try {
    const res = await fetch("/api/ai/chat/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({})) as ExecuteActionResponse
    const success = res.ok && data.success !== false

    updateSession(mode, sessionId, current => {
      const message = current.messages.find(item => item.id === messageId)
      if (message) message.actionStatus = success ? "success" : "failed"
      current.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: data.message || (success ? "実行しました。" : "実行に失敗しました。"),
        createdAt: nowIso(),
        status: success ? "completed" : "failed",
        options: data.continueOptions?.length ? data.continueOptions : undefined,
      })
    })

    return data
  } catch (error) {
    updateSession(mode, sessionId, current => {
      const message = current.messages.find(item => item.id === messageId)
      if (message) message.actionStatus = "failed"
      current.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: "実行に失敗しました。もう一度試してください。",
        createdAt: nowIso(),
        status: "failed",
        error: error instanceof Error ? error.message : "unknown",
      })
    })
    return null
  }
}
