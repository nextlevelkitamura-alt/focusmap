"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Task, HabitCompletion } from "@/types/database"

// --- Types ---

export interface HabitWithDetails {
    habit: Task
    childTasks: Task[]
    completions: HabitCompletion[]
    streak: number
    isCompletedToday: boolean
    isTodayHabit: boolean
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// --- Helper functions ---

function getTodayDateString(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRange(days: number): { from: string; to: string } {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { from: fmt(from), to: fmt(to) }
}

function parseFrequency(freq: string | null): string[] {
    if (!freq) return []
    return freq.split(',').map(s => s.trim()).filter(Boolean)
}

function isTodayInFrequency(freq: string | null): boolean {
    const days = parseFrequency(freq)
    if (days.length === 0) return true
    const todayKey = DAY_KEYS[new Date().getDay()]
    return days.includes(todayKey)
}

function isTodayInPeriod(startDate: string | null, endDate: string | null): boolean {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (startDate) {
        const start = new Date(startDate + 'T00:00:00')
        if (today < start) return false
    }
    if (endDate) {
        const end = new Date(endDate + 'T00:00:00')
        if (today > end) return false
    }
    return true
}

function calculateStreak(completions: HabitCompletion[], freq: string | null): number {
    if (completions.length === 0) return 0

    const completedDates = new Set(completions.map(c => c.completed_date))
    const days = parseFrequency(freq)
    let streak = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Check backwards from today
    for (let i = 0; i < 365; i++) {
        const checkDate = new Date(today)
        checkDate.setDate(checkDate.getDate() - i)
        const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`
        const dayKey = DAY_KEYS[checkDate.getDay()]

        // Skip days not in the frequency
        if (days.length > 0 && !days.includes(dayKey)) continue

        if (completedDates.has(dateStr)) {
            streak++
        } else {
            // Today is allowed to be incomplete (streak doesn't break until end of day)
            if (i === 0) continue
            break
        }
    }

    return streak
}

// --- Hook ---

export function useHabits() {
    const [habits, setHabits] = useState<HabitWithDetails[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchHabits = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)

            const { from, to } = getDateRange(30) // Last 30 days for streak calculation
            const res = await fetch(`/api/habits?from=${from}&to=${to}`)
            const data = await res.json()

            if (!data.success) {
                setError(data.error?.message || 'Failed to fetch habits')
                return
            }

            const todayStr = getTodayDateString()
            const processed: HabitWithDetails[] = (data.habits || []).map((h: any) => {
                const completions: HabitCompletion[] = h.completions || []
                const isCompletedToday = completions.some((c: HabitCompletion) => c.completed_date === todayStr)
                const freq = h.habit_frequency as string | null
                const startDate = h.habit_start_date as string | null
                const endDate = h.habit_end_date as string | null
                const isTodayHabit = isTodayInFrequency(freq) && isTodayInPeriod(startDate, endDate)

                return {
                    habit: h as Task,
                    childTasks: h.child_tasks || [],
                    completions,
                    streak: calculateStreak(completions, freq),
                    isCompletedToday,
                    isTodayHabit,
                }
            })

            setHabits(processed)
        } catch (err) {
            console.error('[useHabits] Fetch error:', err)
            setError('Failed to fetch habits')
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Toggle completion for today
    const toggleCompletion = useCallback(async (habitId: string) => {
        const todayStr = getTodayDateString()
        const habit = habits.find(h => h.habit.id === habitId)
        if (!habit) return

        // Optimistic update
        setHabits(prev => prev.map(h => {
            if (h.habit.id !== habitId) return h
            const newCompleted = !h.isCompletedToday
            const newCompletions = newCompleted
                ? [...h.completions, { id: 'temp', habit_id: habitId, user_id: '', completed_date: todayStr, created_at: '', updated_at: '' } as HabitCompletion]
                : h.completions.filter(c => c.completed_date !== todayStr)
            return {
                ...h,
                isCompletedToday: newCompleted,
                completions: newCompletions,
                streak: calculateStreak(newCompletions, h.habit.habit_frequency),
            }
        }))

        try {
            if (habit.isCompletedToday) {
                // Remove completion
                await fetch('/api/habits/completions', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                })
            } else {
                // Add completion
                await fetch('/api/habits/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                })
            }
        } catch (err) {
            console.error('[useHabits] Toggle error:', err)
            // Revert on error
            await fetchHabits()
        }
    }, [habits, fetchHabits])

    // Remove habit (delete the task entirely)
    const removeHabit = useCallback(async (habitId: string) => {
        // Optimistic update
        setHabits(prev => prev.filter(h => h.habit.id !== habitId))

        try {
            const res = await fetch(`/api/tasks/${habitId}`, { method: 'DELETE' })
            const data = await res.json()
            if (!data.success) {
                console.error('[useHabits] Remove error:', data.error)
                await fetchHabits()
            }
        } catch (err) {
            console.error('[useHabits] Remove error:', err)
            await fetchHabits()
        }
    }, [fetchHabits])

    // Split habits
    const todayHabits = useMemo(() => habits.filter(h => h.isTodayHabit), [habits])
    const otherHabits = useMemo(() => habits.filter(h => !h.isTodayHabit), [habits])

    // Initial fetch
    useEffect(() => {
        fetchHabits()
    }, [fetchHabits])

    return {
        habits,
        todayHabits,
        otherHabits,
        isLoading,
        error,
        toggleCompletion,
        removeHabit,
        refetch: fetchHabits,
    }
}
