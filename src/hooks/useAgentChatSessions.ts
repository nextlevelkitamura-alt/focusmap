"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FileUIPart, UIMessage } from "ai"
import { createClient as createBrowserSupabaseClient } from "@/utils/supabase/client"
import type { AgentModelMode } from "@/lib/ai/agent-model-mode"
import { broadcastCalendarSync, invalidateCalendarCache } from "@/hooks/useCalendarEvents"

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
  modelMode: AgentModelMode
}

interface CreateSessionInput {
  chatMode?: AgentChatMode
  spaceId?: string | null
  projectId?: string | null
}

interface AgentChatSessionRow {
  id: string
  title?: string | null
  messages?: UIMessage[] | null
  status?: AgentChatStatus | null
  last_error?: string | null
  run_started_at?: string | null
  run_completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const STORAGE_KEY = "focusmap:agent-chat:sessions"
const MAX_SESSIONS = 50
const POLL_MS = 3000
const CALENDAR_MUTATION_TOOLS = new Set(["addCalendarEvent", "updateCalendarEvent", "deleteCalendarEvent"])

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

function parseDateMs(value: unknown, fallback = Date.now()) {
  if (typeof value !== "string") return fallback
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : fallback
}

function normalizeRealtimeSession(value: unknown): AgentChatSession | null {
  const row = value as AgentChatSessionRow | null
  if (!row || typeof row !== "object" || typeof row.id !== "string") return null
  const now = Date.now()
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "新しいチャット",
    messages: Array.isArray(row.messages) ? row.messages : [],
    createdAt: parseDateMs(row.created_at, now),
    updatedAt: parseDateMs(row.updated_at, now),
    status: row.status ?? "idle",
    lastError: row.last_error ?? null,
    runStartedAt: row.run_started_at ?? null,
    runCompletedAt: row.run_completed_at ?? null,
  }
}

function sessionHasCompletedCalendarMutation(session: AgentChatSession): boolean {
  return session.messages.some(message => {
    const metadata = message.metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
    const record = metadata as Record<string, unknown>
    return record.focusmapAgentProgress === true &&
      record.state === "done" &&
      typeof record.toolName === "string" &&
      CALENDAR_MUTATION_TOOLS.has(record.toolName)
  })
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
  const calendarMutationNotifiedRef = useRef(new Set<string>())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const notifyCalendarMutationIfNeeded = useCallback((session: AgentChatSession) => {
    if (!sessionHasCompletedCalendarMutation(session)) return
    const key = `${session.id}:${session.runCompletedAt ?? session.updatedAt}`
    if (calendarMutationNotifiedRef.current.has(key)) return
    calendarMutationNotifiedRef.current.add(key)
    invalidateCalendarCache()
    broadcastCalendarSync()
  }, [])

  const refresh = useCallback(async () => {
    const remoteSessions = await fetchSessions(scopeKey)
    remoteSessions.forEach(notifyCalendarMutationIfNeeded)
    setState(prev => {
      const activeSessionId = prev.activeSessionId && remoteSessions.some(session => session.id === prev.activeSessionId)
        ? prev.activeSessionId
        : (remoteSessions[0]?.id ?? prev.activeSessionId)
      return { sessions: remoteSessions, activeSessionId }
    })
    return remoteSessions
  }, [notifyCalendarMutationIfNeeded, scopeKey])

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
          remoteSessions.forEach(notifyCalendarMutationIfNeeded)
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
  }, [notifyCalendarMutationIfNeeded, scopeKey, storageKey])

  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey) return
    save(storageKey, state)
  }, [state, hydrated, loadedScopeKey, scopeKey, storageKey])

  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey) return
    const supabase = createBrowserSupabaseClient()
    const channel = supabase
      .channel(`agent-chat-sessions:${scopeKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_chat_sessions",
          filter: `scope_key=eq.${scopeKey}`,
        },
        payload => {
          if (payload.eventType === "DELETE") {
            const deletedId = typeof payload.old?.id === "string" ? payload.old.id : null
            if (!deletedId) return
            setState(prev => {
              const sessions = prev.sessions.filter(session => session.id !== deletedId)
              const activeSessionId = prev.activeSessionId === deletedId ? (sessions[0]?.id ?? null) : prev.activeSessionId
              return { sessions, activeSessionId }
            })
            return
          }

          const session = normalizeRealtimeSession(payload.new)
          if (!session) return
          notifyCalendarMutationIfNeeded(session)
          setState(prev => ({
            sessions: upsertSession(prev.sessions, session),
            activeSessionId: prev.activeSessionId ?? session.id,
          }))
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hydrated, loadedScopeKey, notifyCalendarMutationIfNeeded, scopeKey])

  const hasRunningSession = state.sessions.some(session => session.status === "running")
  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey || !hasRunningSession) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasRunningSession, hydrated, loadedScopeKey, refresh, scopeKey])

  const createSession = useCallback((input: CreateSessionInput = {}): string => {
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
      body: JSON.stringify({
        id,
        scopeKey,
        chatMode: input.chatMode ?? "general",
        spaceId: input.spaceId ?? null,
        projectId: input.projectId ?? null,
      }),
    })
      .then(async response => {
        if (!response.ok) return null
        const data = await response.json().catch(() => null)
        return data as { session?: unknown } | null
      })
      .then(data => {
        const remoteSession = normalizeRemoteSession(data?.session)
        if (!remoteSession) return
        setState(prev => ({
          sessions: upsertSession(prev.sessions, remoteSession),
          activeSessionId: remoteSession.id,
        }))
      })
      .catch(() => {})
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

  const startRun = useCallback(async ({ text, files, spaceId, projectId, chatMode, modelMode }: StartRunInput) => {
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
      modelMode,
      spaceId: spaceId ?? null,
      projectId: projectId ?? null,
      previousMessages,
      userMessage,
    })
    try {
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
        notifyCalendarMutationIfNeeded(remoteSession)
        setState(prev => ({
          sessions: upsertSession(prev.sessions, remoteSession),
          activeSessionId: remoteSession.id,
        }))
      }
      return remoteSession ?? optimisticSession
    } catch (error) {
      const failedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : "Failed to start chat run"
      setState(prev => {
        const currentSession = prev.sessions.find(session => session.id === targetId) ?? optimisticSession
        const failedSession: AgentChatSession = {
          ...currentSession,
          status: "failed",
          lastError: message,
          updatedAt: Date.now(),
          runCompletedAt: failedAt,
        }
        return {
          sessions: upsertSession(prev.sessions, failedSession),
          activeSessionId: targetId,
        }
      })
      throw new Error(message)
    }
  }, [notifyCalendarMutationIfNeeded, scopeKey])

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
