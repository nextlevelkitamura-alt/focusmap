'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { AiTask } from '@/types/ai-task'
import { canUseLocalCodexOpenApi } from '@/lib/codex-app-launch'
import { getCodexTaskUiState } from '@/lib/codex-run-state'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']
const RUNNING_CODEX_REFRESH_INTERVAL_MS = 3_000
const REVIEW_CODEX_REFRESH_INTERVAL_MS = 3_000
const RECENT_PROMPT_WAITING_REFRESH_INTERVAL_MS = 5_000
const PROMPT_WAITING_FAST_SYNC_WINDOW_MS = 3 * 60_000
const IDLE_REFRESH_INTERVAL_MS = 60 * 60_000
const LINKED_TASK_LIMIT = 300
const LOCAL_CODEX_SYNC_TARGET_LIMIT = 40
const lastLocalSyncByTaskId = new Map<string, number>()

type UseMemoAiTasksOptions = {
  sourceTaskIds?: string[]
}

function isCodexTask(task: AiTask) {
  return task.executor === 'codex' || task.executor === 'codex_app'
}

function isRunningCodexTask(task: AiTask) {
  if (!isCodexTask(task)) return false
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'awaiting_approval' || task.status === 'needs_input') return false
  return getCodexTaskUiState(task)?.state === 'running'
}

function hasRunningCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (isRunningCodexTask(task)) return true
  }
  return false
}

function isReviewCodexTask(task: AiTask) {
  if (!isCodexTask(task)) return false
  if (task.status === 'completed' || task.status === 'failed') return false
  return getCodexTaskUiState(task)?.state === 'awaiting_approval'
}

function hasReviewCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (isReviewCodexTask(task)) return true
  }
  return false
}

function isPromptWaitingCodexTask(task: AiTask) {
  if (!isCodexTask(task)) return false
  return getCodexTaskUiState(task)?.state === 'prompt_waiting'
}

function promptWaitingStartedMs(task: AiTask) {
  return parseTaskTime(task.started_at) || parseTaskTime(task.created_at)
}

function isRecentPromptWaitingCodexTask(task: AiTask, now = Date.now()) {
  if (!isPromptWaitingCodexTask(task)) return false
  const startedMs = promptWaitingStartedMs(task)
  return startedMs > 0 && now - startedMs < PROMPT_WAITING_FAST_SYNC_WINDOW_MS
}

function hasRecentPromptWaitingCodexTask(tasks: Map<string, AiTask>, now = Date.now()) {
  for (const task of tasks.values()) {
    if (isRecentPromptWaitingCodexTask(task, now)) return true
  }
  return false
}

function nextPromptWaitingExpiryMs(tasks: Map<string, AiTask>, now = Date.now()) {
  let next: number | null = null
  for (const task of tasks.values()) {
    if (!isPromptWaitingCodexTask(task)) continue
    const startedMs = promptWaitingStartedMs(task)
    const expiresAt = startedMs + PROMPT_WAITING_FAST_SYNC_WINDOW_MS
    if (startedMs > 0 && expiresAt > now && (next == null || expiresAt < next)) {
      next = expiresAt
    }
  }
  return next
}

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function codexTasksForLocalSync(tasks: Map<string, AiTask>) {
  const result: Array<{ sourceId: string; task: AiTask }> = []
  for (const [sourceId, task] of tasks.entries()) {
    if (!isCodexTask(task)) continue
    if (task.status === 'completed' || task.status === 'failed') continue
    result.push({ sourceId, task })
  }
  return result.slice(0, LOCAL_CODEX_SYNC_TARGET_LIMIT)
}

function localSyncIntervalForTask(task: AiTask) {
  if (isRunningCodexTask(task)) return RUNNING_CODEX_REFRESH_INTERVAL_MS
  if (isReviewCodexTask(task)) return REVIEW_CODEX_REFRESH_INTERVAL_MS
  if (isRecentPromptWaitingCodexTask(task)) return RECENT_PROMPT_WAITING_REFRESH_INTERVAL_MS
  return IDLE_REFRESH_INTERVAL_MS
}

function sourceKeyForTask(task: AiTask) {
  return task.source_task_id ?? task.source_ideal_goal_id ?? task.source_note_id
}

function mergeAiTask(previous: AiTask | undefined, incoming: AiTask): AiTask {
  if (!previous) return incoming
  return {
    ...previous,
    ...incoming,
    prompt: incoming.prompt ?? previous.prompt,
    result: {
      ...(previous.result ?? {}),
      ...(incoming.result ?? {}),
    },
  }
}

function parseTaskTime(value: string | null | undefined) {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function shouldReplaceSourceTask(previous: AiTask | undefined, incoming: AiTask) {
  if (!previous) return true
  if (previous.id === incoming.id) return true
  return parseTaskTime(incoming.created_at) >= parseTaskTime(previous.created_at)
}

/**
 * メモ（notes / ideal_goals）またはマインドマップタスクから起動された ai_tasks を取得する。
 * 各 source ごとに「最新の1件」だけを返す（status バッジ・Codex状態表示・重複防止判定用）。
 */
export function useMemoAiTasks({ sourceTaskIds = [] }: UseMemoAiTasksOptions = {}) {
  // Map<sourceId, AiTask> — sourceId は source_task_id / source_note_id / source_ideal_goal_id
  const [bySourceId, setBySourceId] = useState<Map<string, AiTask>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const sourceTaskIdsKey = useMemo(() => (
    Array.from(new Set(sourceTaskIds.filter(Boolean))).sort().join(',')
  ), [sourceTaskIds])

  const fetchInitial = useCallback(async (options: { statusOnly?: boolean } = {}) => {
    try {
      const params = new URLSearchParams({
        source: 'linked',
        limit: String(LINKED_TASK_LIMIT),
      })
      if (sourceTaskIdsKey) params.set('source_task_ids', sourceTaskIdsKey)
      if (options.statusOnly) params.set('view', 'status')
      const res = await fetchWithSupabaseAuth(`/api/ai-tasks?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json() as AiTask[]

      setBySourceId(previous => {
        const map = options.statusOnly ? new Map(previous) : new Map<string, AiTask>()
        for (const task of (data ?? []) as AiTask[]) {
          const key = sourceKeyForTask(task)
          if (!key) continue
          if (options.statusOnly) {
            const previous = map.get(key)
            if (shouldReplaceSourceTask(previous, task)) {
              map.set(key, previous?.id === task.id ? mergeAiTask(previous, task) : task)
            }
          } else if (!map.has(key)) {
            map.set(key, task)
          }
        }
        return map
      })
    } finally {
      setIsLoading(false)
    }
  }, [sourceTaskIdsKey])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  const promptWaitingExpiryMs = useMemo(() => nextPromptWaitingExpiryMs(bySourceId), [bySourceId])
  const refreshIntervalMs = hasRunningCodexTask(bySourceId)
    ? RUNNING_CODEX_REFRESH_INTERVAL_MS
    : hasReviewCodexTask(bySourceId)
      ? REVIEW_CODEX_REFRESH_INTERVAL_MS
      : hasRecentPromptWaitingCodexTask(bySourceId)
        ? RECENT_PROMPT_WAITING_REFRESH_INTERVAL_MS
        : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void fetchInitial({ statusOnly: true })
    }, refreshIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [fetchInitial, refreshIntervalMs])

  useEffect(() => {
    if (!promptWaitingExpiryMs) return
    const delay = Math.max(0, promptWaitingExpiryMs - Date.now() + 50)
    const timeoutId = window.setTimeout(() => {
      if (isPageVisible()) void fetchInitial({ statusOnly: true })
    }, delay)
    return () => window.clearTimeout(timeoutId)
  }, [fetchInitial, promptWaitingExpiryMs])

  const localSyncTargets = useMemo(() => codexTasksForLocalSync(bySourceId), [bySourceId])
  const localSyncTargetKey = useMemo(() => {
    return localSyncTargets
      .map(({ sourceId, task }) => `${sourceId}:${task.id}:${task.status}:${getCodexTaskUiState(task)?.state ?? 'idle'}`)
      .join('|')
  }, [localSyncTargets])
  const hasRunningLocalSyncTarget = useMemo(() => (
    localSyncTargets.some(({ task }) => isRunningCodexTask(task))
  ), [localSyncTargets])
  const hasReviewLocalSyncTarget = useMemo(() => (
    localSyncTargets.some(({ task }) => isReviewCodexTask(task))
  ), [localSyncTargets])

  useEffect(() => {
    if (!canUseLocalCodexOpenApi()) return
    const targets = localSyncTargets
    if (targets.length === 0) {
      return
    }
    const localSyncIntervalMs = hasRunningCodexTask(bySourceId)
      ? RUNNING_CODEX_REFRESH_INTERVAL_MS
      : hasReviewCodexTask(bySourceId)
        ? REVIEW_CODEX_REFRESH_INTERVAL_MS
        : hasRecentPromptWaitingCodexTask(bySourceId)
          ? RECENT_PROMPT_WAITING_REFRESH_INTERVAL_MS
          : IDLE_REFRESH_INTERVAL_MS

    let cancelled = false
    let syncing = false
    const syncTargets = async () => {
      if (syncing) return
      if (!isPageVisible()) return
      const now = Date.now()
      const dueTargets = targets.filter(({ task }) => {
        const lastSyncedAt = lastLocalSyncByTaskId.get(task.id) ?? 0
        return now - lastSyncedAt >= localSyncIntervalForTask(task)
      })
      if (dueTargets.length === 0) return
      for (const { task } of dueTargets) {
        lastLocalSyncByTaskId.set(task.id, now)
      }
      syncing = true
      try {
        await Promise.all(dueTargets.map(({ sourceId, task }) => (
          fetchWithSupabaseAuth('/api/codex/sync-node', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_task_id: sourceId,
              ai_task_id: task.id,
            }),
          }).catch(() => undefined)
        )))
        if (!cancelled) await fetchInitial({ statusOnly: true })
      } finally {
        syncing = false
      }
    }

    if (
      hasRunningLocalSyncTarget ||
      hasReviewLocalSyncTarget ||
      localSyncTargets.some(({ task }) => isRecentPromptWaitingCodexTask(task))
    ) void syncTargets()
    const intervalId = window.setInterval(() => void syncTargets(), localSyncIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [bySourceId, fetchInitial, hasReviewLocalSyncTarget, hasRunningLocalSyncTarget, localSyncTargetKey, localSyncTargets])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isPageVisible()) void fetchInitial({ statusOnly: true })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchInitial])

  const getBySourceId = useCallback((sourceId: string) => bySourceId.get(sourceId) ?? null, [bySourceId])

  const isActive = useCallback((sourceId: string) => {
    const task = bySourceId.get(sourceId)
    return !!task && ACTIVE_STATUSES.includes(task.status)
  }, [bySourceId])

  const refreshStatus = useCallback(() => fetchInitial({ statusOnly: true }), [fetchInitial])

  return {
    bySourceId,
    isLoading,
    getBySourceId,
    isActive,
    refresh: fetchInitial,
    refreshStatus,
  }
}
