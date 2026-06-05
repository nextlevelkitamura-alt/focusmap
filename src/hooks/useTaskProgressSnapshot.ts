'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import type { TaskProgressSnapshotResponse, TaskProgressSnapshotTask } from '@/types/task-progress'

const RUNNING_POLL_INTERVAL_MS = 5_000
const DETAIL_POLL_INTERVAL_MS = 3_000
const IDLE_POLL_INTERVAL_MS = 45_000
const ACTIVITY_HINT_POLL_INTERVAL_MS = 5_000
const ACTIVITY_HINT_WARM_MS = 90_000
const SNAPSHOT_LIMIT = 500

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function isRunningTask(task: TaskProgressSnapshotTask) {
  return task.status === 'running'
}

function mergeTaskMap(
  previous: Map<string, TaskProgressSnapshotTask>,
  incoming: TaskProgressSnapshotTask[],
) {
  if (incoming.length === 0) return previous
  const next = new Map(previous)
  for (const task of incoming) {
    if (!task?.id) continue
    next.set(task.id, task)
  }
  return next
}

type UseTaskProgressSnapshotOptions = {
  enabled?: boolean
  detailOpen?: boolean
  activityHintKey?: string | null
  fixtureTasks?: TaskProgressSnapshotTask[]
}

export function useTaskProgressSnapshot({
  enabled = true,
  detailOpen = false,
  activityHintKey = null,
  fixtureTasks,
}: UseTaskProgressSnapshotOptions = {}) {
  const [tasksById, setTasksById] = useState<Map<string, TaskProgressSnapshotTask>>(() => new Map())
  const [cursor, setCursor] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [serverTime, setServerTime] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [hasRecentActivityHint, setHasRecentActivityHint] = useState(false)
  const cursorRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  useEffect(() => {
    if (!fixtureTasks) return
    setTasksById(new Map(fixtureTasks.map(task => [task.id, task])))
    setSource('fixture')
    setServerTime(new Date().toISOString())
    setCursor(new Date().toISOString())
    setError(null)
    setIsLoading(false)
  }, [fixtureTasks])

  const refresh = useCallback(async (options: { reset?: boolean } = {}) => {
    if (!enabled || fixtureTasks) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    const nextCursor = options.reset ? null : cursorRef.current
    try {
      setError(null)
      const params = new URLSearchParams({ limit: String(SNAPSHOT_LIMIT) })
      if (nextCursor) params.set('updated_after', nextCursor)
      const response = await fetchWithSupabaseAuth(`/api/task-progress/snapshot?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`snapshot fetch failed (${response.status})`)
      }
      const data = await response.json() as TaskProgressSnapshotResponse
      setTasksById(previous => options.reset
        ? new Map((data.tasks ?? []).map(task => [task.id, task]))
        : mergeTaskMap(previous, data.tasks ?? []),
      )
      const returnedCursor = data.cursor ?? nextCursor ?? data.server_time ?? null
      cursorRef.current = returnedCursor
      setCursor(returnedCursor)
      setSource(data.source ?? null)
      setServerTime(data.server_time ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'snapshot fetch failed')
    } finally {
      setIsLoading(false)
      inFlightRef.current = false
    }
  }, [enabled, fixtureTasks])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    void refresh({ reset: true })
  }, [enabled, fixtureTasks, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks || !activityHintKey) return
    setHasRecentActivityHint(true)
    void refresh()
    const timeoutId = window.setTimeout(() => {
      setHasRecentActivityHint(false)
    }, ACTIVITY_HINT_WARM_MS)
    return () => window.clearTimeout(timeoutId)
  }, [activityHintKey, enabled, fixtureTasks, refresh])

  const tasks = useMemo(() => Array.from(tasksById.values()), [tasksById])
  const hasRunning = useMemo(() => tasks.some(isRunningTask), [tasks])
  const pollIntervalMs = detailOpen
    ? DETAIL_POLL_INTERVAL_MS
    : hasRunning
      ? RUNNING_POLL_INTERVAL_MS
      : hasRecentActivityHint
        ? ACTIVITY_HINT_POLL_INTERVAL_MS
      : IDLE_POLL_INTERVAL_MS

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void refresh()
    }, pollIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [enabled, fixtureTasks, pollIntervalMs, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    const handleVisibilityChange = () => {
      if (isPageVisible()) void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [enabled, fixtureTasks, refresh])

  const getById = useCallback((taskId: string | null | undefined) => {
    if (!taskId) return null
    return tasksById.get(taskId) ?? null
  }, [tasksById])

  return {
    tasks,
    tasksById,
    cursor,
    source,
    serverTime,
    isLoading,
    error,
    hasRunning,
    pollIntervalMs,
    refresh,
    getById,
  }
}
