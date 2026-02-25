"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, X, Clock, Timer, Bell, Calendar, Star, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import { PRIORITY_OPTIONS, type Priority } from "@/components/ui/priority-select"
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
    const { projects, calendars, onCreateTask, isOpen: controlledIsOpen, onClose } = props
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
    const [projectId, setProjectId] = useState<string | null>(null)
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [estimatedTime, setEstimatedTime] = useState(30)
    const [reminder, setReminder] = useState(0)
    const [calendarId, setCalendarId] = useState<string | null>(null)
    const [priority, setPriority] = useState<Priority>(3)
    const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false)

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
        setProjectId(null)
        setScheduledDate(undefined)
        setEstimatedTime(30)
        setReminder(0)
        setCalendarId(null)
        setPriority(3)
        setIsDurationPickerOpen(false)
    }, [])

    // Handle submit
    const handleSubmit = useCallback(async () => {
        if (!title.trim() || isSubmitting) return
        setIsSubmitting(true)
        try {
            await onCreateTask({
                title: title.trim(),
                project_id: projectId,
                scheduled_at: scheduledDate?.toISOString() || null,
                estimated_time: estimatedTime,
                reminders: reminder >= 0 ? [reminder] : [],
                calendar_id: calendarId,
                priority,
            })
            resetForm()
            setIsOpen(false)
        } catch (err) {
            console.error('[PanelQuickTaskForm] Create error:', err)
        } finally {
            setIsSubmitting(false)
        }
    }, [title, projectId, scheduledDate, estimatedTime, reminder, calendarId, priority, isSubmitting, onCreateTask, resetForm, setIsOpen])

    // Escape to close
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false)
            resetForm()
        }
    }, [resetForm, setIsOpen])

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

    const selectedDurationLabel = `${formatDuration(estimatedTime)}`

    return (
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-md animate-in slide-in-from-bottom-2 duration-200 shadow-[0_-8px_24px_rgba(0,0,0,0.24)]">
            <div className="max-h-[68vh] overflow-y-auto px-4 py-4 space-y-3.5" onKeyDown={handleKeyDown}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">タスクを追加</h3>
                    <button
                        onClick={() => { setIsOpen(false); resetForm() }}
                        className="w-10 h-10 rounded-full hover:bg-muted transition-colors text-muted-foreground flex-shrink-0"
                        aria-label="タスク追加フォームを閉じる"
                    >
                        <X className="w-5 h-5 mx-auto" />
                    </button>
                </div>

                <div>
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="h-11 w-full px-4 text-base border border-border/80 rounded-xl bg-background/95 focus:outline-none focus:ring-2 focus:ring-primary/70 focus:border-primary/50"
                        placeholder="タスク名"
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">プロジェクト（任意）</label>
                    <select
                        value={projectId ?? ""}
                        onChange={(e) => setProjectId(e.target.value || null)}
                        className="h-11 w-full px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        <option value="">なし（今日ビュー専用）</option>
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>{project.title}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        開始日時
                    </label>
                    <DateTimePicker
                        date={scheduledDate}
                        setDate={setScheduledDate}
                        trigger={
                            <button
                                type="button"
                                className="h-11 w-full min-w-0 flex items-center gap-2 px-3 text-sm border rounded-xl bg-background hover:bg-muted transition-colors"
                            >
                                <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                {scheduledDate
                                    ? format(scheduledDate, "M月d日 (E) HH:mm", { locale: ja })
                                    : "日時を選択"
                                }
                            </button>
                        }
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Timer className="w-4 h-4" />
                        見積もり時間
                    </label>
                    <DurationWheelPicker
                        duration={estimatedTime}
                        onDurationChange={setEstimatedTime}
                        open={isDurationPickerOpen}
                        onOpenChange={setIsDurationPickerOpen}
                        trigger={
                            <button
                                type="button"
                                className="h-11 w-full min-w-0 flex items-center justify-between px-3 text-sm border rounded-xl bg-background hover:bg-muted transition-colors"
                            >
                                {selectedDurationLabel}
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            </button>
                        }
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Bell className="w-4 h-4" />
                        通知
                    </label>
                    <div className="relative">
                        <select
                            value={reminder}
                            onChange={(e) => setReminder(Number(e.target.value))}
                            className="h-11 w-full px-3 pr-9 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
                        >
                            <option value={0}>開始時刻</option>
                            <option value={5}>5分前</option>
                            <option value={10}>10分前</option>
                            <option value={15}>15分前</option>
                            <option value={30}>30分前</option>
                            <option value={60}>1時間前</option>
                            <option value={-1}>通知なし</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-muted-foreground pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {!scheduledDate
                            ? "通知タイミングは先に選べます。開始日時を設定するとその設定で有効になります"
                            : "通知は選択したタイミングで有効です"
                        }
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">カレンダー</label>
                        <select
                            value={calendarId ?? ''}
                            onChange={(e) => setCalendarId(e.target.value || null)}
                            className="h-11 w-full px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring truncate"
                        >
                            <option value="">なし</option>
                            {calendars.map(cal => (
                                <option key={cal.id} value={cal.id}>{cal.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                            <Star className="w-4 h-4" />
                            優先度
                        </label>
                        <select
                            value={priority}
                            onChange={(e) => setPriority(Number(e.target.value) as Priority)}
                            className="h-11 w-full px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            {Object.values(PRIORITY_OPTIONS).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || isSubmitting}
                    className={cn(
                        "h-12 w-full text-base font-medium rounded-xl transition-colors",
                        !title.trim() || isSubmitting
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                >
                    {isSubmitting ? '追加中...' : '追加する'}
                </button>
            </div>
        </div>
    )
}
