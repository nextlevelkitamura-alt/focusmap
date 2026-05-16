'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { AiTask } from '@/types/ai-task'

const ACTIVE_STATUSES: AiTask['status'][] = ['pending', 'running', 'awaiting_approval', 'needs_input']

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
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('ai_tasks')
        .select('*')
        .eq('user_id', user.id)
        .not('source_note_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200)

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

  // Realtime — INSERT / UPDATE / DELETE を反映
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('note_ai_tasks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_tasks',
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const task = payload.new as AiTask
            if (!task.source_note_id) return
            setByNoteId(prev => {
              const next = new Map(prev)
              const existing = next.get(task.source_note_id!)
              // 同じメモに対しては最新の created_at のもので上書き
              if (!existing || new Date(task.created_at) >= new Date(existing.created_at)) {
                next.set(task.source_note_id!, task)
              } else if (existing.id === task.id) {
                // 既存と同じタスクの UPDATE なら反映
                next.set(task.source_note_id!, task)
              }
              return next
            })
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as Partial<AiTask>
            if (!deleted.source_note_id) return
            setByNoteId(prev => {
              const existing = prev.get(deleted.source_note_id!)
              if (existing && existing.id === deleted.id) {
                const next = new Map(prev)
                next.delete(deleted.source_note_id!)
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
