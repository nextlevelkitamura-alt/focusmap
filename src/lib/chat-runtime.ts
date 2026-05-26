"use client"

export type FocusmapChatMode = "normal" | "automation"
export type FocusmapChatRole = "user" | "assistant" | "system"
export type FocusmapChatStatus = "idle" | "running" | "completed" | "failed"

export interface FocusmapChatMessage {
  id: string
  role: FocusmapChatRole
  content: string
  createdAt: string
  status?: FocusmapChatStatus
  modelLabel?: string
  taskId?: string | null
  error?: string | null
}

export interface FocusmapChatSession {
  id: string
  mode: FocusmapChatMode
  title: string
  messages: FocusmapChatMessage[]
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
    const history = (session?.messages ?? [])
      .filter(message => message.id !== options.assistantMessageId && message.role !== "system")
      .map(message => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }))

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.text,
        history,
        context: {
          activeProjectId: options.projectId || undefined,
        },
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || "AI応答に失敗しました")

    updateSession("normal", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      target.content = data.reply || "応答を取得しました。"
      target.status = "completed"
      target.modelLabel = data.model_label || "gemini-3.1-flash-lite"
    })
  } catch (error) {
    updateSession("normal", options.sessionId, session => {
      const target = session.messages.find(message => message.id === options.assistantMessageId)
      if (!target) return
      target.content = "AI応答の取得に失敗しました。履歴には残しているので、再送信できます。"
      target.status = "failed"
      target.error = error instanceof Error ? error.message : "unknown"
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
    })
  }
}
