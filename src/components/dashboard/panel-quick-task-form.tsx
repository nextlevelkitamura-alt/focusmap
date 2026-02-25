"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, X, Clock, ChevronDown } from "lucide-react"
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

export function PanelQuickTaskForm(props: PanelQuickTaskFormProps) {
    const { calendars, onCreateTask, isOpen: controlledIsOpen, onClose } = props
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
    }, [title, scheduledDate, estimatedTime, calendarId, isSubmitting, onCreateTask, resetForm, setIsOpen])

    // Enter to submit, Escape to close
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
            e.preventDefault()
            handleSubmit()
        } else if (e.key === 'Escape') {
            setIsOpen(false)
            resetForm()
        }
    }, [handleSubmit, title, resetForm, setIsOpen])

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
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-md animate-in slide-in-from-bottom-2 duration-200 shadow-[0_-8px_24px_rgba(0,0,0,0.24)]">
            <div className="px-3 py-3 space-y-2.5" onKeyDown={handleKeyDown}>
                <div className="flex items-center gap-2">
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="h-12 flex-1 px-4 text-xl border-2 border-border/80 rounded-2xl bg-background/95 focus:outline-none focus:ring-2 focus:ring-primary/70 focus:border-primary/50"
                        placeholder="タスク名を入力..."
                    />
                    <button
                        onClick={() => { setIsOpen(false); resetForm() }}
                        className="w-10 h-10 rounded-full hover:bg-muted transition-colors text-muted-foreground flex-shrink-0"
                        aria-label="タスク追加フォームを閉じる"
                    >
                        <X className="w-5 h-5 mx-auto" />
                    </button>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,90px)_minmax(0,1fr)_84px] gap-2">
                    <DateTimePicker
                        date={scheduledDate}
                        setDate={setScheduledDate}
                        trigger={
                            <button
                                type="button"
                                className="h-10 min-w-0 flex items-center gap-1.5 px-3 text-base border rounded-xl bg-background hover:bg-muted transition-colors"
                            >
                                <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                {scheduledDate
                                    ? format(scheduledDate, "M/d HH:mm", { locale: ja })
                                    : "日時"
                                }
                            </button>
                        }
                    />

                    <DurationWheelPicker
                        duration={estimatedTime}
                        onDurationChange={setEstimatedTime}
                        trigger={
                            <button
                                type="button"
                                className="h-10 w-full min-w-0 flex items-center justify-center gap-1 px-2 text-base border rounded-xl bg-background hover:bg-muted transition-colors"
                            >
                                {formatDuration(estimatedTime)}
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            </button>
                        }
                    />

                    {calendars.length > 0 && (
                        <select
                            value={calendarId || ''}
                            onChange={(e) => setCalendarId(e.target.value || null)}
                            className="h-10 min-w-0 px-3 text-base border rounded-xl bg-background hover:bg-muted transition-colors appearance-none cursor-pointer truncate"
                        >
                            <option value="">カレンダー</option>
                            {calendars.map(cal => (
                                <option key={cal.id} value={cal.id}>{cal.name}</option>
                            ))}
                        </select>
                    )}
                    {calendars.length === 0 && (
                        <div className="h-10 min-w-0 px-3 text-base border rounded-xl bg-muted/30 text-muted-foreground flex items-center truncate">
                            カレンダー
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={!title.trim() || isSubmitting}
                        className={cn(
                            "h-10 text-base font-medium rounded-xl transition-colors",
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
