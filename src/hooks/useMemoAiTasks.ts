'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AiTask } from '@/types/ai-task'
import { getCodexTaskUiState } from '@/lib/codex-run-state'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']
const ACTIVE_CODEX_REFRESH_INTERVAL_MS = 3_000
const PROMPT_WAITING_FAST_SYNC_WINDOW_MS = 3 * 60_000
const IDLE_REFRESH_INTERVAL_MS = 60 * 60_000
const LINKED_TASK_LIMIT = 300

type UseMemoAiTasksOptions = {
  sourceTaskIds?: string[]
}

function isCodexTask(task: AiTask) {
  return task.executor === 'codex' || task.executor === 'codex_app'
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

function isActiveCodexTaskForFastRefresh(task: AiTask, now = Date.now()) {
  if (!isCodexTask(task)) return false
  if (task.status === 'completed' || task.status === 'failed') return false
  const uiState = getCodexTaskUiState(task)?.state
  if (uiState === 'prompt_waiting') {
    return isRecentPromptWaitingCodexTask(task, now)
  }
  return ACTIVE_STATUSES.includes(task.status)
}

function hasActiveCodexTaskForFastRefresh(tasks: Map<string, AiTask>, now = Date.now()) {
  for (const task of tasks.values()) {
    if (isActiveCodexTaskForFastRefresh(task, now)) return true
  }
  return false
}

function activeCodexTaskRefreshKey(tasks: Map<string, AiTask>, now = Date.now()) {
  const keys: string[] = []
  for (const task of tasks.values()) {
    if (!isActiveCodexTaskForFastRefresh(task, now)) continue
    keys.push(`${task.id}:${task.status}:${getCodexTaskUiState(task)?.state ?? 'active'}`)
  }
  return keys.length > 0 ? keys.sort().join('|') : null
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
  const activeRefreshKeyRef = useRef<string | null>(null)
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
  const activeRefreshKey = useMemo(() => activeCodexTaskRefreshKey(bySourceId), [bySourceId])
  const refreshIntervalMs = hasActiveCodexTaskForFastRefresh(bySourceId)
    ? ACTIVE_CODEX_REFRESH_INTERVAL_MS
    : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void fetchInitial({ statusOnly: true })
    }, refreshIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [fetchInitial, refreshIntervalMs])

  useEffect(() => {
    if (!activeRefreshKey) {
      activeRefreshKeyRef.current = null
      return
    }
    if (activeRefreshKeyRef.current === activeRefreshKey) return
    activeRefreshKeyRef.current = activeRefreshKey
    if (isPageVisible()) void fetchInitial({ statusOnly: true })
  }, [activeRefreshKey, fetchInitial])

  useEffect(() => {
    if (!promptWaitingExpiryMs) return
    const delay = Math.max(0, promptWaitingExpiryMs - Date.now() + 50)
    const timeoutId = window.setTimeout(() => {
      if (isPageVisible()) void fetchInitial({ statusOnly: true })
    }, delay)
    return () => window.clearTimeout(timeoutId)
  }, [fetchInitial, promptWaitingExpiryMs])

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
