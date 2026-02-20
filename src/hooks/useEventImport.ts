'use client'

import { useState, useCallback, useRef } from 'react'
import { CalendarEvent } from '@/types/calendar'
import { Task, TaskSource } from '@/types/database'

// --- Types ---

export interface ImportResult {
  inserted: number
  updated: number
  softDeleted: number
  skipped: number
}

export interface UseEventImportReturn {
  importEvents: (events: CalendarEvent[]) => Promise<ImportResult>
  isImporting: boolean
  lastImportedAt: Date | null
  error: Error | null
}

const EMPTY_RESULT: ImportResult = { inserted: 0, updated: 0, softDeleted: 0, skipped: 0 }

// --- Utility functions ---

export function computeFingerprint(event: CalendarEvent): string {
  return `${event.title}|${event.start_time}|${event.end_time}|${event.calendar_id}`
}

export function shouldFilterEvent(event: CalendarEvent): boolean {
  if (event.is_all_day) return true
  return false
}

export function isRecentlyUpdated(updatedAt: string | null, thresholdMinutes = 5): boolean {
  if (!updatedAt) return false
  const diff = Date.now() - new Date(updatedAt).getTime()
  return diff < thresholdMinutes * 60 * 1000
}

export function mapEventToTask(event: CalendarEvent, userId: string): Partial<Task> {
  const startTime = new Date(event.start_time)
  const endTime = new Date(event.end_time)
  const estimatedMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000)

  return {
    user_id: userId,
    title: event.title,
    google_event_id: event.google_event_id,
    calendar_id: event.calendar_id,
    scheduled_at: event.start_time,
    estimated_time: estimatedMinutes,
    source: 'google_event' as TaskSource,
    stage: 'scheduled',
    status: 'todo',
    google_event_fingerprint: computeFingerprint(event),
  }
}

// --- Hook ---

export function useEventImport(): UseEventImportReturn {
  const [isImporting, setIsImporting] = useState(false)
  const [lastImportedAt, setLastImportedAt] = useState<Date | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const importEvents = useCallback(async (events: CalendarEvent[]): Promise<ImportResult> => {
    // フィルタリング（全日イベント除外等）
    const filtered = events.filter(e => !shouldFilterEvent(e))

    // 空なら API を呼ばない
    if (filtered.length === 0) {
      return EMPTY_RESULT
    }

    setIsImporting(true)
    setError(null)

    try {
      const payload = {
        events: filtered.map(e => ({
          google_event_id: e.google_event_id,
          calendar_id: e.calendar_id,
          title: e.title,
          start_time: e.start_time,
          end_time: e.end_time,
          is_all_day: e.is_all_day,
          fingerprint: computeFingerprint(e),
        })),
      }

      const res = await fetch('/api/tasks/import-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        const err = new Error(data.error?.message || 'Import failed')
        setError(err)
        throw err
      }

      setLastImportedAt(new Date())
      return data.result as ImportResult
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setIsImporting(false)
    }
  }, [])

  return { importEvents, isImporting, lastImportedAt, error }
}
