"use client"

import { useEffect, useRef } from 'react'
import { Task } from '@/types/database'

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

interface TaskSyncState {
  status: SyncStatus
  error: Error | null
}

interface UseMultiTaskCalendarSyncOptions {
  tasks: Task[]
  onRefreshCalendar?: () => Promise<void>
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

/**
 * 複数タスクのカレンダー同期を一元管理するフック
 * React Hooks のルールに従い、動的な数のフックを呼び出すことはできないため、
 * useEffect 内で各タスクの同期を管理する
 */
export function useMultiTaskCalendarSync({
  tasks,
  onRefreshCalendar,
  onUpdateTask,
}: UseMultiTaskCalendarSyncOptions) {
  // 各タスクの前回の状態を保持
  const prevTasksRef = useRef<Map<string, {
    scheduled_at: string | null
    estimated_time: number | null
    calendar_id: string | null
    google_event_id: string | null
  }>>(new Map())

  // 同期実行中のタスクを追跡（重複同期防止）
  const syncingTasksRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // グループを除外し、有効なタスクのみ処理
    const validTasks = tasks.filter(task => !task.is_group)

    validTasks.forEach(task => {
      const taskId = task.id
      const prev = prevTasksRef.current.get(taskId)

      // 3つの条件を厳密にチェック（estimated_time は 0 より大きい必要がある）
      const hasAllFields = !!(
        task.scheduled_at &&
        task.calendar_id &&
        task.estimated_time &&
        task.estimated_time > 0
      )

      // 同期中の場合はスキップ
      if (syncingTasksRef.current.has(taskId)) {
        console.log(`[useMultiTaskCalendarSync] Task ${taskId} is already syncing, skipping`)
        return
      }

      // 初回レンダリング時: prevがない場合は記録のみ（同期しない）
      if (!prev) {
        console.log(`[useMultiTaskCalendarSync] First render for task ${taskId}, recording state only`)
        prevTasksRef.current.set(taskId, {
          scheduled_at: task.scheduled_at,
          estimated_time: task.estimated_time,
          calendar_id: task.calendar_id,
          google_event_id: task.google_event_id,
        })
        return
      }

      // 新規作成: 3つのフィールドが揃った瞬間（prevで揃っていなかった → 今揃った）
      const prevHasAllFields = !!(prev.scheduled_at && prev.calendar_id && prev.estimated_time && prev.estimated_time > 0)
      if (hasAllFields && !prevHasAllFields && !task.google_event_id) {
        console.log(`[useMultiTaskCalendarSync] NEW event detected for task ${taskId}`, {
          scheduled_at: task.scheduled_at,
          estimated_time: task.estimated_time,
          calendar_id: task.calendar_id,
        })
        syncToCalendar(taskId, 'POST', task)
      }
      // 更新: 既存イベントがあり、いずれかのフィールドが変更された
      else if (hasAllFields && task.google_event_id) {
        const hasChanged =
          prev.scheduled_at !== task.scheduled_at ||
          prev.estimated_time !== task.estimated_time ||
          prev.calendar_id !== task.calendar_id

        console.log(`[useMultiTaskCalendarSync] UPDATE check for task ${taskId}:`, {
          hasChanged,
          prev: { scheduled_at: prev.scheduled_at, estimated_time: prev.estimated_time, calendar_id: prev.calendar_id },
          current: { scheduled_at: task.scheduled_at, estimated_time: task.estimated_time, calendar_id: task.calendar_id },
        })

        if (hasChanged) {
          // カレンダーが変更された場合
          if (prev.calendar_id && prev.calendar_id !== task.calendar_id) {
            console.log(`[useMultiTaskCalendarSync] CALENDAR CHANGE detected for task ${taskId}:`, {
              old: prev.calendar_id,
              new: task.calendar_id,
            })
            handleCalendarChange(taskId, task)
          } else {
            // 同じカレンダー内での更新
            console.log(`[useMultiTaskCalendarSync] PATCH event for task ${taskId}`)
            syncToCalendar(taskId, 'PATCH', task)
          }
        }
      }
      // 削除: カレンダー選択が解除された（google_event_id がある場合のみ）
      else if (!task.calendar_id && task.google_event_id) {
        console.log(`[useMultiTaskCalendarSync] DELETE event for task ${taskId}`)
        syncToCalendar(taskId, 'DELETE', task)
      }

      // 前回の値を更新
      prevTasksRef.current.set(taskId, {
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: task.google_event_id,
      })
    })

    // タスクが削除された場合、prevTasksRef からも削除
    const currentTaskIds = new Set(validTasks.map(t => t.id))
    for (const taskId of prevTasksRef.current.keys()) {
      if (!currentTaskIds.has(taskId)) {
        prevTasksRef.current.delete(taskId)
      }
    }
  }, [tasks])

  /**
   * カレンダー同期API呼び出し
   */
  const syncToCalendar = async (
    taskId: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    task: Task
  ) => {
    syncingTasksRef.current.add(taskId)
    console.log(`[useMultiTaskCalendarSync] Starting ${method} for task ${taskId}`)

    try {
      const body = {
        taskId,
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: task.google_event_id,
        title: task.title,
      }

      console.log(`[useMultiTaskCalendarSync] ${method} body:`, body)

      const response = await fetch('/api/calendar/sync-task', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to sync (${method})`)
      }

      const data = await response.json()
      console.log(`[useMultiTaskCalendarSync] ${method} success for task ${taskId}:`, data)

      // 新規作成時: google_event_id をDBに保存
      if (method === 'POST' && data.googleEventId) {
        console.log(`[useMultiTaskCalendarSync] Saving google_event_id: ${data.googleEventId}`)
        await onUpdateTask?.(taskId, { google_event_id: data.googleEventId })
        // prevTasksRef を更新
        const prev = prevTasksRef.current.get(taskId)
        if (prev) {
          prevTasksRef.current.set(taskId, {
            ...prev,
            google_event_id: data.googleEventId,
          })
        }
      }

      // 削除時: google_event_id をクリア
      if (method === 'DELETE') {
        console.log(`[useMultiTaskCalendarSync] Clearing google_event_id`)
        await onUpdateTask?.(taskId, { google_event_id: null })
        const prev = prevTasksRef.current.get(taskId)
        if (prev) {
          prevTasksRef.current.set(taskId, {
            ...prev,
            google_event_id: null,
          })
        }
      }

      // カレンダーを更新
      console.log(`[useMultiTaskCalendarSync] Refreshing calendar`)
      await onRefreshCalendar?.()
      console.log(`[useMultiTaskCalendarSync] ${method} completed for task ${taskId}`)
    } catch (err) {
      console.error(`[useMultiTaskCalendarSync] ${method} failed for task ${taskId}:`, err)
      // エラーは silent failure（UIには表示しない）
    } finally {
      syncingTasksRef.current.delete(taskId)
    }
  }

  /**
   * カレンダー変更時の処理（旧カレンダーから削除 → 新カレンダーに作成）
   */
  const handleCalendarChange = async (taskId: string, task: Task) => {
    syncingTasksRef.current.add(taskId)
    console.log(`[useMultiTaskCalendarSync] Starting calendar change for task ${taskId}`)

    try {
      // 1. 旧カレンダーから削除
      if (task.google_event_id) {
        const oldCalendarId = prevTasksRef.current.get(taskId)?.calendar_id
        console.log(`[useMultiTaskCalendarSync] Deleting from old calendar:`, {
          google_event_id: task.google_event_id,
          old_calendar_id: oldCalendarId,
        })

        const deleteResponse = await fetch('/api/calendar/sync-task', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            google_event_id: task.google_event_id,
            calendar_id: oldCalendarId,
          }),
        })

        if (!deleteResponse.ok) {
          const error = await deleteResponse.json()
          console.error(`[useMultiTaskCalendarSync] DELETE from old calendar failed:`, error)
          throw new Error(error.error || 'Failed to delete from old calendar')
        }

        console.log(`[useMultiTaskCalendarSync] DELETE from old calendar success`)
      }

      // 2. 新カレンダーに作成
      console.log(`[useMultiTaskCalendarSync] Creating in new calendar:`, {
        calendar_id: task.calendar_id,
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
      })
      const response = await fetch('/api/calendar/sync-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          scheduled_at: task.scheduled_at,
          estimated_time: task.estimated_time,
          calendar_id: task.calendar_id,
          title: task.title,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create event in new calendar')
      }

      const data = await response.json()
      console.log(`[useMultiTaskCalendarSync] Calendar change success:`, data)

      // 新しい google_event_id を保存
      if (data.googleEventId) {
        console.log(`[useMultiTaskCalendarSync] Saving new google_event_id: ${data.googleEventId}`)
        await onUpdateTask?.(taskId, { google_event_id: data.googleEventId })
      }

      // prevTasksRef を更新
      prevTasksRef.current.set(taskId, {
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: data.googleEventId || null,
      })

      await onRefreshCalendar?.()
      console.log(`[useMultiTaskCalendarSync] Calendar change completed for task ${taskId}`)
    } catch (err) {
      console.error('[useMultiTaskCalendarSync] Calendar change failed:', err)
    } finally {
      syncingTasksRef.current.delete(taskId)
    }
  }

  // このフックは状態を返さない（バックグラウンドで同期を実行するのみ）
  return null
}
