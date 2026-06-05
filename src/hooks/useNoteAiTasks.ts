'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AiTask } from '@/types/ai-task'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']
const RUNNING_CODEX_REFRESH_INTERVAL_MS = 5_000
const PENDING_CODEX_REFRESH_INTERVAL_MS = 30_000
const IDLE_REFRESH_INTERVAL_MS = 60 * 60_000

function isCodexTask(task: AiTask) {
  return task.executor === 'codex' || task.executor === 'codex_app'
}

function hasRunningCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (
      isCodexTask(task) &&
      (task.status === 'running' || task.result?.codex_run_state === 'running')
    ) {
      return true
    }
  }
  return false
}

function hasPendingCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (isCodexTask(task) && task.status === 'pending') return true
  }
  return false
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

  const refreshIntervalMs = hasRunningCodexTask(byNoteId)
    ? RUNNING_CODEX_REFRESH_INTERVAL_MS
    : hasPendingCodexTask(byNoteId)
      ? PENDING_CODEX_REFRESH_INTERVAL_MS
    : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void fetchInitial()
    }, refreshIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [fetchInitial, refreshIntervalMs])

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
