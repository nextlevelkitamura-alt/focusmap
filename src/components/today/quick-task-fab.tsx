"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, Clock, Timer, Calendar, Star, Bell, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PRIORITY_OPTIONS, type Priority } from "@/components/ui/priority-select"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import type { Project } from "@/types/database"

export interface QuickTaskData {
    title: string
    project_id: string | null
    scheduled_at: string | null
    estimated_time: number
    reminders: number[]
    calendar_id: string | null
    priority: number
}

export interface CalendarOption {
    id: string
    name: string
    background_color?: string
}

interface QuickTaskFabProps {
    projects: Project[]
    calendars: CalendarOption[]
    onCreateTask: (data: QuickTaskData) => Promise<void>
}

const DURATION_OPTIONS: Array<{ label: string; value: number }> = [
    { label: "5分", value: 5 },
    { label: "15分", value: 15 },
    { label: "30分", value: 30 },
    { label: "45分", value: 45 },
    { label: "1時間", value: 60 },
    { label: "1時間30分", value: 90 },
    { label: "2時間", value: 120 },
]

const REMINDER_OPTIONS: Array<{ label: string; value: number }> = [
    { label: "開始時刻", value: 0 },
    { label: "5分前", value: 5 },
    { label: "10分前", value: 10 },
    { label: "15分前", value: 15 },
    { label: "30分前", value: 30 },
    { label: "1時間前", value: 60 },
    { label: "通知なし", value: -1 },
]

export function QuickTaskFab({ projects, calendars, onCreateTask }: QuickTaskFabProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Form state
    const [title, setTitle] = useState("")
    const [projectId, setProjectId] = useState<string | null>(null)
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [estimatedTime, setEstimatedTime] = useState(30)
    const [reminder, setReminder] = useState(0)
    const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false)
    const [calendarId, setCalendarId] = useState<string | null>(null)
    const [priority, setPriority] = useState<Priority>(3)

    const titleInputRef = useRef<HTMLInputElement>(null)

    // Auto-focus title input when sheet opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => titleInputRef.current?.focus(), 300)
        }
    }, [isOpen])

    const resetForm = useCallback(() => {
        setTitle("")
        setProjectId(null)
        setScheduledDate(undefined)
        setEstimatedTime(30)
        setReminder(0)
        setIsDurationPickerOpen(false)
        setCalendarId(null)
        setPriority(3)
    }, [])

    const handleScheduledDateChange = useCallback((nextDate: Date | undefined) => {
        setScheduledDate(nextDate)
    }, [])

    const handleSubmit = useCallback(() => {
        if (!title.trim() || isSubmitting) return

        setIsSubmitting(true)

        // 即座にシートを閉じてカレンダーに表示（API保存はバックグラウンド）
        onCreateTask({
            title: title.trim(),
            project_id: projectId,
            scheduled_at: scheduledDate ? scheduledDate.toISOString() : null,
            estimated_time: estimatedTime,
            reminders: reminder >= 0 ? [reminder] : [],
            calendar_id: calendarId,
            priority,
        })

        resetForm()
        setIsOpen(false)
        setIsSubmitting(false)
    }, [title, projectId, scheduledDate, estimatedTime, reminder, calendarId, priority, isSubmitting, onCreateTask, resetForm])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && title.trim()) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit, title])

    const selectedDurationOption = DURATION_OPTIONS.find(option => option.value === estimatedTime)
    const durationSelectValue = selectedDurationOption ? String(selectedDurationOption.value) : "custom"

    const handleDurationSelect = useCallback((value: string) => {
        if (value === "custom") {
            setIsDurationPickerOpen(true)
            return
        }
        setEstimatedTime(Number(value))
    }, [])

    return (
        <>
            {/* FAB Button */}
            <button
                onClick={() => setIsOpen(true)}
                className={cn(
                    "fixed bottom-20 right-4 z-40 md:hidden",
                    "w-14 h-14 rounded-full",
                    "bg-primary text-primary-foreground",
                    "shadow-lg shadow-primary/25",
                    "flex items-center justify-center",
                    "active:scale-95 transition-all duration-150",
                    "hover:shadow-xl hover:shadow-primary/30"
                )}
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Bottom Sheet */}
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] px-4 pb-8">
                    {/* Drag Handle */}
                    <div className="flex justify-center pt-2 pb-1">
                        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                    </div>

                    <SheetHeader className="p-0 pb-3">
                        <SheetTitle className="text-base">タスクを追加</SheetTitle>
                        <SheetDescription className="sr-only">新しいタスクを追加します</SheetDescription>
                    </SheetHeader>

                    <div className="space-y-3">
                        {/* Task Name */}
                        <Input
                            ref={titleInputRef}
                            placeholder="タスク名"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-11 text-base"
                            autoComplete="off"
                        />

                        {/* Project Selection */}
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">プロジェクト（任意）</label>
                            <select
                                value={projectId ?? ""}
                                onChange={(e) => setProjectId(e.target.value || null)}
                                className={cn(
                                    "w-full h-10 px-3 rounded-md border border-input bg-background text-sm",
                                    "focus:outline-none focus:ring-2 focus:ring-ring"
                                )}
                            >
                                <option value="">なし（今日ビュー専用）</option>
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.title}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Start Date/Time */}
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                開始日時
                            </label>
                            <DateTimePicker
                                date={scheduledDate}
                                setDate={handleScheduledDateChange}
                                trigger={
                                    <button
                                        type="button"
                                        className={cn(
                                            "w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-left",
                                            "focus:outline-none focus:ring-2 focus:ring-ring",
                                            "flex items-center gap-2",
                                            !scheduledDate && "text-muted-foreground"
                                        )}
                                    >
                                        <Calendar className="w-4 h-4 flex-shrink-0" />
                                        {scheduledDate
                                            ? format(scheduledDate, "M月d日 (E) HH:mm", { locale: ja })
                                            : "日時を選択"
                                        }
                                    </button>
                                }
                            />
                        </div>

                        {/* Estimated Time */}
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                見積もり時間
                            </label>
                            <div className="relative">
                                <select
                                    value={durationSelectValue}
                                    onChange={(e) => handleDurationSelect(e.target.value)}
                                    className={cn(
                                        "w-full h-10 px-3 pr-9 rounded-md border border-input bg-background text-sm",
                                        "focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                                    )}
                                >
                                    {DURATION_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                    <option value="custom">
                                        {durationSelectValue === "custom"
                                            ? `カスタム (${formatDuration(estimatedTime)})`
                                            : "カスタム"
                                        }
                                    </option>
                                </select>
                                <ChevronDown className="w-4 h-4 text-muted-foreground pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                            </div>
                            <DurationWheelPicker
                                duration={estimatedTime}
                                onDurationChange={setEstimatedTime}
                                open={isDurationPickerOpen}
                                onOpenChange={setIsDurationPickerOpen}
                                trigger={<button type="button" className="hidden" aria-hidden="true" tabIndex={-1} />}
                            />
                        </div>

                        {/* Reminder */}
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Bell className="w-3 h-3" />
                                通知
                            </label>
                            <div className="relative">
                                <select
                                    value={reminder}
                                    onChange={(e) => setReminder(Number(e.target.value))}
                                    className={cn(
                                        "w-full h-10 px-3 pr-9 rounded-md border border-input bg-background text-sm",
                                        "focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                                    )}
                                >
                                    {REMINDER_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="w-4 h-4 text-muted-foreground pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                                {!scheduledDate
                                    ? "通知タイミングは先に選べます。開始日時を設定するとその設定で有効になります"
                                    : "通知は選択したタイミングで有効です"
                                }
                            </p>
                        </div>

                        {/* Calendar + Priority (side by side) */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    カレンダー
                                </label>
                                <select
                                    value={calendarId ?? ""}
                                    onChange={(e) => setCalendarId(e.target.value || null)}
                                    className={cn(
                                        "w-full h-10 px-3 rounded-md border border-input bg-background text-sm",
                                        "focus:outline-none focus:ring-2 focus:ring-ring"
                                    )}
                                >
                                    <option value="">なし</option>
                                    {calendars.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                    <Star className="w-3 h-3" />
                                    優先度
                                </label>
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(Number(e.target.value) as Priority)}
                                    className={cn(
                                        "w-full h-10 px-3 rounded-md border border-input bg-background text-sm",
                                        "focus:outline-none focus:ring-2 focus:ring-ring"
                                    )}
                                >
                                    {Object.values(PRIORITY_OPTIONS).map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <Button
                            onClick={handleSubmit}
                            disabled={!title.trim() || isSubmitting}
                            className="w-full h-11 text-base font-medium"
                        >
                            {isSubmitting ? "追加中..." : "追加する"}
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    )
}
