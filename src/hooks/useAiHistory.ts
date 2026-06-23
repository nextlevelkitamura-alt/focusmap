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
} from "@/types/ai-history"

const DEFAULT_LIMIT = 100
const DEFAULT_POLL_INTERVAL_MS = 3_000

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
  const inFlightRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!enabled || !projectId) {
      setData(EMPTY_RESPONSE)
      setIsLoading(false)
      setError(null)
      return
    }

    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller

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
      setData(nextData)
      setError(null)
    } catch (fetchError) {
      if (controller.signal.aborted) return
      setError(fetchError instanceof Error ? fetchError.message : "AI履歴を取得できませんでした")
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [enabled, limit, placement, projectId, provider, repo, scope])

  useEffect(() => {
    void refresh()
    return () => {
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
  }, [refresh])

  useEffect(() => {
    if (!enabled || !projectId || pollIntervalMs <= 0) return
    const intervalId = window.setInterval(() => {
      if (!isPageVisible()) return
      void refresh({ silent: true })
    }, pollIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [enabled, pollIntervalMs, projectId, refresh])

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
