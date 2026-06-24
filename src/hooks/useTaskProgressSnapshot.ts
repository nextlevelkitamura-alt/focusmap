'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import type { TaskProgressSnapshotResponse, TaskProgressSnapshotTask } from '@/types/task-progress'

const ACTIVE_POLL_INTERVAL_MS = 3_000
const DETAIL_POLL_INTERVAL_MS = 3_000
const IDLE_POLL_INTERVAL_MS = 45_000
const FULL_RECONCILE_INTERVAL_MS = 10 * 60_000
const VISIBLE_FULL_RECONCILE_THROTTLE_MS = 30_000
const SNAPSHOT_LIMIT = 500

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function isRunningTask(task: TaskProgressSnapshotTask) {
  return task.status === 'running'
}

function isActiveTask(task: TaskProgressSnapshotTask) {
  return task.status === 'pending' ||
    task.status === 'running' ||
    task.status === 'awaiting_approval' ||
    task.status === 'needs_input'
}

function activeTaskRefreshKey(tasks: TaskProgressSnapshotTask[]) {
  const keys = tasks
    .filter(isActiveTask)
    .map(task => `${task.id}:${task.status}`)
    .sort()
  return keys.length > 0 ? keys.join('|') : null
}

function taskFingerprint(task: TaskProgressSnapshotTask) {
  return [
    task.id,
    task.status,
    task.executor ?? '',
    task.codex_thread_id ?? '',
    task.current_step ?? '',
    task.progress_percent ?? '',
    task.summary ?? '',
    task.updated_at,
    task.source_type ?? '',
    task.source_id ?? '',
  ].join('\u001f')
}

function mergeTaskMap(
  previous: Map<string, TaskProgressSnapshotTask>,
  incoming: TaskProgressSnapshotTask[],
) {
  if (incoming.length === 0) return { map: previous, changed: false }
  const next = new Map(previous)
  let changed = false
  for (const task of incoming) {
    if (!task?.id) continue
    const previousTask = next.get(task.id)
    if (!previousTask || taskFingerprint(previousTask) !== taskFingerprint(task)) {
      changed = true
    }
    next.set(task.id, task)
  }
  return { map: changed ? next : previous, changed }
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
  const cursorRef = useRef<string | null>(null)
  const tasksByIdRef = useRef<Map<string, TaskProgressSnapshotTask>>(new Map())
  const inFlightRef = useRef(false)
  const detailOpenRef = useRef(detailOpen)
  const activeTaskRefreshKeyRef = useRef<string | null>(null)
  const lastFullReconcileAtRef = useRef(0)
  const metadataRef = useRef<{ source: string | null; serverTime: string | null }>({
    source: null,
    serverTime: null,
  })

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  useEffect(() => {
    if (!fixtureTasks) return
    const nextTasksById = new Map(fixtureTasks.map(task => [task.id, task]))
    tasksByIdRef.current = nextTasksById
    setTasksById(nextTasksById)
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
      const incomingTasks = data.tasks ?? []
      const returnedCursor = data.cursor ?? nextCursor ?? data.server_time ?? null
      cursorRef.current = returnedCursor
      const nextSource = data.source ?? null
      const nextServerTime = data.server_time ?? null
      metadataRef.current = { source: nextSource, serverTime: nextServerTime }

      let didChange = false
      if (options.reset) {
        const nextTasksById = new Map(incomingTasks.map(task => [task.id, task]))
        tasksByIdRef.current = nextTasksById
        setTasksById(nextTasksById)
        didChange = true
      } else {
        const merged = mergeTaskMap(tasksByIdRef.current, incomingTasks)
        didChange = merged.changed
        if (didChange) {
          tasksByIdRef.current = merged.map
          setTasksById(merged.map)
        }
      }

      if (options.reset || didChange) {
        setCursor(returnedCursor)
        setSource(nextSource)
        setServerTime(nextServerTime)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'snapshot fetch failed')
    } finally {
      setIsLoading(false)
      inFlightRef.current = false
    }
  }, [enabled, fixtureTasks])

  const refreshFullIfVisible = useCallback((options: { force?: boolean } = {}) => {
    if (!enabled || fixtureTasks || !isPageVisible()) return
    const now = Date.now()
    if (!options.force && now - lastFullReconcileAtRef.current < VISIBLE_FULL_RECONCILE_THROTTLE_MS) return
    lastFullReconcileAtRef.current = now
    void refresh({ reset: true })
  }, [enabled, fixtureTasks, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    lastFullReconcileAtRef.current = Date.now()
    void refresh({ reset: true })
  }, [enabled, fixtureTasks, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks || !activityHintKey) return
    void refresh()
  }, [activityHintKey, enabled, fixtureTasks, refresh])

  const tasks = useMemo(() => Array.from(tasksById.values()), [tasksById])
  const hasRunning = useMemo(() => tasks.some(isRunningTask), [tasks])
  const hasActive = useMemo(() => tasks.some(isActiveTask), [tasks])
  const activeRefreshKey = useMemo(() => activeTaskRefreshKey(tasks), [tasks])
  const hasActiveHint = !!activityHintKey
  const pollIntervalMs = detailOpen
    ? DETAIL_POLL_INTERVAL_MS
    : hasRunning || hasActive || hasActiveHint
      ? ACTIVE_POLL_INTERVAL_MS
      : IDLE_POLL_INTERVAL_MS

  useEffect(() => {
    const wasDetailOpen = detailOpenRef.current
    detailOpenRef.current = detailOpen
    if (!enabled || fixtureTasks) return
    if (detailOpen && !wasDetailOpen && isPageVisible()) {
      void refresh()
    }
  }, [detailOpen, enabled, fixtureTasks, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    if (!activeRefreshKey) {
      activeTaskRefreshKeyRef.current = null
      return
    }
    if (activeTaskRefreshKeyRef.current === activeRefreshKey) return
    activeTaskRefreshKeyRef.current = activeRefreshKey
    if (isPageVisible()) void refresh()
  }, [activeRefreshKey, enabled, fixtureTasks, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void refresh()
    }, pollIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [enabled, fixtureTasks, pollIntervalMs, refresh])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    const intervalId = window.setInterval(() => {
      refreshFullIfVisible({ force: true })
    }, FULL_RECONCILE_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [enabled, fixtureTasks, refreshFullIfVisible])

  useEffect(() => {
    if (!enabled || fixtureTasks) return
    const handleVisibilityChange = () => {
      refreshFullIfVisible()
    }
    const handleVisibleResume = () => refreshFullIfVisible()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibleResume)
    window.addEventListener('pageshow', handleVisibleResume)
    window.addEventListener('focusmap:native-app-resume', handleVisibleResume)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibleResume)
      window.removeEventListener('pageshow', handleVisibleResume)
      window.removeEventListener('focusmap:native-app-resume', handleVisibleResume)
    }
  }, [enabled, fixtureTasks, refreshFullIfVisible])

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
    hasActive,
    pollIntervalMs,
    refresh,
    getById,
  }
}
