'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AiTask } from '@/types/ai-task'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import { getCodexTaskUiState } from '@/lib/codex-run-state'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']
const ACTIVE_CODEX_REFRESH_INTERVAL_MS = 3_000
const PROMPT_WAITING_FAST_SYNC_WINDOW_MS = 3 * 60_000
const IDLE_REFRESH_INTERVAL_MS = 60 * 60_000

function isCodexTask(task: AiTask) {
  return task.executor === 'codex' || task.executor === 'codex_app'
}

function codexRunState(task: AiTask) {
  const state = task.result?.codex_run_state
  return typeof state === 'string' ? state : null
}

function parseTaskTime(value: string | null | undefined) {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function taskStartMs(task: AiTask) {
  return parseTaskTime(task.started_at) || parseTaskTime(task.created_at)
}

function isRecentPromptWaitingCodexTask(task: AiTask, now = Date.now()) {
  if (getCodexTaskUiState(task)?.state !== 'prompt_waiting') return false
  const startedMs = taskStartMs(task)
  return startedMs > 0 && now - startedMs < PROMPT_WAITING_FAST_SYNC_WINDOW_MS
}

function isActiveCodexTask(task: AiTask, now = Date.now()) {
  if (!isCodexTask(task)) return false
  if (task.status === 'completed' || task.status === 'failed') return false
  const rawState = codexRunState(task)
  if (rawState === 'running' || rawState === 'awaiting_approval') return true
  const uiState = getCodexTaskUiState(task)?.state
  if (uiState === 'prompt_waiting') return isRecentPromptWaitingCodexTask(task, now)
  if (uiState === 'running' || uiState === 'awaiting_approval') return true
  return ACTIVE_STATUSES.includes(task.status) ||
    rawState === 'running' ||
    rawState === 'awaiting_approval'
}

function hasActiveCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (isActiveCodexTask(task)) return true
  }
  return false
}

function activeCodexTaskRefreshKey(tasks: Map<string, AiTask>) {
  const keys: string[] = []
  for (const task of tasks.values()) {
    if (!isActiveCodexTask(task)) continue
    keys.push(`${task.id}:${task.status}:${codexRunState(task) ?? 'active'}`)
  }
  return keys.length > 0 ? keys.sort().join('|') : null
}

function nextPromptWaitingExpiryMs(tasks: Map<string, AiTask>, now = Date.now()) {
  let next: number | null = null
  for (const task of tasks.values()) {
    if (getCodexTaskUiState(task)?.state !== 'prompt_waiting') continue
    const startedMs = taskStartMs(task)
    if (startedMs <= 0) continue
    const expiryMs = startedMs + PROMPT_WAITING_FAST_SYNC_WINDOW_MS
    if (expiryMs <= now) continue
    next = next === null ? expiryMs : Math.min(next, expiryMs)
  }
  return next
}

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/**
 * メモ行から起動された ai_tasks を取得する。
 * 各メモごとに「最新の1件」だけを返す（status バッジ・QR表示・重複防止判定用）。
 */
export function useNoteAiTasks() {
  // Map<noteId, AiTask>
  const [byNoteId, setByNoteId] = useState<Map<string, AiTask>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const activeRefreshKeyRef = useRef<string | null>(null)

  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseAuth('/api/ai-tasks?source=note&limit=200')
      if (!res.ok) return
      const data = await res.json() as AiTask[]

      const map = new Map<string, AiTask>()
      for (const task of (data ?? []) as AiTask[]) {
        if (!task.source_note_id) continue
        if (!map.has(task.source_note_id)) {
          map.set(task.source_note_id, task)
        }
      }
      setByNoteId(map)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  const activeRefreshKey = useMemo(() => activeCodexTaskRefreshKey(byNoteId), [byNoteId])
  const promptWaitingExpiryMs = useMemo(() => nextPromptWaitingExpiryMs(byNoteId), [byNoteId])
  const refreshIntervalMs = hasActiveCodexTask(byNoteId)
    ? ACTIVE_CODEX_REFRESH_INTERVAL_MS
    : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void fetchInitial()
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
    if (isPageVisible()) void fetchInitial()
  }, [activeRefreshKey, fetchInitial])

  useEffect(() => {
    if (!promptWaitingExpiryMs) return
    const delay = Math.max(0, promptWaitingExpiryMs - Date.now() + 50)
    const timeoutId = window.setTimeout(() => {
      if (isPageVisible()) void fetchInitial()
    }, delay)
    return () => window.clearTimeout(timeoutId)
  }, [fetchInitial, promptWaitingExpiryMs])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isPageVisible()) void fetchInitial()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchInitial])

  const getByNoteId = useCallback((noteId: string) => byNoteId.get(noteId) ?? null, [byNoteId])

  const isActive = useCallback((noteId: string) => {
    const task = byNoteId.get(noteId)
    return !!task && ACTIVE_STATUSES.includes(task.status)
  }, [byNoteId])

  return {
    byNoteId,
    isLoading,
    getByNoteId,
    isActive,
    refresh: fetchInitial,
  }
}
