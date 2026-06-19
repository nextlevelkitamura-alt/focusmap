"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"

const RUNNER_ONLINE_WINDOW_MS = 90_000
const RUNNER_STATUS_POLL_MS = 3_000
const RUNNER_STATUS_REFRESH_DEDUPE_MS = 750

type RunnerHeartbeat = {
  status?: string | null
  last_seen_at?: string | null
  last_heartbeat_at?: string | null
  updated_at?: string | null
  metadata?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
}

export type CodexRunnerStatus = {
  checked: boolean
  loading: boolean
  ready: boolean
  lastSeenAt: string | null
  metadata: Record<string, unknown> | null
  refresh: () => Promise<void> | undefined
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible"
}

function heartbeatSeenAt(heartbeat: RunnerHeartbeat) {
  return heartbeat.last_seen_at || heartbeat.last_heartbeat_at || heartbeat.updated_at || null
}

function heartbeatMetadata(heartbeat: RunnerHeartbeat | null | undefined) {
  if (!heartbeat) return null
  return heartbeat.metadata_json && typeof heartbeat.metadata_json === "object"
    ? heartbeat.metadata_json
    : heartbeat.metadata && typeof heartbeat.metadata === "object"
      ? heartbeat.metadata
      : null
}

function latestHeartbeat(heartbeats: RunnerHeartbeat[]) {
  return heartbeats
    .map(heartbeat => ({ heartbeat, seenAt: heartbeatSeenAt(heartbeat) }))
    .filter((entry): entry is { heartbeat: RunnerHeartbeat; seenAt: string } => !!entry.seenAt)
    .sort((a, b) => (Date.parse(b.seenAt) || 0) - (Date.parse(a.seenAt) || 0))[0] ?? null
}

export function isOnlineCodexRunnerHeartbeat(heartbeat: RunnerHeartbeat | null | undefined, now = Date.now()) {
  if (!heartbeat || heartbeat.status === "offline") return false
  const seenAt = heartbeatSeenAt(heartbeat)
  const seenMs = seenAt ? Date.parse(seenAt) : Number.NaN
  return Number.isFinite(seenMs) && seenMs > 0 && now - seenMs < RUNNER_ONLINE_WINDOW_MS
}

export function useCodexRunnerStatus(enabled = true): CodexRunnerStatus {
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const lastRefreshRequestedAtRef = useRef(0)
  const [state, setState] = useState<Omit<CodexRunnerStatus, "refresh">>({
    checked: false,
    loading: enabled,
    ready: false,
    lastSeenAt: null,
    metadata: null,
  })

  const refresh = useCallback(() => {
    if (!enabled || !isPageVisible()) return undefined
    if (refreshInFlightRef.current) return refreshInFlightRef.current
    const requestedAt = Date.now()
    if (requestedAt - lastRefreshRequestedAtRef.current < RUNNER_STATUS_REFRESH_DEDUPE_MS) return undefined
    lastRefreshRequestedAtRef.current = requestedAt
    setState(previous => (previous.checked ? previous : { ...previous, loading: true }))

    const refreshPromise = (async () => {
      try {
        const response = await fetchWithSupabaseAuth("/api/task-progress/runner-heartbeats?limit=5", { cache: "no-store" })
        if (!response.ok) throw new Error(`heartbeat fetch failed (${response.status})`)
        const data = await response.json().catch(() => ({})) as { heartbeats?: RunnerHeartbeat[] }
        const latest = latestHeartbeat(Array.isArray(data.heartbeats) ? data.heartbeats : [])
        setState({
          checked: true,
          loading: false,
          ready: isOnlineCodexRunnerHeartbeat(latest?.heartbeat),
          lastSeenAt: latest?.seenAt ?? null,
          metadata: heartbeatMetadata(latest?.heartbeat),
        })
      } catch {
        setState(previous => ({
          ...previous,
          checked: true,
          loading: false,
          ready: previous.ready && isOnlineCodexRunnerHeartbeat({ last_seen_at: previous.lastSeenAt }),
        }))
      } finally {
        refreshInFlightRef.current = null
      }
    })()

    refreshInFlightRef.current = refreshPromise
    return refreshPromise
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setState({ checked: false, loading: false, ready: false, lastSeenAt: null, metadata: null })
      return
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void refresh()
    }, RUNNER_STATUS_POLL_MS)
    return () => window.clearInterval(intervalId)
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const handleForeground = () => {
      if (isPageVisible()) void refresh()
    }
    document.addEventListener("visibilitychange", handleForeground)
    window.addEventListener("focus", handleForeground)
    window.addEventListener("pageshow", handleForeground)
    window.addEventListener("focusmap:native-app-resume", handleForeground)
    return () => {
      document.removeEventListener("visibilitychange", handleForeground)
      window.removeEventListener("focus", handleForeground)
      window.removeEventListener("pageshow", handleForeground)
      window.removeEventListener("focusmap:native-app-resume", handleForeground)
    }
  }, [enabled, refresh])

  return { ...state, refresh }
}
