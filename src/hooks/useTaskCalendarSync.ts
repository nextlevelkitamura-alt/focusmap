import { useEffect, useRef, useState } from 'react'

interface UseTaskCalendarSyncOptions {
  taskId: string
  scheduled_at: string | null
  estimated_time: number
  calendar_id: string | null
  google_event_id: string | null
  /** 同期を有効にするかどうか（グループの場合は false） */
  enabled?: boolean
  onSyncSuccess?: () => void
  onSyncError?: (error: Error) => void
  /** 同期成功時に google_event_id をローカルステートに反映するコールバック */
  onGoogleEventIdChange?: (googleEventId: string) => void
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export function useTaskCalendarSync({
  taskId,
  scheduled_at,
  estimated_time,
  calendar_id,
  google_event_id,
  enabled = true,
  onSyncSuccess,
  onSyncError,
  onGoogleEventIdChange
}: UseTaskCalendarSyncOptions) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<Error | null>(null)
  const retryCountRef = useRef(0)
  const maxRetries = 3

  // 前回の値を保存
  const prevRef = useRef({
    scheduled_at,
    estimated_time,
    calendar_id,
    google_event_id
  })

  // 同期関数
  const syncToCalendar = async (method: 'POST' | 'PATCH' | 'DELETE') => {
    setStatus('syncing')
    setError(null)

    try {
      const url = `/api/calendar/sync-task`
      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' }
      }

      if (method === 'POST' || method === 'PATCH') {
        options.body = JSON.stringify({
          taskId,
          scheduled_at,
          estimated_time,
          calendar_id
        })
      } else if (method === 'DELETE') {
        options.body = JSON.stringify({
          taskId,
          google_event_id
        })
      }

      const response = await fetch(url, options)

      if (!response.ok) {
        const errorData = await response.json()

        // 404 エラーはリトライしない（リソースが見つからないため）
        if (response.status === 404) {
          setStatus('idle')
          retryCountRef.current = 0
          return
        }

        throw new Error(errorData.error || `Sync failed: ${response.statusText}`)
      }

      // 同期成功: google_event_id をローカルステートに反映
      if (method === 'POST' || method === 'PATCH') {
        const data = await response.json()
        if (data.googleEventId) {
          onGoogleEventIdChange?.(data.googleEventId)
        }
      }

      setStatus('success')
      retryCountRef.current = 0
      onSyncSuccess?.()
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')

      // リトライ可能なエラーの場合
      if (retryCountRef.current < maxRetries) {
        const delay = Math.pow(2, retryCountRef.current) * 1000
        retryCountRef.current += 1
        // 指数バックオフ: 1秒, 2秒, 4秒
        setTimeout(() => {
          syncToCalendar(method)
        }, delay)
      } else {
        setStatus('error')
        setError(error)
        retryCountRef.current = 0
        onSyncError?.(error)
      }
    }
  }

  // カレンダー変更時の特別処理（古いイベントを削除→新しいカレンダーに作成）
  const handleCalendarChange = async () => {
    const prev = prevRef.current
    const hasAllFields = scheduled_at && estimated_time && calendar_id

    // カレンダーが変更されていて、既存イベントがある場合
    if (hasAllFields && google_event_id && prev.calendar_id !== calendar_id && prev.calendar_id) {
      setStatus('syncing')
      setError(null)

      try {
        // まず古いカレンダーから削除
        const deleteOptions: RequestInit = {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            google_event_id
          })
        }

        const deleteResponse = await fetch('/api/calendar/sync-task', deleteOptions)

        if (!deleteResponse.ok) {
          throw new Error('Failed to delete old event')
        }

        // 削除成功後、新しいカレンダーに作成
        await syncToCalendar('POST')

        // 処理成功後、prevRef を更新
        prevRef.current = {
          scheduled_at,
          estimated_time,
          calendar_id,
          google_event_id
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to move event')
        setStatus('error')
        setError(error)
        onSyncError?.(error)
        // エラーでもprevRefを更新して無限リトライループを防止
        prevRef.current = {
          scheduled_at,
          estimated_time,
          calendar_id,
          google_event_id
        }
      }
    }
  }

  // リトライ関数（UI から呼び出す用）
  const retry = () => {
    retryCountRef.current = 0
    const hasAllFields = scheduled_at && estimated_time && calendar_id

    if (hasAllFields && !google_event_id) {
      syncToCalendar('POST')
    } else if (hasAllFields && google_event_id) {
      syncToCalendar('PATCH')
    }
  }

  // タスクの変更を監視
  useEffect(() => {
    // 新スキーマ: グループの場合は同期をスキップ
    if (!enabled) {
      return
    }

    const prev = prevRef.current
    // 3つの条件を厳密にチェック（estimated_time は 0 より大きい必要がある）
    const hasAllFields = !!(scheduled_at && calendar_id && estimated_time && estimated_time > 0)

    // 3つのフィールドが揃った瞬間（新規作成）
    if (hasAllFields && !prev.google_event_id && !google_event_id) {
      setStatus('idle') // リセット
      syncToCalendar('POST')
    }
    // 3つのフィールドが揃っていて、既存イベントがある場合（更新）
    else if (hasAllFields && google_event_id) {
      // いずれかのフィールドが変更された場合のみ更新
      const hasChanged =
        prev.scheduled_at !== scheduled_at ||
        prev.estimated_time !== estimated_time ||
        prev.calendar_id !== calendar_id

      if (hasChanged) {
        setStatus('idle') // リセット

        // カレンダーが変更された場合は特別処理
        if (prev.calendar_id && prev.calendar_id !== calendar_id) {
          handleCalendarChange()
          // handleCalendarChange 内で prevRef を更新するので、ここでは return
          return
        }

        // 同じカレンダー内での更新
        syncToCalendar('PATCH')
      }
    }
    // カレンダー選択が解除された場合（削除）
    // google_event_id がある場合のみ削除を実行
    else if (!calendar_id && google_event_id) {
      setStatus('idle') // リセット
      syncToCalendar('DELETE')
    }

    // 前回の値を更新（カレンダー変更時以外）
    prevRef.current = {
      scheduled_at,
      estimated_time,
      calendar_id,
      google_event_id
    }
  }, [taskId, scheduled_at, estimated_time, calendar_id, google_event_id, enabled])

  return {
    status,
    error,
    retry,
    isSyncing: status === 'syncing',
    isSuccess: status === 'success',
    isError: status === 'error'
  }
}
