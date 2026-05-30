'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { AiTask } from '@/types/ai-task'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']
const ACTIVE_CODEX_REFRESH_INTERVAL_MS = 5_000
const IDLE_REFRESH_INTERVAL_MS = 15_000

function hasActiveCodexTask(tasks: Map<string, AiTask>) {
  for (const task of tasks.values()) {
    if (
      (task.executor === 'codex' || task.executor === 'codex_app') &&
      ACTIVE_STATUSES.includes(task.status)
    ) {
      return true
    }
  }
  return false
}

/**
 * メモ（notes / ideal_goals）またはマインドマップタスクから起動された ai_tasks を取得する。
 * 各 source ごとに「最新の1件」だけを返す（status バッジ・Codex状態表示・重複防止判定用）。
 */
export function useMemoAiTasks() {
  // Map<sourceId, AiTask> — sourceId は source_task_id / source_note_id / source_ideal_goal_id
  const [bySourceId, setBySourceId] = useState<Map<string, AiTask>>(new Map())
  const [isLoading, setIsLoading] = useState(true)

  const fetchInitial = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('ai_tasks')
        .select('*')
        .or('source_note_id.not.is.null,source_ideal_goal_id.not.is.null,source_task_id.not.is.null')
        .order('created_at', { ascending: false })
        .limit(300)

      const map = new Map<string, AiTask>()
      for (const task of (data ?? []) as AiTask[]) {
        const key = task.source_task_id ?? task.source_ideal_goal_id ?? task.source_note_id
        if (!key) continue
        if (!map.has(key)) {
          map.set(key, task)
        }
      }
      setBySourceId(map)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  const refreshIntervalMs = hasActiveCodexTask(bySourceId)
    ? ACTIVE_CODEX_REFRESH_INTERVAL_MS
    : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(fetchInitial, refreshIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [fetchInitial, refreshIntervalMs])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('memo_ai_tasks_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_tasks' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const task = payload.new as AiTask
            const key = task.source_task_id ?? task.source_ideal_goal_id ?? task.source_note_id
            if (!key) return
            setBySourceId(prev => {
              const next = new Map(prev)
              const existing = next.get(key)
              if (!existing || new Date(task.created_at) >= new Date(existing.created_at)) {
                next.set(key, task)
              } else if (existing.id === task.id) {
                next.set(key, task)
              }
              return next
            })
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as Partial<AiTask>
            const key = deleted.source_task_id ?? deleted.source_ideal_goal_id ?? deleted.source_note_id
            if (!key) return
            setBySourceId(prev => {
              const existing = prev.get(key)
              if (existing && existing.id === deleted.id) {
                const next = new Map(prev)
                next.delete(key)
                return next
              }
              return prev
            })
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const getBySourceId = useCallback((sourceId: string) => bySourceId.get(sourceId) ?? null, [bySourceId])

  const isActive = useCallback((sourceId: string) => {
    const task = bySourceId.get(sourceId)
    return !!task && ACTIVE_STATUSES.includes(task.status)
  }, [bySourceId])

  return {
    bySourceId,
    isLoading,
    getBySourceId,
    isActive,
    refresh: fetchInitial,
  }
}
