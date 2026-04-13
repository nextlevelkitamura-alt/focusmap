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

    // 月次アイテムの完了判定のため、月初からのデータも取得
    const expandedFrom = useMemo(() => {
        const d = new Date(dateRange.from + 'T00:00:00')
        return format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd')
    }, [dateRange.from])

    const fetchCompletions = useCallback(async () => {
        try {
            const res = await fetch(`/api/ideals/completions?from=${expandedFrom}&to=${dateRange.to}`)
            if (!res.ok) return
            const data = await res.json()
            setDirectCompletions(data.directCompletions ?? [])
            setHabitCompletions(data.habitCompletions ?? [])
        } catch {
            // silent
        } finally {
            setIsLoading(false)
        }
    }, [expandedFrom, dateRange.to])

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

    // description から「毎月N日」のパターンを抽出
    const extractPayDay = (desc: string | null): number | null => {
        if (!desc) return null
        const match = desc.match(/毎月(\d+)日/)
        return match ? parseInt(match[1], 10) : null
    }

    // 月次アイテムの今月完了チェック
    const isMonthlyCompletedThisMonth = (itemId: string, year: number, month: number): boolean => {
        return directCompletions.some(c => {
            if (c.ideal_item_id !== itemId || !c.is_completed) return false
            const d = new Date(c.completed_date + 'T00:00:00')
            return d.getFullYear() === year && d.getMonth() === month
        })
    }

    // 日別サマリーを構築
    const daySummaries = useMemo(() => {
        const map = new Map<string, DaySummary>()

        // 日付範囲内の各日について
        const start = new Date(dateRange.from + 'T00:00:00')
        const end = new Date(dateRange.to + 'T00:00:00')

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = format(d, 'yyyy-MM-dd')
            const currentDay = d.getDate()
            const currentYear = d.getFullYear()
            const currentMonth = d.getMonth()
            const items: IdealTrackingItem[] = []

            for (const { item, goal } of trackableItems) {
                let shouldShow = false

                if (item.frequency_type === 'daily' || item.frequency_type === 'weekly') {
                    shouldShow = true
                } else if (item.frequency_type === 'monthly') {
                    // 月次: 「毎月N日」以降 かつ 今月未チェックなら表示
                    const payDay = extractPayDay(item.description)
                    if (payDay) {
                        const completedThisMonth = isMonthlyCompletedThisMonth(item.id, currentYear, currentMonth)
                        shouldShow = currentDay >= payDay && !completedThisMonth
                    } else {
                        // payDay情報がない場合は月初から表示
                        const completedThisMonth = isMonthlyCompletedThisMonth(item.id, currentYear, currentMonth)
                        shouldShow = !completedThisMonth
                    }
                }

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
        const isCurrentlyCompleted = existing?.is_completed ?? false

        // 楽観的更新（即時UI反映）
        setDirectCompletions(prev => {
            const filtered = prev.filter(
                c => !(c.ideal_item_id === itemId && c.completed_date === date)
            )
            if (!isCurrentlyCompleted) {
                return [...filtered, {
                    id: `temp-${Date.now()}`,
                    ideal_item_id: itemId,
                    user_id: '',
                    completed_date: date,
                    is_completed: true,
                    elapsed_minutes: 0,
                    note: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                } as IdealItemCompletion]
            }
            return filtered
        })

        try {
            if (isCurrentlyCompleted) {
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
            // 整合性確認のため再フェッチ
            setRefreshKey(k => k + 1)
        } catch {
            // エラー時はサーバー状態に戻す
            setRefreshKey(k => k + 1)
        }
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
