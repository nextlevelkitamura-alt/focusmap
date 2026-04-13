'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { AiTask } from '@/types/ai-task'

interface UseAiTasksOptions {
  /** 最大取得件数（デフォルト: 20） */
  limit?: number
}

export function useAiTasks({ limit = 20 }: UseAiTasksOptions = {}) {
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // 初回読み込み
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai-tasks?limit=${limit}`)
      if (!res.ok) throw new Error('Failed to fetch ai_tasks')
      const data: AiTask[] = await res.json()
      setTasks(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('ai_tasks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_tasks',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newTask = payload.new as AiTask
            setTasks(prev => [newTask, ...prev].slice(0, limit))
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as AiTask
            setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as { id: string }
            setTasks(prev => prev.filter(t => t.id !== deleted.id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [limit])

  // 壁打ち送信
  const sendPrompt = useCallback(async (prompt: string, options?: {
    skill_id?: string
    approval_type?: string
    parent_task_id?: string
  }) => {
    const res = await fetch('/api/ai-tasks', {
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
    const res = await fetch(`/api/ai-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    if (!res.ok) throw new Error('Failed to approve')
    return (await res.json()) as AiTask
  }, [])

  // 却下（failed にする）
  const reject = useCallback(async (taskId: string, reason?: string) => {
    const res = await fetch(`/api/ai-tasks/${taskId}`, {
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

  return {
    tasks,
    isLoading,
    error,
    sendPrompt,
    approve,
    reject,
    requestRevision,
    addTaskOptimistic,
    refresh: fetchTasks,
  }
}
