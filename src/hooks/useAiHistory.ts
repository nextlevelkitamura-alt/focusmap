"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import { aiHistoryRepoMatchesFilter, normalizeAiHistoryRepoPath } from "@/lib/ai-history-display"
import type {
  AiHistoryListResponse,
  AiHistoryPlacement,
  AiHistoryProvider,
  AiHistoryRepoFilter,
  AiHistoryScopeFilter,
  AiHistorySnapshotResponse,
} from "@/types/ai-history"

const DEFAULT_LIMIT = 100
const DEFAULT_POLL_INTERVAL_MS = 2_000
const SNAPSHOT_LIMIT = 500
const AI_HISTORY_METRIC_EVENT_LIMIT = 200

type AiHistoryFirstSeenSource = "full_list" | "snapshot_merge"

type AiHistoryFirstSeenMetric = {
  historyItemId: string
  status: AiHistoryListResponse["items"][number]["status"]
  firstSeenAt: string
  firstSeenPerformanceMs: number | null
  source: AiHistoryFirstSeenSource
  placement: AiHistoryPlacement
  repoPath: string | null
  worktreePath: string | null
  externalThreadId: string | null
  indexedAt: string | null
  lastActivityAt: string | null
}

type FocusmapAiHistoryMetrics = {
  firstSeenById: Record<string, AiHistoryFirstSeenMetric>
  events: AiHistoryFirstSeenMetric[]
  lastUpdatedAt: string | null
}

declare global {
  interface Window {
    __focusmapAiHistoryMetrics?: FocusmapAiHistoryMetrics
  }
}

const EMPTY_RESPONSE: AiHistoryListResponse = {
  items: [],
  counts: { unplaced: 0, mindmap: 0 },
  nextCursor: null,
  sync: {
    featureEnabled: false,
    aiOnline: false,
    agentConnected: false,
    selectedRepo: "all",
    selectedScope: "project",
    selectedProvider: "codex_app",
    providerOptions: [
      { provider: "codex_app", label: "Codex", enabled: true, agentSeen: false },
    ],
    repoOptions: [],
    lastIndexedAt: null,
    lastReconciledAt: null,
    nextReconcileAt: null,
  },
  page: {
    limit: DEFAULT_LIMIT,
    cursor: null,
  },
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible"
}

function sameRepoFilter(left: AiHistoryRepoFilter, right: AiHistoryRepoFilter) {
  if (left === "all" || right === "all") return left === right
  return normalizeAiHistoryRepoPath(left) === normalizeAiHistoryRepoPath(right)
}

function aiHistoryExternalIdentity(item: { provider: AiHistoryProvider; externalThreadId: string; repoPath: string }) {
  return `${item.provider}:${normalizeAiHistoryRepoPath(item.repoPath)}:${item.externalThreadId}`
}

function currentPerformanceMs() {
  if (typeof performance === "undefined" || typeof performance.now !== "function") return null
  return Math.round(performance.now() * 1000) / 1000
}

function focusmapAiHistoryMetrics() {
  if (typeof window === "undefined") return null
  if (!window.__focusmapAiHistoryMetrics) {
    window.__focusmapAiHistoryMetrics = {
      firstSeenById: {},
      events: [],
      lastUpdatedAt: null,
    }
  }
  return window.__focusmapAiHistoryMetrics
}

function recordAiHistoryFirstSeenMetrics(
  items: AiHistoryListResponse["items"],
  source: AiHistoryFirstSeenSource,
) {
  const metrics = focusmapAiHistoryMetrics()
  if (!metrics) return

  for (const item of items) {
    if (!item.id || item.archived || item.deletedAt) continue
    if (metrics.firstSeenById[item.id]) continue
    const firstSeenAt = new Date().toISOString()
    const metric: AiHistoryFirstSeenMetric = {
      historyItemId: item.id,
      status: item.status,
      firstSeenAt,
      firstSeenPerformanceMs: currentPerformanceMs(),
      source,
      placement: item.placement,
      repoPath: item.repoPath || null,
      worktreePath: item.worktreePath || null,
      externalThreadId: item.externalThreadId || null,
      indexedAt: item.indexedAt || null,
      lastActivityAt: item.lastActivityAt || null,
    }
    metrics.firstSeenById[item.id] = metric
    metrics.events.push(metric)
    if (metrics.events.length > AI_HISTORY_METRIC_EVENT_LIMIT) {
      metrics.events.splice(0, metrics.events.length - AI_HISTORY_METRIC_EVENT_LIMIT)
    }
    metrics.lastUpdatedAt = firstSeenAt
  }
}

function visibleMetricItems(
  items: AiHistoryListResponse["items"],
  repo: AiHistoryRepoFilter,
  placement: AiHistoryPlacement,
) {
  return items.filter(item => (
    !item.archived &&
    !item.deletedAt &&
    item.placement === placement &&
    aiHistoryRepoMatchesFilter(item, repo)
  ))
}

function mergeAiHistorySnapshotItems(
  currentItems: AiHistoryListResponse["items"],
  snapshotItems: AiHistorySnapshotResponse["items"],
) {
  const byId = new Map(currentItems.map(item => [item.id, item]))
  const idByExternalIdentity = new Map<string, string>()

  for (const item of currentItems) {
    if (!item.externalThreadId) continue
    idByExternalIdentity.set(aiHistoryExternalIdentity(item), item.id)
  }

  for (const item of snapshotItems) {
    const externalIdentity = item.externalThreadId ? aiHistoryExternalIdentity(item) : null
    const existingId = byId.has(item.id)
      ? item.id
      : externalIdentity
        ? idByExternalIdentity.get(externalIdentity) ?? item.id
        : item.id

    if (item.deletedAt || item.archived) {
      byId.delete(existingId)
      if (existingId !== item.id) byId.delete(item.id)
      continue
    }

    const current = byId.get(existingId)
    const merged = current ? { ...current, ...item } : item
    if (existingId !== item.id) byId.delete(existingId)
    byId.set(item.id, merged)
    if (externalIdentity) idByExternalIdentity.set(externalIdentity, item.id)
  }

  return Array.from(byId.values())
}

function snapshotMatchesCurrentQuery(input: {
  snapshot: AiHistorySnapshotResponse
  projectId: string
  repo: AiHistoryRepoFilter
  scope: AiHistoryScopeFilter
  provider: AiHistoryProvider
}) {
  return input.snapshot.filter.projectId === input.projectId &&
    sameRepoFilter(input.snapshot.filter.repo, input.repo) &&
    input.snapshot.filter.scope === input.scope &&
    input.snapshot.filter.provider === input.provider
}

type UseAiHistoryOptions = {
  projectId: string | null
  repo: AiHistoryRepoFilter
  scope?: AiHistoryScopeFilter
  provider?: AiHistoryProvider
  placement: AiHistoryPlacement
  enabled?: boolean
  limit?: number
  pollIntervalMs?: number
}

export function useAiHistory({
  projectId,
  repo,
  scope = "project",
  provider = "codex_app",
  placement,
  enabled = true,
  limit = DEFAULT_LIMIT,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseAiHistoryOptions) {
  const [data, setData] = useState<AiHistoryListResponse>(EMPTY_RESPONSE)
  const [isLoading, setIsLoading] = useState(Boolean(enabled && projectId))
  const [error, setError] = useState<string | null>(null)
  const fullListInFlightRef = useRef<AbortController | null>(null)
  const snapshotInFlightRef = useRef<AbortController | null>(null)
  const snapshotCursorRef = useRef<string | null>(null)

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!enabled || !projectId) {
      fullListInFlightRef.current?.abort()
      snapshotInFlightRef.current?.abort()
      fullListInFlightRef.current = null
      snapshotInFlightRef.current = null
      snapshotCursorRef.current = null
      setData(EMPTY_RESPONSE)
      setIsLoading(false)
      setError(null)
      return
    }

    fullListInFlightRef.current?.abort()
    snapshotInFlightRef.current?.abort()
    snapshotInFlightRef.current = null
    const controller = new AbortController()
    fullListInFlightRef.current = controller

    if (!options.silent) setIsLoading(true)
    try {
      const params = new URLSearchParams({
        project_id: projectId,
        repo,
        scope,
        provider,
        placement,
        status: "all",
        limit: String(limit),
      })
      const response = await fetchWithSupabaseAuth(`/api/ai-history?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`AI history fetch failed (${response.status})`)
      }
      const nextData = await response.json() as AiHistoryListResponse
      snapshotCursorRef.current = null
      recordAiHistoryFirstSeenMetrics(
        visibleMetricItems(nextData.items, repo, placement),
        "full_list",
      )
      setData(nextData)
      setError(null)
    } catch (fetchError) {
      if (controller.signal.aborted) return
      setError(fetchError instanceof Error ? fetchError.message : "AI履歴を取得できませんでした")
    } finally {
      if (fullListInFlightRef.current === controller) fullListInFlightRef.current = null
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [enabled, limit, placement, projectId, provider, repo, scope])

  const refreshSnapshot = useCallback(async () => {
    if (!enabled || !projectId || fullListInFlightRef.current || snapshotInFlightRef.current) return
    if (!isPageVisible()) return

    const controller = new AbortController()
    snapshotInFlightRef.current = controller
    try {
      const params = new URLSearchParams({
        project_id: projectId,
        repo,
        scope,
        provider,
        limit: String(SNAPSHOT_LIMIT),
        include_deleted: "true",
      })
      const cursor = snapshotCursorRef.current
      if (cursor) params.set("cursor", cursor)

      const response = await fetchWithSupabaseAuth(`/api/ai-history/snapshot?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      if (!response.ok) return

      const snapshot = await response.json() as AiHistorySnapshotResponse
      if (controller.signal.aborted) return
      if (!snapshotMatchesCurrentQuery({ snapshot, projectId, repo, scope, provider })) return

      snapshotCursorRef.current = snapshot.cursor
      if (snapshot.items.length === 0) return

      setData(previous => {
        const items = mergeAiHistorySnapshotItems(previous.items, snapshot.items)
        recordAiHistoryFirstSeenMetrics(
          visibleMetricItems(items, repo, placement),
          "snapshot_merge",
        )
        return {
          ...previous,
          items,
        }
      })
    } catch {
      if (controller.signal.aborted) return
    } finally {
      if (snapshotInFlightRef.current === controller) snapshotInFlightRef.current = null
    }
  }, [enabled, placement, projectId, provider, repo, scope])

  useEffect(() => {
    snapshotCursorRef.current = null
    void refresh()
    return () => {
      fullListInFlightRef.current?.abort()
      snapshotInFlightRef.current?.abort()
      fullListInFlightRef.current = null
      snapshotInFlightRef.current = null
    }
  }, [refresh])

  useEffect(() => {
    if (!enabled || !projectId || pollIntervalMs <= 0) return
    const intervalId = window.setInterval(() => {
      void refreshSnapshot()
    }, pollIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [enabled, pollIntervalMs, projectId, refreshSnapshot])

  const responseMatchesCurrentQuery = sameRepoFilter(data.sync.selectedRepo, repo) &&
    data.sync.selectedScope === scope &&
    data.sync.selectedProvider === provider

  const repoScopedItems = useMemo(() => {
    if (!responseMatchesCurrentQuery) return []
    return data.items.filter(item => !item.archived && aiHistoryRepoMatchesFilter(item, repo))
  }, [data.items, repo, responseMatchesCurrentQuery])

  const responseHasRepoLeak = useMemo(() => (
    responseMatchesCurrentQuery &&
    repo !== "all" &&
    data.items.some(item => !item.archived && !aiHistoryRepoMatchesFilter(item, repo))
  ), [data.items, repo, responseMatchesCurrentQuery])

  const visibleItems = useMemo(() => (
    repoScopedItems.filter(item => item.placement === placement)
  ), [placement, repoScopedItems])

  const visibleCounts = useMemo(() => {
    if (!responseMatchesCurrentQuery) return { unplaced: 0, mindmap: 0 }
    if (!responseHasRepoLeak) return data.counts
    return {
      unplaced: repoScopedItems.filter(item => item.placement === "unplaced").length,
      mindmap: repoScopedItems.filter(item => item.placement === "mindmap").length,
    }
  }, [data.counts, repoScopedItems, responseHasRepoLeak, responseMatchesCurrentQuery])

  return {
    items: visibleItems,
    counts: visibleCounts,
    sync: data.sync,
    page: data.page,
    nextCursor: data.nextCursor,
    isLoading: isLoading || (!error && enabled && Boolean(projectId) && !responseMatchesCurrentQuery),
    error,
    refresh,
  }
}
