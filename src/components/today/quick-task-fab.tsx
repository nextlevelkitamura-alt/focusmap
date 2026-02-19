"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, Clock, Timer, Calendar, Star } from "lucide-react"
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
import { ESTIMATED_TIME_OPTIONS, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import type { Project } from "@/types/database"

export interface QuickTaskData {
    title: string
    project_id: string | null
    scheduled_at: string | null
    estimated_time: number
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

export function QuickTaskFab({ projects, calendars, onCreateTask }: QuickTaskFabProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Form state
    const [title, setTitle] = useState("")
    const [projectId, setProjectId] = useState<string | null>(null)
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [estimatedTime, setEstimatedTime] = useState(0)
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
        setEstimatedTime(0)
        setCalendarId(null)
        setPriority(3)
    }, [])

    const handleSubmit = useCallback(async () => {
        if (!title.trim() || isSubmitting) return

        setIsSubmitting(true)
        try {
            await onCreateTask({
                title: title.trim(),
                project_id: projectId,
                scheduled_at: scheduledDate ? scheduledDate.toISOString() : null,
                estimated_time: estimatedTime,
                calendar_id: calendarId,
                priority,
            })

            resetForm()
            setIsOpen(false)
        } finally {
            setIsSubmitting(false)
        }
    }, [title, projectId, scheduledDate, estimatedTime, calendarId, priority, isSubmitting, onCreateTask, resetForm])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && title.trim()) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit, title])

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
                                setDate={setScheduledDate}
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
                            <select
                                value={estimatedTime}
                                onChange={(e) => setEstimatedTime(Number(e.target.value))}
                                className={cn(
                                    "w-full h-10 px-3 rounded-md border border-input bg-background text-sm",
                                    "focus:outline-none focus:ring-2 focus:ring-ring"
                                )}
                            >
                                <option value={0}>なし</option>
                                {ESTIMATED_TIME_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
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
