"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Task, HabitCompletion, HabitTaskCompletion } from "@/types/database"

// --- Types ---

export interface HabitWithDetails {
    habit: Task
    childTasks: Task[]
    completions: HabitCompletion[]
    taskCompletions: HabitTaskCompletion[]  // 子タスクの日次完了記録
    streak: number
    isCompletedToday: boolean
    isTodayHabit: boolean
}

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// --- Helper functions ---

export function getTodayDateString(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDateString(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRange(days: number): { from: string; to: string } {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    return { from: formatDateString(from), to: formatDateString(to) }
}

export function parseFrequency(freq: string | null): string[] {
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
        const dateStr = formatDateString(checkDate)
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

            // Fetch habits and task completions in parallel
            const [habitsRes, taskCompletionsRes] = await Promise.all([
                fetch(`/api/habits?from=${from}&to=${to}`),
                fetch(`/api/habits/task-completions?from=${from}&to=${to}`),
            ])
            const habitsData = await habitsRes.json()
            const taskCompletionsData = await taskCompletionsRes.json()

            if (!habitsData.success) {
                setError(habitsData.error?.message || 'Failed to fetch habits')
                return
            }

            const allTaskCompletions: HabitTaskCompletion[] = taskCompletionsData.success
                ? (taskCompletionsData.completions || [])
                : []

            const todayStr = getTodayDateString()
            const processed: HabitWithDetails[] = (habitsData.habits || []).map((h: any) => {
                const completions: HabitCompletion[] = h.completions || []
                const isCompletedToday = completions.some((c: HabitCompletion) => c.completed_date === todayStr)
                const freq = h.habit_frequency as string | null
                const startDate = h.habit_start_date as string | null
                const endDate = h.habit_end_date as string | null
                const isTodayHabit = isTodayInFrequency(freq) && isTodayInPeriod(startDate, endDate)

                // Filter task completions for this habit
                const habitTaskCompletions = allTaskCompletions.filter(
                    (tc: HabitTaskCompletion) => tc.habit_id === h.id
                )

                return {
                    habit: h as Task,
                    childTasks: h.child_tasks || [],
                    completions,
                    taskCompletions: habitTaskCompletions,
                    streak: calculateStreak(completions, freq),
                    isCompletedToday,
                    isTodayHabit,
                }
            })

            setHabits(processed)

            // 期間完了の自動判定: end_date が過ぎた習慣をチェック
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            for (const h of processed) {
                const habit = h.habit
                if (habit.status === 'done' || !habit.is_habit) continue
                if (!habit.habit_end_date) continue

                const endDate = new Date(habit.habit_end_date + 'T00:00:00')
                if (today <= endDate) continue // まだ期間中

                // 期間内の全対象日をチェック
                const startDate = habit.habit_start_date
                    ? new Date(habit.habit_start_date + 'T00:00:00')
                    : endDate // start未設定なら終了日のみ
                const targetDays = parseFrequency(habit.habit_frequency)
                const completedDates = new Set(h.completions.map(c => c.completed_date))

                let allCompleted = true
                const d = new Date(startDate)
                while (d <= endDate) {
                    const dayKey = DAY_KEYS[d.getDay()]
                    // 対象曜日のみチェック（周波数未設定なら全日チェック）
                    if (targetDays.length === 0 || targetDays.includes(dayKey)) {
                        const dateStr = formatDateString(d)
                        if (!completedDates.has(dateStr)) {
                            allCompleted = false
                            break
                        }
                    }
                    d.setDate(d.getDate() + 1)
                }

                if (allCompleted) {
                    // 期間完了 → status を 'done' に更新
                    fetch(`/api/tasks/${habit.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'done' }),
                    }).catch(err => console.error('[useHabits] Period complete update failed:', err))
                }
            }
        } catch (err) {
            console.error('[useHabits] Fetch error:', err)
            setError('Failed to fetch habits')
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Toggle completion for today (habit-level)
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
                await fetch('/api/habits/completions', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                })
            } else {
                await fetch('/api/habits/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                })
            }
        } catch (err) {
            console.error('[useHabits] Toggle error:', err)
            await fetchHabits()
        }
    }, [habits, fetchHabits])

    // Toggle child task completion for today (date-based)
    const toggleChildTaskCompletion = useCallback(async (habitId: string, taskId: string) => {
        const todayStr = getTodayDateString()
        const habit = habits.find(h => h.habit.id === habitId)
        if (!habit) return

        const isCurrentlyCompleted = habit.taskCompletions.some(
            tc => tc.task_id === taskId && tc.completed_date === todayStr
        )

        // Optimistic update
        setHabits(prev => prev.map(h => {
            if (h.habit.id !== habitId) return h
            const newTaskCompletions = isCurrentlyCompleted
                ? h.taskCompletions.filter(tc => !(tc.task_id === taskId && tc.completed_date === todayStr))
                : [...h.taskCompletions, { id: 'temp', habit_id: habitId, task_id: taskId, user_id: '', completed_date: todayStr, created_at: '' } as HabitTaskCompletion]

            // Check if all child tasks are now completed today
            const allChildrenDoneToday = h.childTasks.every(child => {
                if (child.id === taskId) return !isCurrentlyCompleted
                return newTaskCompletions.some(tc => tc.task_id === child.id && tc.completed_date === todayStr)
            })

            // Auto-update habit completion
            let newCompletions = h.completions
            let newIsCompletedToday = h.isCompletedToday
            if (h.childTasks.length > 0) {
                if (allChildrenDoneToday && !h.isCompletedToday) {
                    newCompletions = [...h.completions, { id: 'temp-auto', habit_id: habitId, user_id: '', completed_date: todayStr, created_at: '', updated_at: '' } as HabitCompletion]
                    newIsCompletedToday = true
                } else if (!allChildrenDoneToday && h.isCompletedToday) {
                    newCompletions = h.completions.filter(c => c.completed_date !== todayStr)
                    newIsCompletedToday = false
                }
            }

            return {
                ...h,
                taskCompletions: newTaskCompletions,
                completions: newCompletions,
                isCompletedToday: newIsCompletedToday,
                streak: calculateStreak(newCompletions, h.habit.habit_frequency),
            }
        }))

        try {
            if (isCurrentlyCompleted) {
                await fetch('/api/habits/task-completions', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId, completed_date: todayStr }),
                })
            } else {
                await fetch('/api/habits/task-completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ habit_id: habitId, task_id: taskId, completed_date: todayStr }),
                })
            }

            // Auto-complete/uncomplete parent habit
            const updatedHabit = habits.find(h => h.habit.id === habitId)
            if (updatedHabit && updatedHabit.childTasks.length > 0) {
                const allDone = updatedHabit.childTasks.every(child => {
                    if (child.id === taskId) return !isCurrentlyCompleted
                    return updatedHabit.taskCompletions.some(tc => tc.task_id === child.id && tc.completed_date === todayStr)
                })
                if (allDone && !updatedHabit.isCompletedToday) {
                    await fetch('/api/habits/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                    })
                } else if (!allDone && updatedHabit.isCompletedToday) {
                    await fetch('/api/habits/completions', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ habit_id: habitId, completed_date: todayStr }),
                    })
                }
            }
        } catch (err) {
            console.error('[useHabits] Toggle child task error:', err)
            await fetchHabits()
        }
    }, [habits, fetchHabits])

    // Check if a child task is completed for a specific date
    const isChildTaskCompletedForDate = useCallback((habitId: string, taskId: string, dateStr: string): boolean => {
        const habit = habits.find(h => h.habit.id === habitId)
        if (!habit) return false
        return habit.taskCompletions.some(tc => tc.task_id === taskId && tc.completed_date === dateStr)
    }, [habits])

    // Remove habit (delete the task entirely)
    const removeHabit = useCallback(async (habitId: string) => {
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

    // Optimistic update for child task status (used by TodayView - legacy)
    const updateChildTaskStatus = useCallback((habitId: string, taskId: string, newStatus: string) => {
        setHabits(prev => prev.map(h => {
            if (h.habit.id !== habitId) return h
            return {
                ...h,
                childTasks: h.childTasks.map(c =>
                    c.id === taskId ? { ...c, status: newStatus } : c
                ),
            }
        }))
    }, [])

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
        toggleChildTaskCompletion,
        isChildTaskCompletedForDate,
        updateChildTaskStatus,
        removeHabit,
        refetch: fetchHabits,
    }
}
