'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AiTask } from '@/types/ai-task'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'

const RUNNING_CODEX_REFRESH_INTERVAL_MS = 3_000
const PENDING_CODEX_REFRESH_INTERVAL_MS = 30_000
const IDLE_REFRESH_INTERVAL_MS = 2 * 60_000

interface UseAiTasksOptions {
  /** 最大取得件数（デフォルト: 20） */
  limit?: number
  /** null/undefined means all visible spaces. */
  spaceId?: string | null
}

function isCodexTask(task: AiTask) {
  return task.executor === 'codex' || task.executor === 'codex_app'
}

function hasRunningCodexTask(tasks: AiTask[]) {
  return tasks.some(task =>
    isCodexTask(task) &&
    (task.status === 'running' || task.result?.codex_run_state === 'running')
  )
}

function hasPendingCodexTask(tasks: AiTask[]) {
  return tasks.some(task => isCodexTask(task) && task.status === 'pending')
}

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export function useAiTasks({ limit = 20, spaceId = null }: UseAiTasksOptions = {}) {
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // 初回読み込み
  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (spaceId) params.set('space_id', spaceId)
      const res = await fetchWithSupabaseAuth(`/api/ai-tasks?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch ai_tasks')
      const data: AiTask[] = await res.json()
      setTasks(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [limit, spaceId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const refreshIntervalMs = hasRunningCodexTask(tasks)
    ? RUNNING_CODEX_REFRESH_INTERVAL_MS
    : hasPendingCodexTask(tasks)
      ? PENDING_CODEX_REFRESH_INTERVAL_MS
    : IDLE_REFRESH_INTERVAL_MS

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void fetchTasks()
    }, refreshIntervalMs)
    return () => window.clearInterval(intervalId)
  }, [fetchTasks, refreshIntervalMs])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isPageVisible()) void fetchTasks()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchTasks])

  // 壁打ち送信
  const sendPrompt = useCallback(async (prompt: string, options?: {
    skill_id?: string
    approval_type?: string
    parent_task_id?: string
    space_id?: string | null
  }) => {
    const res = await fetchWithSupabaseAuth('/api/ai-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Failed to create ai_task')
    }
    return (await res.json()) as AiTask
  }, [])

  // 承認（completed にする）
  const approve = useCallback(async (taskId: string) => {
    const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    if (!res.ok) throw new Error('Failed to approve')
    return (await res.json()) as AiTask
  }, [])

  // 却下（failed にする）
  const reject = useCallback(async (taskId: string, reason?: string) => {
    const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', error: reason || 'ユーザーにより却下' }),
    })
    if (!res.ok) throw new Error('Failed to reject')
    return (await res.json()) as AiTask
  }, [])

  // 修正指示（親タスクに紐づく新タスクを作成）
  const requestRevision = useCallback(async (parentTaskId: string, instruction: string) => {
    return sendPrompt(instruction, { parent_task_id: parentTaskId })
  }, [sendPrompt])

  // 楽観的にタスクを追加（Realtime到着前にUIへ即反映）
  const addTaskOptimistic = useCallback((task: AiTask) => {
    setTasks(prev => {
      if (prev.some(t => t.id === task.id)) return prev
      return [task, ...prev].slice(0, limit)
    })
  }, [limit])

  // 完了トグル
  // 単発タスク（recurrence_cron なし）: status を completed ↔ pending
  // 繰り返しタスク（recurrence_cron あり）: completed_at を「今日」⇔ null でトグル
  //   status は常に pending のまま（task-runner が毎日再実行するため）
  const toggleComplete = useCallback(async (task: AiTask) => {
    const taskId = task.id
    const isRecurring = !!task.recurrence_cron

    if (isRecurring) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const isDoneToday = !!(task.completed_at && new Date(task.completed_at) >= todayStart)
      const newCompletedAt = isDoneToday ? null : new Date().toISOString()
      const prevCompletedAt = task.completed_at

      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed_at: newCompletedAt } : t))
      const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed_at: newCompletedAt }),
      })
      if (!res.ok) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed_at: prevCompletedAt } : t))
        throw new Error('Failed to toggle ai task')
      }
      const updated = await res.json() as AiTask
      setTasks(prev => prev.map(t => t.id === taskId ? updated : t))
      return
    }

    // 単発タスク: 従来通り status をトグル
    const currentStatus = task.status
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed'
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus as AiTask['status'] } : t))
    const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: currentStatus as AiTask['status'] } : t))
      throw new Error('Failed to toggle ai task')
    }
    const updated = await res.json() as AiTask
    setTasks(prev => prev.map(t => t.id === taskId ? updated : t))
  }, [])

  // 削除
  const deleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}`, { method: 'DELETE' })
    if (!res.ok) {
      await fetchTasks()
      throw new Error('Failed to delete ai task')
    }
  }, [fetchTasks])

  return {
    tasks,
    isLoading,
    error,
    sendPrompt,
    approve,
    reject,
    requestRevision,
    addTaskOptimistic,
    deleteTask,
    toggleComplete,
    refresh: fetchTasks,
  }
}
