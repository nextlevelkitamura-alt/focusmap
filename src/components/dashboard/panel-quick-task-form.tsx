"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, X, Clock, Calendar, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import type { Project } from "@/types/database"
import type { QuickTaskData, CalendarOption } from "@/components/today/quick-task-fab"

// --- Component ---

interface PanelQuickTaskFormProps {
    projects: Project[]
    calendars: CalendarOption[]
    onCreateTask: (data: QuickTaskData) => Promise<void>
    isOpen?: boolean
    onClose?: () => void
}

export function PanelQuickTaskForm({ projects, calendars, onCreateTask, isOpen: controlledIsOpen, onClose }: PanelQuickTaskFormProps) {
    const [internalIsOpen, setInternalIsOpen] = useState(false)
    const isControlled = controlledIsOpen !== undefined
    const isOpen = isControlled ? controlledIsOpen : internalIsOpen
    const setIsOpen = useCallback((v: boolean) => {
        if (isControlled) {
            if (!v) onClose?.()
        } else {
            setInternalIsOpen(v)
        }
    }, [isControlled, onClose])
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Form state
    const [title, setTitle] = useState("")
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [estimatedTime, setEstimatedTime] = useState(30)
    const [calendarId, setCalendarId] = useState<string | null>(null)

    const titleInputRef = useRef<HTMLInputElement>(null)

    // Auto-focus when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => titleInputRef.current?.focus(), 100)
        }
    }, [isOpen])

    // Reset form
    const resetForm = useCallback(() => {
        setTitle("")
        setScheduledDate(undefined)
        setEstimatedTime(30)
        setCalendarId(null)
    }, [])

    // Handle submit
    const handleSubmit = useCallback(async () => {
        if (!title.trim() || isSubmitting) return
        setIsSubmitting(true)
        try {
            await onCreateTask({
                title: title.trim(),
                project_id: null,
                scheduled_at: scheduledDate?.toISOString() || null,
                estimated_time: estimatedTime,
                reminders: [0],
                calendar_id: calendarId,
                priority: 3,
            })
            resetForm()
            setIsOpen(false)
        } catch (err) {
            console.error('[PanelQuickTaskForm] Create error:', err)
        } finally {
            setIsSubmitting(false)
        }
    }, [title, scheduledDate, estimatedTime, calendarId, isSubmitting, onCreateTask, resetForm])

    // Enter to submit, Escape to close
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
            e.preventDefault()
            handleSubmit()
        } else if (e.key === 'Escape') {
            setIsOpen(false)
            resetForm()
        }
    }, [handleSubmit, title, resetForm])

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="p-1 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground flex-shrink-0"
                title="タスクを追加"
            >
                <Plus className="w-4 h-4" />
            </button>
        )
    }

    return (
        <div className="border-b border-border/30 bg-background/60 animate-in slide-in-from-top-2 duration-200">
            <div className="px-3 py-2 space-y-2" onKeyDown={handleKeyDown}>
                {/* Title input */}
                <div className="flex items-center gap-1.5">
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="タスク名を入力..."
                    />
                    <button
                        onClick={() => { setIsOpen(false); resetForm() }}
                        className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground flex-shrink-0"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Options row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Date/Time */}
                    <DateTimePicker
                        date={scheduledDate}
                        setDate={setScheduledDate}
                        trigger={
                            <button
                                type="button"
                                className="flex items-center gap-1 px-2 py-1 text-[10px] border rounded-md bg-background hover:bg-muted transition-colors"
                            >
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                {scheduledDate
                                    ? format(scheduledDate, "M/d HH:mm", { locale: ja })
                                    : "日時"
                                }
                            </button>
                        }
                    />

                    {/* Duration */}
                    <DurationWheelPicker
                        duration={estimatedTime}
                        onDurationChange={setEstimatedTime}
                        trigger={
                            <button
                                type="button"
                                className="flex items-center gap-1 px-2 py-1 text-[10px] border rounded-md bg-background hover:bg-muted transition-colors"
                            >
                                {formatDuration(estimatedTime)}
                                <ChevronDown className="w-3 h-3 text-muted-foreground" />
                            </button>
                        }
                    />

                    {/* Calendar */}
                    {calendars.length > 0 && (
                        <select
                            value={calendarId || ''}
                            onChange={(e) => setCalendarId(e.target.value || null)}
                            className="px-2 py-1 text-[10px] border rounded-md bg-background hover:bg-muted transition-colors appearance-none cursor-pointer max-w-[120px] truncate"
                        >
                            <option value="">カレンダー</option>
                            {calendars.map(cal => (
                                <option key={cal.id} value={cal.id}>{cal.name}</option>
                            ))}
                        </select>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleSubmit}
                        disabled={!title.trim() || isSubmitting}
                        className={cn(
                            "ml-auto px-3 py-1 text-[10px] font-medium rounded-md transition-colors",
                            !title.trim() || isSubmitting
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                    >
                        {isSubmitting ? '追加中...' : '追加'}
                    </button>
                </div>
            </div>
        </div>
    )
}
