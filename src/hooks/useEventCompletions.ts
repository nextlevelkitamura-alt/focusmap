"use client"

import { useState, useEffect, useCallback } from "react"
import { EventCompletion } from "@/types/database"

interface UseEventCompletionsReturn {
    completedEventIds: Set<string>
    isLoading: boolean
    toggleEventCompletion: (googleEventId: string, calendarId: string) => void
}

export function useEventCompletions(): UseEventCompletionsReturn {
    const [completions, setCompletions] = useState<EventCompletion[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // SSR-safe: render中にnew Date()を呼ばない（タイムゾーン差でSSR/Client不一致を防ぐ）
    const [todayStr, setTodayStr] = useState('')
    useEffect(() => {
        setTodayStr(new Date().toISOString().split('T')[0])
    }, [])

    // Fetch today's completions
    const fetchCompletions = useCallback(async () => {
        if (!todayStr) return
        try {
            const res = await fetch(`/api/event-completions?date=${todayStr}`)
            const data = await res.json()
            if (data.success) {
                setCompletions(data.completions)
            }
        } catch (err) {
            console.error('[useEventCompletions] Fetch error:', err)
        } finally {
            setIsLoading(false)
        }
    }, [todayStr])

    useEffect(() => {
        fetchCompletions()
    }, [fetchCompletions])

    // Derived set of completed google_event_ids
    const completedEventIds = new Set(completions.map(c => c.google_event_id))

    // Toggle completion (optimistic update)
    const toggleEventCompletion = useCallback((googleEventId: string, calendarId: string) => {
        const isCompleted = completions.some(c => c.google_event_id === googleEventId)

        if (isCompleted) {
            // Optimistic: remove
            setCompletions(prev => prev.filter(c => c.google_event_id !== googleEventId))

            fetch('/api/event-completions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ google_event_id: googleEventId, completed_date: todayStr }),
            }).then(res => res.json()).then(data => {
                if (!data.success) {
                    console.error('[useEventCompletions] Delete error:', data.error)
                    fetchCompletions() // rollback
                }
            }).catch(() => {
                fetchCompletions() // rollback
            })
        } else {
            // Optimistic: add
            const optimistic: EventCompletion = {
                id: `temp-${googleEventId}`,
                user_id: '',
                google_event_id: googleEventId,
                calendar_id: calendarId,
                completed_date: todayStr,
                created_at: new Date().toISOString(),
            }
            setCompletions(prev => [...prev, optimistic])

            fetch('/api/event-completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ google_event_id: googleEventId, calendar_id: calendarId, completed_date: todayStr }),
            }).then(res => res.json()).then(data => {
                if (!data.success) {
                    console.error('[useEventCompletions] Post error:', data.error)
                    fetchCompletions() // rollback
                }
            }).catch(() => {
                fetchCompletions() // rollback
            })
        }
    }, [completions, todayStr, fetchCompletions])

    return { completedEventIds, isLoading, toggleEventCompletion }
}
