"use client"

import { useState, useCallback } from "react"
import { Task } from "@/types/database"
import { parseFrequency } from "@/hooks/useHabits"
import { cn } from "@/lib/utils"
import {
    Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"

const HABIT_DAYS = [
    { key: 'mon', label: '月' },
    { key: 'tue', label: '火' },
    { key: 'wed', label: '水' },
    { key: 'thu', label: '木' },
    { key: 'fri', label: '金' },
    { key: 'sat', label: '土' },
    { key: 'sun', label: '日' },
] as const

const ICON_OPTIONS = ['🔄', '📚', '💪', '🧘', '🏃', '✍️', '🎵', '💊', '🧹', '💤', '🥗', '💧']

interface HabitSettingsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    habit: Task
    onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>
}

export function HabitSettingsSheet({ open, onOpenChange, habit, onUpdate }: HabitSettingsSheetProps) {
    const [frequency, setFrequency] = useState(habit.habit_frequency ?? '')
    const [startDate, setStartDate] = useState(habit.habit_start_date ?? '')
    const [endDate, setEndDate] = useState(habit.habit_end_date ?? '')
    const [icon, setIcon] = useState(habit.habit_icon ?? '')

    const save = useCallback((updates: {
        frequency?: string
        startDate?: string
        endDate?: string
        icon?: string
    }) => {
        const freq = updates.frequency ?? frequency
        const start = updates.startDate ?? startDate
        const end = updates.endDate ?? endDate
        const ic = updates.icon ?? icon
        onUpdate(habit.id, {
            habit_frequency: freq || null,
            habit_start_date: start || null,
            habit_end_date: end || null,
            habit_icon: ic || null,
        })
    }, [habit.id, frequency, startDate, endDate, icon, onUpdate])

    const selectedDays = new Set(parseFrequency(frequency))

    const toggleDay = (key: string) => {
        const next = new Set(selectedDays)
        if (next.has(key)) next.delete(key); else next.add(key)
        const newFreq = HABIT_DAYS.map(d => d.key).filter(k => next.has(k)).join(',')
        setFrequency(newFreq)
        save({ frequency: newFreq })
    }

    const handlePreset = (val: string) => {
        setFrequency(val)
        save({ frequency: val })
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
                <SheetHeader className="pb-2">
                    <SheetTitle className="text-base">
                        {habit.habit_icon || '🔄'} {habit.title}
                    </SheetTitle>
                    <SheetDescription>習慣の設定を変更</SheetDescription>
                </SheetHeader>

                <div className="px-4 pb-6 space-y-5 overflow-y-auto">
                    {/* 曜日設定 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">曜日</label>
                        <div className="flex gap-1.5">
                            {HABIT_DAYS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={cn(
                                        "flex-1 h-9 text-sm rounded-lg font-medium transition-colors",
                                        selectedDays.has(key)
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted/50 text-muted-foreground hover:bg-muted"
                                    )}
                                    onClick={() => toggleDay(key)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            {[
                                { label: '毎日', val: 'mon,tue,wed,thu,fri,sat,sun' },
                                { label: '平日', val: 'mon,tue,wed,thu,fri' },
                                { label: '土日', val: 'sat,sun' },
                            ].map(p => (
                                <button
                                    key={p.val}
                                    type="button"
                                    className={cn(
                                        "flex-1 h-8 text-xs rounded-lg transition-colors",
                                        frequency === p.val
                                            ? "bg-primary/20 text-primary font-medium"
                                            : "text-muted-foreground hover:bg-muted/50 border border-border"
                                    )}
                                    onClick={() => handlePreset(p.val)}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 期間設定 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">期間</label>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 space-y-1">
                                <span className="text-xs text-muted-foreground">開始日</span>
                                <input
                                    type="date"
                                    className="w-full h-9 px-3 text-sm border rounded-lg bg-background"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value)
                                        save({ startDate: e.target.value })
                                    }}
                                />
                            </div>
                            <span className="text-muted-foreground mt-5">〜</span>
                            <div className="flex-1 space-y-1">
                                <span className="text-xs text-muted-foreground">終了日</span>
                                <input
                                    type="date"
                                    className="w-full h-9 px-3 text-sm border rounded-lg bg-background"
                                    value={endDate}
                                    onChange={(e) => {
                                        setEndDate(e.target.value)
                                        save({ endDate: e.target.value })
                                    }}
                                />
                            </div>
                        </div>
                        {startDate && endDate && (
                            <p className="text-xs text-muted-foreground">
                                {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1}日間
                            </p>
                        )}
                    </div>

                    {/* アイコン選択 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">アイコン</label>
                        <div className="flex flex-wrap gap-2">
                            {ICON_OPTIONS.map(ic => (
                                <button
                                    key={ic}
                                    type="button"
                                    className={cn(
                                        "w-10 h-10 text-lg rounded-lg flex items-center justify-center transition-colors",
                                        icon === ic
                                            ? "bg-primary/20 ring-2 ring-primary"
                                            : "bg-muted/50 hover:bg-muted"
                                    )}
                                    onClick={() => {
                                        const newIcon = icon === ic ? '' : ic
                                        setIcon(newIcon)
                                        save({ icon: newIcon })
                                    }}
                                >
                                    {ic}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
