"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"

export interface AgentChatSession {
  id: string
  title: string
  messages: UIMessage[]
  createdAt: number
  updatedAt: number
}

interface SessionsState {
  sessions: AgentChatSession[]
  activeSessionId: string | null
}

const STORAGE_KEY = "focusmap:agent-chat:sessions"
const MAX_SESSIONS = 50

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
  return text.length > 28 ? `${text.slice(0, 28)}…` : text
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

export function useAgentChatSessions(scopeKey = "general") {
  const [state, setState] = useState<SessionsState>({ sessions: [], activeSessionId: null })
  const [hydrated, setHydrated] = useState(false)
  const [loadedScopeKey, setLoadedScopeKey] = useState(scopeKey)
  const storageKey = storageKeyForScope(scopeKey)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setHydrated(false)
      setState(load(storageKey))
      setLoadedScopeKey(scopeKey)
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [scopeKey, storageKey])

  useEffect(() => {
    if (!hydrated || loadedScopeKey !== scopeKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // storage full or unavailable — keep in-memory state
    }
  }, [state, hydrated, loadedScopeKey, scopeKey, storageKey])

  const createSession = useCallback((): string => {
    const id = newId()
    const now = Date.now()
    setState(prev => ({
      sessions: [{ id, title: "新しいチャット", messages: [], createdAt: now, updatedAt: now }, ...prev.sessions].slice(0, MAX_SESSIONS),
      activeSessionId: id,
    }))
    return id
  }, [])

  const selectSession = useCallback((id: string) => {
    setState(prev => (prev.activeSessionId === id ? prev : { ...prev, activeSessionId: id }))
  }, [])

  const deleteSession = useCallback((id: string) => {
    setState(prev => {
      const sessions = prev.sessions.filter(session => session.id !== id)
      const activeSessionId = prev.activeSessionId === id ? (sessions[0]?.id ?? null) : prev.activeSessionId
      return { sessions, activeSessionId }
    })
  }, [])

  // Persist the current useChat messages into the active session, creating one if needed.
  const saveMessages = useCallback((messages: UIMessage[]): string | null => {
    if (messages.length === 0) return stateRef.current.activeSessionId
    const now = Date.now()
    const current = stateRef.current
    let targetId = current.activeSessionId
    if (!targetId || !current.sessions.some(session => session.id === targetId)) {
      targetId = newId()
      setState(prev => ({
        sessions: [
          { id: targetId as string, title: deriveTitle(messages), messages, createdAt: now, updatedAt: now },
          ...prev.sessions,
        ].slice(0, MAX_SESSIONS),
        activeSessionId: targetId,
      }))
      return targetId
    }
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.map(session =>
        session.id === targetId
          ? { ...session, messages, updatedAt: now, title: session.title === "新しいチャット" ? deriveTitle(messages) : session.title }
          : session,
      ),
    }))
    return targetId
  }, [])

  const activeSession = state.sessions.find(session => session.id === state.activeSessionId) ?? null

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
  }
}
