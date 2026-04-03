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

  return {
    tasks,
    isLoading,
    error,
    sendPrompt,
    refresh: fetchTasks,
  }
}
