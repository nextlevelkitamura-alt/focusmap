"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, Timer, Calendar, Bell, ChevronDown, ListTodo, Square, Trash2 } from "lucide-react"
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
    memo?: string | null
    subtask_titles?: string[]
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
    onOpenAiChat?: () => void
    externalOpen?: boolean
    onExternalOpenChange?: (open: boolean) => void
    initialScheduledAt?: Date
    initialEstimatedTime?: number
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

const DEFAULT_PRIORITY = 3

function toDateTimeLocalValue(date: Date | undefined) {
    if (!date) return ""

    const pad = (value: number) => String(value).padStart(2, "0")
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocalValue(value: string) {
    if (!value) return undefined

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
}

export function QuickTaskFab({ calendars, onCreateTask, externalOpen, onExternalOpenChange, initialScheduledAt, initialEstimatedTime }: QuickTaskFabProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const fabRef = useRef<HTMLDivElement>(null)
    const defaultCalendarId = calendars[0]?.id ?? null

    const [title, setTitle] = useState("")
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [estimatedTime, setEstimatedTime] = useState(30)
    const [reminder, setReminder] = useState(0)
    const [isDurationExpanded, setIsDurationExpanded] = useState(false)
    const [isCustomDurationPickerOpen, setIsCustomDurationPickerOpen] = useState(false)
    const [calendarId, setCalendarId] = useState<string | null>(null)
    const [memo, setMemo] = useState("")
    const memoRef = useRef<HTMLTextAreaElement>(null)
    const [subtasks, setSubtasks] = useState<string[]>([])
    const [subtaskInput, setSubtaskInput] = useState("")

    const titleInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!externalOpen) return

        const timer = window.setTimeout(() => {
            if (initialScheduledAt) setScheduledDate(initialScheduledAt)
            if (initialEstimatedTime) setEstimatedTime(initialEstimatedTime)
            setCalendarId(current => current ?? defaultCalendarId)
            setIsOpen(true)
        }, 0)

        return () => window.clearTimeout(timer)
    }, [externalOpen, initialScheduledAt, initialEstimatedTime, defaultCalendarId])

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => titleInputRef.current?.focus(), 300)
        }
    }, [isOpen])

    const closeSheet = useCallback(() => {
        setIsOpen(false)
        onExternalOpenChange?.(false)
    }, [onExternalOpenChange])

    const resetForm = useCallback(() => {
        setTitle("")
        setScheduledDate(undefined)
        setEstimatedTime(30)
        setReminder(0)
        setIsDurationExpanded(false)
        setIsCustomDurationPickerOpen(false)
        setCalendarId(defaultCalendarId)
        setMemo("")
        if (memoRef.current) memoRef.current.style.height = "auto"
        setSubtasks([])
        setSubtaskInput("")
    }, [defaultCalendarId])

    const handleAddSubtask = useCallback(() => {
        const trimmed = subtaskInput.trim()
        if (!trimmed) return
        setSubtasks(prev => [...prev, trimmed])
        setSubtaskInput("")
    }, [subtaskInput])

    const handleRemoveSubtask = useCallback((idx: number) => {
        setSubtasks(prev => prev.filter((_, i) => i !== idx))
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
            project_id: null,
            scheduled_at: scheduledDate ? scheduledDate.toISOString() : null,
            estimated_time: estimatedTime,
            reminders: reminder >= 0 ? [reminder] : [],
            calendar_id: calendarId,
            priority: DEFAULT_PRIORITY,
            memo: memo.trim() || null,
            subtask_titles: subtasks.length > 0 ? subtasks : undefined,
        })

        resetForm()
        closeSheet()
        setIsSubmitting(false)
    }, [title, scheduledDate, estimatedTime, reminder, calendarId, memo, subtasks, isSubmitting, onCreateTask, resetForm, closeSheet])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && title.trim()) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit, title])

    const handleDurationPresetSelect = useCallback((minutes: number) => {
        setEstimatedTime(minutes)
        setIsDurationExpanded(false)
    }, [])

    const handleFabClick = useCallback(() => {
        setCalendarId(current => current ?? defaultCalendarId)
        if (initialScheduledAt) setScheduledDate(initialScheduledAt)
        if (initialEstimatedTime) setEstimatedTime(initialEstimatedTime)
        setIsOpen(true)
    }, [defaultCalendarId, initialEstimatedTime, initialScheduledAt])

    const selectedCalendar = calendars.find(calendar => calendar.id === calendarId)
    const scheduledDateTimeLabel = scheduledDate
        ? format(scheduledDate, "M/d(E) HH:mm", { locale: ja })
        : "未設定"
    const schedulePreview = scheduledDate
        ? `${format(scheduledDate, "M/d(E) HH:mm", { locale: ja })} · ${formatDuration(estimatedTime)}${selectedCalendar ? ` · ${selectedCalendar.name}` : ""}`
        : `日時未設定 · ${formatDuration(estimatedTime)}${selectedCalendar ? ` · ${selectedCalendar.name}` : ""}`

    const fieldClass = cn(
        "min-h-[52px] rounded-xl border border-white/10 bg-white/[0.045] px-3 py-1.5 text-left",
        "transition-colors active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
    )
    const fieldLabelClass = "mb-0.5 flex items-center gap-1 text-[11px] font-medium text-neutral-400"
    const fieldValueClass = "flex min-w-0 items-center gap-1.5 text-sm font-semibold text-neutral-50"
    const selectClass = cn(
        "w-full appearance-none border-0 bg-transparent p-0 pr-5 text-sm font-semibold text-neutral-50 outline-none",
        "focus:ring-0"
    )

    return (
        <>
            <div ref={fabRef} className={cn("fixed bottom-[calc(88px+env(safe-area-inset-bottom,0px))] right-4 z-[70] md:hidden pointer-events-none", isOpen && "hidden")}>
                <button
                    onClick={handleFabClick}
                    className={cn(
                        "h-16 w-16 rounded-full",
                        "bg-[#0b57d0] text-white",
                        "shadow-[0_14px_32px_rgba(11,87,208,0.38)] ring-1 ring-white/15",
                        "flex items-center justify-center pointer-events-auto",
                        "active:scale-95 transition-all duration-150",
                        "hover:bg-[#0a4fc0]"
                    )}
                    aria-label="タスクを追加"
                >
                    <Plus className="h-8 w-8" />
                </button>
            </div>

            <Sheet open={isOpen} onOpenChange={(open) => { if (!open) { closeSheet(); resetForm() } else setIsOpen(true) }}>
                <SheetContent
                    side="bottom"
                    className={cn(
                        "h-[88dvh] max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl border-neutral-800 bg-neutral-950 px-0 pb-0 text-neutral-50",
                        "shadow-[0_-18px_48px_rgba(0,0,0,0.55)]",
                        "[&>button]:right-3 [&>button]:top-3 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center",
                        "[&>button]:rounded-full [&>button]:text-neutral-400 [&>button]:opacity-100 [&>button:hover]:bg-white/10 [&>button:hover]:text-neutral-100 [&>button_svg]:h-5 [&>button_svg]:w-5"
                    )}
                >
                    <div className="flex justify-center pb-0.5 pt-1.5">
                        <div className="w-10 h-1 rounded-full bg-white/20" />
                    </div>

                    <SheetHeader className="px-4 pb-2 pt-0">
                        <div className="flex items-center pr-12">
                            <SheetTitle className="text-base text-neutral-50">カレンダーにタスク追加</SheetTitle>
                        </div>
                        <SheetDescription className="sr-only">新しいタスクを追加します</SheetDescription>
                    </SheetHeader>

                    <div className="min-h-0 flex-1 overflow-hidden px-4 pb-2">
                        <div className="flex min-h-0 flex-col gap-2">
                            <div>
                                <label className="mb-0.5 block text-[11px] font-medium text-neutral-400">タイトル</label>
                                <Input
                                    ref={titleInputRef}
                                    placeholder="例: SNS投稿を作る"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    className={cn(
                                        "h-10 rounded-xl border-white/10 bg-white/[0.055] text-sm text-neutral-50",
                                        "placeholder:text-neutral-500 focus-visible:ring-white/25"
                                    )}
                                    autoComplete="off"
                                />
                            </div>

                            <label className={cn(fieldClass, "relative block pr-9")}>
                                <span className="pointer-events-none block">
                                    <span className={fieldLabelClass}>
                                        <Calendar className="h-3 w-3" />
                                        日時
                                    </span>
                                    <span className={fieldValueClass}>
                                        {scheduledDateTimeLabel}
                                        <ChevronDown className="ml-auto h-3.5 w-3.5 text-neutral-400" />
                                    </span>
                                </span>
                                <input
                                    type="datetime-local"
                                    value={toDateTimeLocalValue(scheduledDate)}
                                    onChange={(e) => handleScheduledDateChange(fromDateTimeLocalValue(e.target.value))}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    aria-label="日時"
                                />
                            </label>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsDurationExpanded(prev => !prev)}
                                    aria-expanded={isDurationExpanded}
                                    className={cn(
                                        fieldClass,
                                        isDurationExpanded && "border-white/25 bg-white/[0.09] ring-1 ring-white/10"
                                    )}
                                >
                                    <span className={fieldLabelClass}>
                                        <Timer className="h-3 w-3" />
                                        所要時間
                                    </span>
                                    <span className={fieldValueClass}>
                                        {formatDuration(estimatedTime)}
                                        <ChevronDown className={cn(
                                            "ml-auto h-3.5 w-3.5 text-neutral-400 transition-transform",
                                            isDurationExpanded && "rotate-180"
                                        )} />
                                    </span>
                                </button>

                                <div className={fieldClass}>
                                    <label className={fieldLabelClass}>
                                        <Bell className="h-3 w-3" />
                                        通知
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={reminder}
                                            onChange={(e) => setReminder(Number(e.target.value))}
                                            className={selectClass}
                                        >
                                            {REMINDER_OPTIONS.map((option) => (
                                                <option className="bg-neutral-950" key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                                    </div>
                                </div>
                            </div>

                            {isDurationExpanded && (
                                <div className="rounded-xl border border-white/10 bg-black px-3 py-2 shadow-inner">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium text-neutral-400">所要時間</span>
                                        <span className="text-xs font-semibold text-neutral-100">{formatDuration(estimatedTime)}</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {DURATION_OPTIONS.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleDurationPresetSelect(option.value)}
                                                className={cn(
                                                    "min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors",
                                                    estimatedTime === option.value
                                                        ? "border-white bg-white text-neutral-950"
                                                        : "border-white/10 bg-white/[0.055] text-neutral-200 active:bg-white/[0.1]"
                                                )}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setIsCustomDurationPickerOpen(true)}
                                            className="min-h-9 rounded-lg border border-white/10 bg-white/[0.055] px-2 text-xs font-semibold text-neutral-200 active:bg-white/[0.1]"
                                        >
                                            カスタム
                                        </button>
                                    </div>
                                </div>
                            )}

                            <DurationWheelPicker
                                duration={estimatedTime}
                                onDurationChange={(minutes) => {
                                    setEstimatedTime(minutes)
                                    setIsDurationExpanded(false)
                                }}
                                open={isCustomDurationPickerOpen}
                                onOpenChange={setIsCustomDurationPickerOpen}
                                trigger={<button type="button" className="hidden" aria-hidden="true" tabIndex={-1} />}
                            />

                            <div className={fieldClass}>
                                <label className={fieldLabelClass}>
                                    <Calendar className="h-3 w-3" />
                                    追加先カレンダー
                                </label>
                                <div className="relative flex items-center gap-2">
                                    {selectedCalendar?.background_color && (
                                        <span
                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: selectedCalendar.background_color }}
                                        />
                                    )}
                                    <select
                                        value={calendarId ?? ""}
                                        onChange={(e) => setCalendarId(e.target.value || null)}
                                        className={selectClass}
                                    >
                                        <option className="bg-neutral-950" value="">なし</option>
                                        {calendars.map((c) => (
                                            <option className="bg-neutral-950" key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                                </div>
                            </div>

                            <div className={cn(fieldClass, "min-h-0")}>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <label className={fieldLabelClass}>
                                        <ListTodo className="h-3 w-3" />
                                        サブタスク
                                    </label>
                                    <span className="text-xs font-semibold text-neutral-100">{subtasks.length}件</span>
                                </div>
                                {subtasks.length > 0 && (
                                    <div className="mb-1.5 max-h-24 space-y-1 overflow-y-auto overscroll-contain pr-0.5">
                                        {subtasks.map((st, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2.5 py-1.5"
                                            >
                                                <Square className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
                                                <span className="flex-1 truncate text-sm text-neutral-100">{st}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveSubtask(idx)}
                                                    className="shrink-0 rounded p-1 text-neutral-400 active:bg-white/10 active:text-red-300"
                                                    aria-label="サブタスクを削除"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={subtaskInput}
                                        onChange={(e) => setSubtaskInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && subtaskInput.trim()) {
                                                e.preventDefault()
                                                handleAddSubtask()
                                            }
                                        }}
                                        placeholder="サブタスクを追加..."
                                        className="h-10 flex-1 rounded-xl border-white/10 bg-white/[0.045] text-sm text-neutral-50 placeholder:text-neutral-500 focus-visible:ring-white/25"
                                        autoComplete="off"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddSubtask}
                                        disabled={!subtaskInput.trim()}
                                        className={cn(
                                            "h-10 w-10 shrink-0 rounded-xl border border-white/10 transition-colors",
                                            "flex items-center justify-center",
                                            subtaskInput.trim()
                                                ? "bg-white text-neutral-950 active:bg-neutral-200"
                                                : "bg-white/[0.04] text-neutral-600"
                                        )}
                                        aria-label="サブタスクを追加"
                                    >
                                        <Plus className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="mb-0.5 block text-[11px] font-medium text-neutral-400">メモ（任意）</label>
                                <textarea
                                    ref={memoRef}
                                    placeholder="メモを入力..."
                                    value={memo}
                                    onChange={(e) => {
                                        setMemo(e.target.value)
                                        e.target.style.height = "auto"
                                        e.target.style.height = `${e.target.scrollHeight}px`
                                    }}
                                    rows={1}
                                    className={cn(
                                        "w-full resize-none overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-relaxed text-neutral-50",
                                        "placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/25"
                                    )}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 border-t border-white/10 bg-neutral-950 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-1.5">
                        <div className="mb-1.5 truncate text-center text-[11px] text-neutral-400">
                            {schedulePreview}
                        </div>
                        <Button
                            onClick={handleSubmit}
                            disabled={!title.trim() || isSubmitting}
                            className={cn(
                                "h-11 w-full rounded-xl text-base font-semibold",
                                !title.trim() || isSubmitting
                                    ? "bg-white/10 text-neutral-500"
                                    : "bg-white text-neutral-950 hover:bg-neutral-200 active:bg-neutral-300"
                            )}
                        >
                            {isSubmitting ? "追加中..." : "保存"}
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    )
}
