"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { IdealGoalWithItems, IdealItem, IdealItemCompletion, HabitCompletion } from "@/types/database"
import { format } from "date-fns"

export interface IdealTrackingItem {
    idealItem: IdealItem
    idealGoalTitle: string
    idealGoalColor: string
    completionStatus: 'completed' | 'pending'
    elapsedMinutes: number
    targetMinutes: number
    source: 'habit' | 'task' | 'direct'
}

export interface DaySummary {
    date: string
    items: IdealTrackingItem[]
    completedCount: number
    totalCount: number
    totalElapsedMinutes: number
    totalTargetMinutes: number
}

interface UseIdealTrackingResult {
    daySummaries: Map<string, DaySummary>
    todaySummary: DaySummary | null
    toggleItemCompletion: (itemId: string, date: string) => Promise<void>
    updateElapsedMinutes: (itemId: string, date: string, minutes: number) => Promise<void>
    isLoading: boolean
    refresh: () => void
}

export function useIdealTracking(
    ideals: IdealGoalWithItems[],
    dateRange: { from: string; to: string }
): UseIdealTrackingResult {
    const [directCompletions, setDirectCompletions] = useState<IdealItemCompletion[]>([])
    const [habitCompletions, setHabitCompletions] = useState<HabitCompletion[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [refreshKey, setRefreshKey] = useState(0)

    const fetchCompletions = useCallback(async () => {
        try {
            const res = await fetch(`/api/ideals/completions?from=${dateRange.from}&to=${dateRange.to}`)
            if (!res.ok) return
            const data = await res.json()
            setDirectCompletions(data.directCompletions ?? [])
            setHabitCompletions(data.habitCompletions ?? [])
        } catch {
            // silent
        } finally {
            setIsLoading(false)
        }
    }, [dateRange.from, dateRange.to])

    useEffect(() => {
        fetchCompletions()
    }, [fetchCompletions, refreshKey])

    // アクティブな理想のアクション系アイテムのみ
    const trackableItems = useMemo(() => {
        return ideals
            .filter(g => g.status === 'active')
            .flatMap(g =>
                (g.ideal_items ?? [])
                    .filter(i => i.item_type === 'habit' || i.item_type === 'action')
                    .filter(i => !i.is_done)
                    .map(i => ({ item: i, goal: g }))
            )
    }, [ideals])

    // 日別サマリーを構築
    const daySummaries = useMemo(() => {
        const map = new Map<string, DaySummary>()
        const today = format(new Date(), 'yyyy-MM-dd')

        // 日付範囲内の各日について
        const start = new Date(dateRange.from + 'T00:00:00')
        const end = new Date(dateRange.to + 'T00:00:00')

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = format(d, 'yyyy-MM-dd')
            const items: IdealTrackingItem[] = []

            for (const { item, goal } of trackableItems) {
                // 頻度チェック（daily は毎日、他はとりあえず毎日表示）
                const shouldShow = item.frequency_type === 'daily'
                    || item.frequency_type === 'weekly'
                    || item.frequency_type === 'monthly'

                if (!shouldShow) continue

                let completionStatus: 'completed' | 'pending' = 'pending'
                let elapsedMinutes = 0
                let source: 'habit' | 'task' | 'direct' = 'direct'

                if (item.linked_habit_id) {
                    source = 'habit'
                    const hc = habitCompletions.find(
                        c => c.habit_id === item.linked_habit_id && c.completed_date === dateStr
                    )
                    if (hc) completionStatus = 'completed'
                } else {
                    const dc = directCompletions.find(
                        c => c.ideal_item_id === item.id && c.completed_date === dateStr
                    )
                    if (dc) {
                        completionStatus = dc.is_completed ? 'completed' : 'pending'
                        elapsedMinutes = dc.elapsed_minutes
                    }
                }

                items.push({
                    idealItem: item,
                    idealGoalTitle: goal.title,
                    idealGoalColor: goal.color,
                    completionStatus,
                    elapsedMinutes,
                    targetMinutes: item.session_minutes,
                    source,
                })
            }

            const completedCount = items.filter(i => i.completionStatus === 'completed').length

            map.set(dateStr, {
                date: dateStr,
                items,
                completedCount,
                totalCount: items.length,
                totalElapsedMinutes: items.reduce((sum, i) => sum + i.elapsedMinutes, 0),
                totalTargetMinutes: items.reduce((sum, i) => sum + i.targetMinutes, 0),
            })
        }

        return map
    }, [trackableItems, directCompletions, habitCompletions, dateRange])

    const todaySummary = daySummaries.get(format(new Date(), 'yyyy-MM-dd')) ?? null

    const toggleItemCompletion = useCallback(async (itemId: string, date: string) => {
        const existing = directCompletions.find(
            c => c.ideal_item_id === itemId && c.completed_date === date
        )

        if (existing?.is_completed) {
            await fetch('/api/ideals/completions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ideal_item_id: itemId, completed_date: date }),
            })
        } else {
            await fetch('/api/ideals/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ideal_item_id: itemId,
                    completed_date: date,
                    is_completed: true,
                }),
            })
        }

        setRefreshKey(k => k + 1)
    }, [directCompletions])

    const updateElapsedMinutes = useCallback(async (itemId: string, date: string, minutes: number) => {
        await fetch('/api/ideals/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ideal_item_id: itemId,
                completed_date: date,
                elapsed_minutes: minutes,
            }),
        })
        setRefreshKey(k => k + 1)
    }, [])

    const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

    return {
        daySummaries,
        todaySummary,
        toggleItemCompletion,
        updateElapsedMinutes,
        isLoading,
        refresh,
    }
}
