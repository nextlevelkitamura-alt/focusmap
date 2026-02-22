"use client"

import { useEffect, useRef } from 'react'
import { Task } from '@/types/database'
import { CalendarEvent } from '@/types/calendar'
import { invalidateCalendarCache } from '@/hooks/useCalendarEvents'

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

interface TaskSyncState {
  status: SyncStatus
  error: Error | null
}

interface UseMultiTaskCalendarSyncOptions {
  tasks: Task[]
  onRefreshCalendar?: () => Promise<void>
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
  onAddOptimisticEvent?: (event: CalendarEvent) => void
  onRemoveOptimisticEvent?: (eventId: string) => void
}

/** タスク情報から楽観的CalendarEventを生成 */
function buildOptimisticEvent(task: Task): CalendarEvent {
  const startTime = new Date(task.scheduled_at!)
  const endTime = new Date(startTime.getTime() + (task.estimated_time || 60) * 60 * 1000)
  const now = new Date().toISOString()
  return {
    id: `optimistic-${task.id}`,
    user_id: task.user_id,
    google_event_id: '',
    calendar_id: task.calendar_id!,
    title: task.title,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    is_all_day: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    synced_at: now,
    created_at: now,
    updated_at: now,
    task_id: task.id,
  }
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
  onAddOptimisticEvent,
  onRemoveOptimisticEvent,
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

  // 同期クールダウン（同一タスクの短時間内の再同期を防止）
  const lastSyncedAtRef = useRef<Map<string, number>>(new Map())
  const SYNC_COOLDOWN_MS = 3000

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
        return
      }

      // 初回レンダリング時: prevがない場合は記録のみ（同期しない）
      if (!prev) {
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
        syncToCalendar(taskId, 'POST', task)
      }
      // 更新: 既存イベントがあり、いずれかのフィールドが変更された
      else if (hasAllFields && task.google_event_id) {
        const hasChanged =
          prev.scheduled_at !== task.scheduled_at ||
          prev.estimated_time !== task.estimated_time ||
          prev.calendar_id !== task.calendar_id


        if (hasChanged) {
          // カレンダーが変更された場合
          if (prev.calendar_id && prev.calendar_id !== task.calendar_id) {
            handleCalendarChange(taskId, task)
          } else {
            // 同じカレンダー内での更新
            syncToCalendar(taskId, 'PATCH', task)
          }
        }
      }
      // 削除: カレンダー選択が解除された（google_event_id がある場合のみ）
      else if (!task.calendar_id && task.google_event_id) {
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
    // クールダウンチェック（DELETE は即時実行を許可）
    if (method !== 'DELETE') {
      const lastSynced = lastSyncedAtRef.current.get(taskId)
      if (lastSynced && Date.now() - lastSynced < SYNC_COOLDOWN_MS) {
        return
      }
    }

    syncingTasksRef.current.add(taskId)
    lastSyncedAtRef.current.set(taskId, Date.now())
    const optimisticId = `optimistic-${task.id}`

    try {
      // 楽観的UI更新: API呼び出し前に即座にカレンダーUIに反映
      if (method === 'POST' && onAddOptimisticEvent) {
        onAddOptimisticEvent(buildOptimisticEvent(task))
      } else if (method === 'PATCH' && onRemoveOptimisticEvent && onAddOptimisticEvent) {
        // 更新: 古い楽観的イベントを削除して新しいものを追加
        onRemoveOptimisticEvent(optimisticId)
        onAddOptimisticEvent(buildOptimisticEvent(task))
      } else if (method === 'DELETE' && onRemoveOptimisticEvent) {
        onRemoveOptimisticEvent(optimisticId)
      }

      const body = {
        taskId,
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: task.google_event_id,
        title: task.title,
      }

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

      // 新規作成時: google_event_id をDBに保存
      if (method === 'POST' && data.googleEventId) {
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
        await onUpdateTask?.(taskId, { google_event_id: null })
        const prev = prevTasksRef.current.get(taskId)
        if (prev) {
          prevTasksRef.current.set(taskId, {
            ...prev,
            google_event_id: null,
          })
        }
      }

      // 楽観的イベントを削除してから実データで更新
      onRemoveOptimisticEvent?.(optimisticId)
      // カレンダーキャッシュを無効化（他のカレンダー表示にも即座に反映）
      invalidateCalendarCache()
      // カレンダーを更新（実データに置換）
      await onRefreshCalendar?.()
    } catch (err) {
      console.error(`[useMultiTaskCalendarSync] ${method} failed for task ${taskId}:`, err)
      // エラー時: 楽観的イベントをクリーンアップ（ゴースト防止）
      onRemoveOptimisticEvent?.(optimisticId)
    } finally {
      syncingTasksRef.current.delete(taskId)
    }
  }

  /**
   * カレンダー変更時の処理（旧カレンダーから削除 → 新カレンダーに作成）
   */
  const handleCalendarChange = async (taskId: string, task: Task) => {
    syncingTasksRef.current.add(taskId)
    const optimisticId = `optimistic-${task.id}`

    // 楽観的UI更新: 旧イベントを削除して新しいカレンダーに追加
    onRemoveOptimisticEvent?.(optimisticId)
    if (onAddOptimisticEvent) {
      onAddOptimisticEvent(buildOptimisticEvent(task))
    }

    try {
      // 1. 旧カレンダーから削除
      if (task.google_event_id) {
        const oldCalendarId = prevTasksRef.current.get(taskId)?.calendar_id

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

        // DELETE 成功後に google_event_id をクリア（レースコンディション防止）
        await onUpdateTask?.(taskId, { google_event_id: null })
      }

      // 2. 新カレンダーに作成（google_event_id を明示的に含めない → 新規作成として扱う）
      const response = await fetch('/api/calendar/sync-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          scheduled_at: task.scheduled_at,
          estimated_time: task.estimated_time,
          calendar_id: task.calendar_id,
          title: task.title,
          google_event_id: null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create event in new calendar')
      }

      const data = await response.json()

      // 新しい google_event_id を保存
      if (data.googleEventId) {
        await onUpdateTask?.(taskId, { google_event_id: data.googleEventId })
      }

      // prevTasksRef を更新
      prevTasksRef.current.set(taskId, {
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: data.googleEventId || null,
      })

      // 楽観的イベントをクリーンアップして実データに置換
      onRemoveOptimisticEvent?.(optimisticId)
      // カレンダーキャッシュを無効化
      invalidateCalendarCache()
      await onRefreshCalendar?.()
    } catch (err) {
      console.error('[useMultiTaskCalendarSync] Calendar change failed:', err)
      // エラー時: 楽観的イベントをクリーンアップ
      onRemoveOptimisticEvent?.(optimisticId)
      // カレンダー変更失敗をログ（google_event_idは既にnullの可能性あり）
      // 次回のフルリフレッシュで正しい状態に同期されるよう、カレンダーを即更新
      await onRefreshCalendar?.()
    } finally {
      syncingTasksRef.current.delete(taskId)
    }
  }

  // このフックは状態を返さない（バックグラウンドで同期を実行するのみ）
  return null
}
