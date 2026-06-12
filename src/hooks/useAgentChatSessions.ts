"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FileUIPart, UIMessage } from "ai"

export type AgentChatStatus = "idle" | "running" | "completed" | "failed"
export type AgentChatMode = "general" | "project"

export interface AgentChatSession {
  id: string
  title: string
  messages: UIMessage[]
  createdAt: number
  updatedAt: number
  status?: AgentChatStatus
  lastError?: string | null
  runStartedAt?: string | null
  runCompletedAt?: string | null
}

interface SessionsState {
  sessions: AgentChatSession[]
  activeSessionId: string | null
}

interface StartRunInput {
  text: string
  files: FileUIPart[]
  spaceId?: string | null
  projectId?: string | null
  chatMode: AgentChatMode
}

const STORAGE_KEY = "focusmap:agent-chat:sessions"
const MAX_SESSIONS = 50
const POLL_MS = 3000

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find(message => message.role === "user")
  if (!firstUser) return "新しいチャット"
  const text = firstUser.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join(" ")
    .trim()
  if (!text) return "新しいチャット"
  return text.length > 28 ? `${text.slice(0, 28)}...` : text
}

function storageKeyForScope(scopeKey: string) {
  return scopeKey === "general" ? STORAGE_KEY : `${STORAGE_KEY}:${scopeKey}`
}

function load(storageKey: string): SessionsState {
  if (typeof window === "undefined") return { sessions: [], activeSessionId: null }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { sessions: [], activeSessionId: null }
    const parsed = JSON.parse(raw) as SessionsState
    if (!Array.isArray(parsed.sessions)) return { sessions: [], activeSessionId: null }
    return { sessions: parsed.sessions, activeSessionId: parsed.activeSessionId ?? null }
  } catch {
    return { sessions: [], activeSessionId: null }
  }
}

function save(storageKey: string, state: SessionsState) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // Storage may be full; DB remains the source of truth.
  }
}

function normalizeRemoteSession(value: unknown): AgentChatSession | null {
  const session = value as AgentChatSession | null
  if (!session || typeof session !== "object" || typeof session.id !== "string") return null
  return {
    id: session.id,
    title: typeof session.title === "string" ? session.title : "新しいチャット",
    messages: Array.isArray(session.messages) ? session.messages : [],
    createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
    status: session.status ?? "idle",
    lastError: session.lastError ?? null,
    runStartedAt: session.runStartedAt ?? null,
    runCompletedAt: session.runCompletedAt ?? null,
  }
}

function createUserMessage(text: string, files: FileUIPart[]): UIMessage {
  const parts: UIMessage["parts"] = []
  if (text.trim()) parts.push({ type: "text", text: text.trim() })
  parts.push(...files)
  return {
    id: newId(),
    role: "user",
    parts,
  }
}

async function fetchSessions(scopeKey: string): Promise<AgentChatSession[]> {
  const response = await fetch(`/api/ai/agent/sessions?scope_key=${encodeURIComponent(scopeKey)}`, {
    method: "GET",
    credentials: "same-origin",
  })
  if (!response.ok) throw new Error("Failed to load chat sessions")
  const data = await response.json() as { sessions?: unknown[] }
  return (data.sessions ?? [])
    .map(normalizeRemoteSession)
    .filter((session): session is AgentChatSession => session !== null)
}

function upsertSession(sessions: AgentChatSession[], next: AgentChatSession) {
  const rest = sessions.filter(session => session.id !== next.id)
  return [next, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
}

export function useAgentChatSessions(scopeKey = "general") {
  const storageKey = storageKeyForScope(scopeKey)
  const [state, setState] = useState<SessionsState>({ sessions: [], activeSessionId: null })
  const [hydrated, setHydrated] = useState(false)
  const [loadedScopeKey, setLoadedScopeKey] = useState(scopeKey)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const refresh = useCallback(async () => {
    const remoteSessions = await fetchSessions(scopeKey)
    setState(prev => {
      const activeSessionId = prev.activeSessionId && remoteSessions.some(session => session.id === prev.activeSessionId)
        ? prev.activeSessionId
        : (remoteSessions[0]?.id ?? prev.activeSessionId)
      return { sessions: remoteSessions, activeSessionId }
    })
    return remoteSessions
  }, [scopeKey])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setHydrated(false)
      const cached = load(storageKey)
      setState(cached)
      setLoadedScopeKey(scopeKey)
      setHydrated(true)
      void fetchSessions(scopeKey)
        .then(remoteSessions => {
          if (cancelled) return
          setState(prev => ({
            sessions: remoteSessions,
            activeSessionId: prev.activeSessionId && remoteSessions.some(session => session.id === prev.activeSessionId)
              ? prev.activeSessionId
              : (remoteSessions[0]?.id ?? prev.activeSessionId),
          }))
        })
        .catch(() => {
          // Keep the local cache visible when the network or migration is not ready.
        })
    })
    return () => {
      cancelled = true
    }
  }, [scopeKey, storageKey])

  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey) return
    save(storageKey, state)
  }, [state, hydrated, loadedScopeKey, scopeKey, storageKey])

  const hasRunningSession = state.sessions.some(session => session.status === "running")
  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey || !hasRunningSession) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasRunningSession, hydrated, loadedScopeKey, refresh, scopeKey])

  const createSession = useCallback((): string => {
    const id = newId()
    const now = Date.now()
    const session: AgentChatSession = {
      id,
      title: "新しいチャット",
      messages: [],
      createdAt: now,
      updatedAt: now,
      status: "idle",
      lastError: null,
      runStartedAt: null,
      runCompletedAt: null,
    }
    setState(prev => ({
      sessions: upsertSession(prev.sessions, session),
      activeSessionId: id,
    }))
    void fetch("/api/ai/agent/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id, scopeKey }),
    }).catch(() => {})
    return id
  }, [scopeKey])

  const selectSession = useCallback((id: string) => {
    setState(prev => (prev.activeSessionId === id ? prev : { ...prev, activeSessionId: id }))
  }, [])

  const deleteSession = useCallback((id: string) => {
    setState(prev => {
      const sessions = prev.sessions.filter(session => session.id !== id)
      const activeSessionId = prev.activeSessionId === id ? (sessions[0]?.id ?? null) : prev.activeSessionId
      return { sessions, activeSessionId }
    })
    void fetch(`/api/ai/agent/sessions/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {})
  }, [])

  const saveMessages = useCallback((messages: UIMessage[]): string | null => {
    if (messages.length === 0) return stateRef.current.activeSessionId
    const now = Date.now()
    const current = stateRef.current
    let targetId = current.activeSessionId
    if (!targetId || !current.sessions.some(session => session.id === targetId)) {
      targetId = newId()
    }
    setState(prev => {
      const existing = prev.sessions.find(session => session.id === targetId)
      const session: AgentChatSession = {
        id: targetId as string,
        title: existing?.title && existing.title !== "新しいチャット" ? existing.title : deriveTitle(messages),
        messages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        status: existing?.status ?? "completed",
        lastError: existing?.lastError ?? null,
        runStartedAt: existing?.runStartedAt ?? null,
        runCompletedAt: existing?.runCompletedAt ?? null,
      }
      return {
        sessions: upsertSession(prev.sessions, session),
        activeSessionId: targetId,
      }
    })
    return targetId
  }, [])

  const startRun = useCallback(async ({ text, files, spaceId, projectId, chatMode }: StartRunInput) => {
    const userMessage = createUserMessage(text, files)
    const current = stateRef.current
    const now = Date.now()
    const targetId = current.activeSessionId && current.sessions.some(session => session.id === current.activeSessionId)
      ? current.activeSessionId
      : newId()
    const existing = current.sessions.find(session => session.id === targetId)
    const previousMessages = existing?.messages ?? []
    const optimisticMessages = [...previousMessages, userMessage]
    const optimisticSession: AgentChatSession = {
      id: targetId,
      title: existing?.title && existing.title !== "新しいチャット" ? existing.title : deriveTitle(optimisticMessages),
      messages: optimisticMessages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      status: "running",
      lastError: null,
      runStartedAt: new Date(now).toISOString(),
      runCompletedAt: null,
    }

    setState(prev => ({
      sessions: upsertSession(prev.sessions, optimisticSession),
      activeSessionId: targetId,
    }))

    const body = JSON.stringify({
      sessionId: targetId,
      scopeKey,
      chatMode,
      spaceId: spaceId ?? null,
      projectId: projectId ?? null,
      previousMessages,
      userMessage,
    })
    const response = await fetch("/api/ai/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: files.length === 0 && body.length < 60_000,
      body,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || "Failed to start chat run")
    }
    const data = await response.json() as { session?: unknown }
    const remoteSession = normalizeRemoteSession(data.session)
    if (remoteSession) {
      setState(prev => ({
        sessions: upsertSession(prev.sessions, remoteSession),
        activeSessionId: remoteSession.id,
      }))
    }
    return remoteSession ?? optimisticSession
  }, [scopeKey])

  const activeSession = useMemo(
    () => state.sessions.find(session => session.id === state.activeSessionId) ?? null,
    [state.activeSessionId, state.sessions],
  )

  return {
    hydrated,
    loadedScopeKey,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    activeSession,
    createSession,
    selectSession,
    deleteSession,
    saveMessages,
    startRun,
    refresh,
  }
}
