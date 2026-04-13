'use client'

import { useState, useCallback, useEffect } from 'react'
import type { AiTask } from '@/types/ai-task'

export function useScheduledTasks() {
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai-tasks?scheduled=true&limit=50')
      if (!res.ok) throw new Error('Failed to fetch scheduled tasks')
      const data: AiTask[] = await res.json()
      setTasks(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const deleteTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/ai-tasks/${taskId}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) throw new Error('Delete failed')
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }, [])

  return { tasks, isLoading, error, refresh: fetchTasks, deleteTask }
}
