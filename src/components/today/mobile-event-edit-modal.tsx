"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { X, Calendar as CalendarIcon, ChevronDown, Play, Pause, Timer, Trash2, StickyNote, Bell, Plus, CheckSquare, Square, Loader2, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import type { TimeBlock } from "@/lib/time-block"
import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"

// --- Types ---

type EditTarget = TimeBlock

interface MobileEventEditModalProps {
    target: EditTarget | null
    isOpen: boolean
    onClose: () => void
    onSaveTask: (taskId: string, updates: { title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string; memo?: string | null; reminders?: number[] }) => Promise<void>
    onSaveEvent: (eventId: string, updates: { title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string; originalCalendarId?: string; reminders?: number[]; description?: string }) => Promise<void>
    onDeleteTask?: (taskId: string) => void | Promise<void>
    onDeleteEvent?: (eventId: string, googleEventId: string, calendarId: string) => void | Promise<void>
    availableCalendars: { id: string; name: string; background_color?: string }[]
    onScheduleReminder?: (targetType: 'task' | 'event', targetId: string, scheduledAt: Date, title: string, advanceMinutes: number) => void
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    childTasks?: Task[]
    onToggleSubTask?: (taskId: string) => Promise<void>
    onDeleteSubTask?: (taskId: string) => Promise<void>
    onConvertEventToTask?: (event: CalendarEvent) => Promise<Task | null>
}

// --- Time helpers ---

function toTimeString(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const BASE_REMINDER_OPTIONS = [
    { label: 'なし', value: -1 },
    { label: '予定の時刻', value: 0 },
    { label: '1分前', value: 1 },
    { label: '5分前', value: 5 },
    { label: '10分前', value: 10 },
    { label: '15分前', value: 15 },
    { label: '30分前', value: 30 },
    { label: '1時間前', value: 60 },
]

const DURATION_OPTIONS: Array<{ label: string; value: number }> = [
    { label: "5分", value: 5 },
    { label: "15分", value: 15 },
    { label: "30分", value: 30 },
    { label: "45分", value: 45 },
    { label: "1時間", value: 60 },
    { label: "1時間30分", value: 90 },
    { label: "2時間", value: 120 },
]

const LOCAL_SUBTASK_ID_PREFIX = "local-subtask-"

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

// --- Main Component ---

export function MobileEventEditModal({
    target,
    isOpen,
    onClose,
    onSaveTask,
    onSaveEvent,
    onDeleteTask,
    onDeleteEvent,
    availableCalendars,
    onScheduleReminder,
    onCreateSubTask,
    childTasks = [],
    onToggleSubTask,
    onDeleteSubTask,
    onConvertEventToTask,
}: MobileEventEditModalProps) {
    const [title, setTitle] = useState('')
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [duration, setDuration] = useState(60)
    const [calendarId, setCalendarId] = useState('')
    const [memo, setMemo] = useState('')
    const [eventDescription, setEventDescription] = useState('')
    const [reminder, setReminder] = useState(-1)
    const [isDurationExpanded, setIsDurationExpanded] = useState(false)
    const [isCustomDurationPickerOpen, setIsCustomDurationPickerOpen] = useState(false)
    const [subtaskInput, setSubtaskInput] = useState('')
    const [isAddingSubTask, setIsAddingSubTask] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null)
    const [localChildTasks, setLocalChildTasks] = useState<Task[]>(childTasks)

    const timer = useTimer()
    const sheetRef = useRef<HTMLDivElement>(null)
    const dragStartY = useRef(0)
    const currentTranslateY = useRef(0)
    const openedAtRef = useRef(0)
    const defaultCalendarId = availableCalendars[0]?.id ?? ''
    const reminderOptions = useMemo(() => {
        if (BASE_REMINDER_OPTIONS.some(opt => opt.value === reminder)) {
            return BASE_REMINDER_OPTIONS
        }
        if (reminder < 0) {
            return BASE_REMINDER_OPTIONS
        }
        return [...BASE_REMINDER_OPTIONS, { label: `${reminder}分前`, value: reminder }]
    }, [reminder])

    // モーダルが開いた瞬間を記録（ゴーストクリック防止）
    useEffect(() => {
        if (isOpen) {
            openedAtRef.current = Date.now()
        }
    }, [isOpen])

    // ゴーストクリック防止付きclose
    const safeClose = useCallback(() => {
        if (Date.now() - openedAtRef.current < 400) return
        onClose()
    }, [onClose])

    // Initialize form when target changes
    useEffect(() => {
        if (!target) return

        setTitle(target.title)
        setScheduledDate(new Date(target.startTime))
        setCalendarId(target.calendarId || defaultCalendarId)
        setMemo(target.originalTask?.memo || '')
        setEventDescription(target.originalEvent?.description || '')
        setSubtaskInput('')
        setLinkedTaskId(target.taskId || null)
        setLocalChildTasks([])
        setIsDurationExpanded(false)
        setIsCustomDurationPickerOpen(false)
        if (target.source === 'task') {
            setDuration(target.estimatedTime || 60)
        } else {
            const dur = Math.round((target.endTime.getTime() - target.startTime.getTime()) / 60000)
            setDuration(dur)
        }

        // Googleイベント: 未設定は「なし」、設定済みはその値を表示
        const eventReminders = target.originalEvent?.reminders
        if (target.source === 'google_event') {
            if (eventReminders && eventReminders.length > 0) {
                setReminder(eventReminders[0])
            } else {
                setReminder(-1)
            }
        } else {
            setReminder(15)
        }
    }, [target, defaultCalendarId])

    // childTasks prop が更新されたときにローカル状態を同期
    // 親が `?? []` で毎レンダー新配列を渡すため、内容が同じなら setState を skip して
    // 無限ループを防ぐ（React は setState で同一参照を返すと再レンダーをスキップする）
    useEffect(() => {
        setLocalChildTasks(prev => {
            const localDrafts = prev
                .filter(task => task.id.startsWith(LOCAL_SUBTASK_ID_PREFIX))
                .filter(draft => !childTasks.some(task => task.title === draft.title && task.parent_task_id === draft.parent_task_id))
            const next = [...childTasks, ...localDrafts]

            if (prev.length !== next.length) return next
            for (let i = 0; i < prev.length; i++) {
                if (
                    prev[i].id !== next[i].id ||
                    prev[i].status !== next[i].status ||
                    prev[i].title !== next[i].title
                ) {
                    return next
                }
            }
            return prev
        })
    }, [childTasks])

    const handleAddSubTask = useCallback(async () => {
        const trimmed = subtaskInput.trim()
        if (!trimmed || !onCreateSubTask) return

        const optimisticId = `${LOCAL_SUBTASK_ID_PREFIX}${crypto.randomUUID()}`
        const nowIso = new Date().toISOString()
        let parentId = linkedTaskId ?? (target?.source === 'task' ? target.taskId ?? null : null)
        const optimisticTask: Task = {
            id: optimisticId,
            user_id: target?.originalTask?.user_id ?? '',
            project_id: target?.projectId ?? target?.originalTask?.project_id ?? null,
            parent_task_id: parentId,
            is_group: false,
            title: trimmed,
            status: 'todo',
            stage: 'plan',
            priority: null,
            order_index: localChildTasks.length,
            scheduled_at: null,
            estimated_time: 0,
            actual_time_minutes: 0,
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: null,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            created_at: nowIso,
            updated_at: nowIso,
            source: 'manual',
            deleted_at: null,
            google_event_fingerprint: null,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
            memo_images: null,
            node_width: null,
        }

        setLocalChildTasks(prev => [...prev, optimisticTask])
        setSubtaskInput('')
        setIsAddingSubTask(true)

        try {
            if (!parentId && target?.source !== 'task' && target?.originalEvent && onConvertEventToTask) {
                const task = await onConvertEventToTask(target.originalEvent)
                if (!task) throw new Error('Failed to convert event to task')

                parentId = task.id
                setLinkedTaskId(task.id)
                setLocalChildTasks(prev => prev.map(t =>
                    t.id === optimisticId ? { ...t, parent_task_id: task.id, project_id: task.project_id } : t
                ))
            }

            if (!parentId) throw new Error('Missing parent task id')

            await onCreateSubTask(parentId, trimmed)
        } catch (err) {
            console.error('[MobileEventEditModal] Add subtask error:', err)
            setLocalChildTasks(prev => prev.filter(t => t.id !== optimisticId))
            setSubtaskInput(trimmed)
        } finally {
            setIsAddingSubTask(false)
        }
    }, [subtaskInput, linkedTaskId, target, onConvertEventToTask, onCreateSubTask, localChildTasks.length])

    const handleToggleSubTask = useCallback(async (taskId: string) => {
        if (!onToggleSubTask) return
        setLocalChildTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t
        ))
        await onToggleSubTask(taskId)
    }, [onToggleSubTask])

    const handleDeleteSubTask = useCallback(async (taskId: string) => {
        const previousTasks = localChildTasks
        const targetTask = localChildTasks.find(task => task.id === taskId)
        setLocalChildTasks(prev => prev.filter(task => task.id !== taskId))

        if (!targetTask || taskId.startsWith(LOCAL_SUBTASK_ID_PREFIX)) return

        try {
            if (!onDeleteSubTask) throw new Error('Missing subtask delete handler')
            await onDeleteSubTask(taskId)
        } catch (err) {
            console.error('[MobileEventEditModal] Delete subtask error:', err)
            setLocalChildTasks(previousTasks)
        }
    }, [localChildTasks, onDeleteSubTask])

    const handleDurationPresetSelect = useCallback((minutes: number) => {
        setDuration(minutes)
        setIsDurationExpanded(false)
    }, [])

    // Handle swipe down to close
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0]
        dragStartY.current = touch.clientY
        currentTranslateY.current = 0
    }, [])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0]
        const diff = touch.clientY - dragStartY.current
        if (diff > 0 && sheetRef.current) {
            currentTranslateY.current = diff
            sheetRef.current.style.transform = `translateY(${diff}px)`
        }
    }, [])

    const handleTouchEnd = useCallback(() => {
        if (sheetRef.current) {
            if (currentTranslateY.current > 100) {
                safeClose()
            } else {
                sheetRef.current.style.transform = 'translateY(0)'
            }
            currentTranslateY.current = 0
        }
    }, [safeClose])

    // Save handler — 即座に閉じ、保存はバックグラウンドで実行
    const handleSave = () => {
        if (!target || !scheduledDate) return

        onClose()

        if (target.source === 'task') {
            onSaveTask(target.taskId!, {
                title,
                scheduled_at: scheduledDate.toISOString(),
                estimated_time: duration,
                calendar_id: calendarId || undefined,
                memo: memo || null,
                reminders: reminder >= 0 ? [reminder] : [],
            }).catch(err => {
                console.error('[MobileEventEditModal] Save task error:', err)
            })
        } else {
            const newEnd = new Date(scheduledDate.getTime() + duration * 60000)

            onSaveEvent(target.id, {
                title,
                start_time: scheduledDate.toISOString(),
                end_time: newEnd.toISOString(),
                googleEventId: target.googleEventId || '',
                calendarId: calendarId || target.calendarId || '',
                originalCalendarId: target.calendarId || undefined,
                reminders: reminder >= 0 ? [reminder] : [],
                description: eventDescription,
            }).catch(err => {
                console.error('[MobileEventEditModal] Save event error:', err)
            })
        }

        // リマインダーのスケジュール（reminder >= 0: 「予定の時刻」(0) もスケジュール対象）
        if (reminder >= 0 && onScheduleReminder && scheduledDate) {
            const targetType = target.source === 'task' ? 'task' as const : 'event' as const
            const targetId = target.source === 'task' ? target.taskId! : target.id
            const reminderAt = new Date(scheduledDate.getTime() - reminder * 60000)
            onScheduleReminder(targetType, targetId, reminderAt, title, reminder)
        }
    }

    // Delete handler
    const handleDelete = useCallback(async () => {
        if (!target) return

        setIsDeleting(true)
        onClose()
        try {
            if (target.source === 'task') {
                await onDeleteTask?.(target.taskId!)
            } else {
                if (!target.googleEventId || !target.calendarId) {
                    throw new Error('削除対象のカレンダー予定を特定できませんでした')
                }
                await onDeleteEvent?.(target.id, target.googleEventId, target.calendarId)
            }
        } catch (err) {
            console.error('[MobileEventEditModal] Delete error:', err)
            const message = err instanceof Error ? err.message : '予定の削除に失敗しました'
            window.alert(message)
        } finally {
            setIsDeleting(false)
        }
    }, [target, onDeleteTask, onDeleteEvent, onClose])

    // 終了時刻の計算
    const endTimeStr = scheduledDate
        ? toTimeString(new Date(scheduledDate.getTime() + duration * 60000))
        : '--:--'

    if (!isOpen || !target) return null

    const isTask = target.source === 'task'
    const selectedCalendar = availableCalendars.find(c => c.id === calendarId)
    const scheduledDateTimeLabel = scheduledDate
        ? format(scheduledDate, "M/d(E) HH:mm", { locale: ja })
        : "未設定"
    const schedulePreview = scheduledDate
        ? `${format(scheduledDate, "M/d(E) HH:mm", { locale: ja })}〜${endTimeStr} · ${formatDuration(duration)}${selectedCalendar ? ` · ${selectedCalendar.name}` : ""}`
        : `日時未設定 · ${formatDuration(duration)}${selectedCalendar ? ` · ${selectedCalendar.name}` : ""}`
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
            <div
                className="fixed inset-0 z-[60] bg-black/60 animate-in fade-in duration-200"
                onClick={safeClose}
            />

            <div
                ref={sheetRef}
                className="fixed inset-x-0 bottom-0 z-[60] flex h-[88dvh] max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-950 text-neutral-50 shadow-[0_-18px_48px_rgba(0,0,0,0.55)] animate-in slide-in-from-bottom duration-300"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="flex flex-shrink-0 justify-center pb-0.5 pt-1.5">
                    <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                <div className="relative flex flex-shrink-0 items-center px-4 pb-2 pt-0">
                    <h3 className="pr-12 text-base font-semibold text-neutral-50">
                        {isTask ? "タスクを編集" : "予定を編集"}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-3 top-0 flex h-11 w-11 items-center justify-center rounded-full text-neutral-400 transition-colors active:bg-white/10 active:text-neutral-100"
                        aria-label="閉じる"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden px-4 pb-2">
                    <div className="flex min-h-0 flex-col gap-2">
                    <div>
                        <label className="mb-0.5 block text-[11px] font-medium text-neutral-400">タイトル</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={(e) => {
                                const nativeEvent = e.nativeEvent
                                if (e.key !== 'Enter' || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
                                e.preventDefault()
                                if (title.trim() && !isDeleting) handleSave()
                            }}
                            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/25"
                            placeholder="例: SNS投稿を作る"
                        />
                    </div>

                    <label className={cn(fieldClass, "relative block pr-9")}>
                        <span className="pointer-events-none block">
                            <span className={fieldLabelClass}>
                                <CalendarIcon className="h-3 w-3" />
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
                            onChange={(e) => setScheduledDate(fromDateTimeLocalValue(e.target.value))}
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
                                {formatDuration(duration)}
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
                                    {reminderOptions.map(opt => (
                                        <option className="bg-neutral-950" key={opt.value} value={opt.value}>
                                            {opt.label}
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
                                <span className="text-xs font-semibold text-neutral-100">{formatDuration(duration)}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                                {DURATION_OPTIONS.map(option => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleDurationPresetSelect(option.value)}
                                        className={cn(
                                            "min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors",
                                            duration === option.value
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
                        duration={duration}
                        onDurationChange={(minutes) => {
                            setDuration(minutes)
                            setIsDurationExpanded(false)
                        }}
                        open={isCustomDurationPickerOpen}
                        onOpenChange={setIsCustomDurationPickerOpen}
                        trigger={<button type="button" className="hidden" aria-hidden="true" tabIndex={-1} />}
                    />

                    {availableCalendars.length > 0 && (
                        <div className={fieldClass}>
                            <label className={fieldLabelClass}>
                                <CalendarIcon className="h-3 w-3" />
                                追加先カレンダー
                            </label>
                            <div className="relative flex items-center gap-2">
                                {selectedCalendar && (
                                    <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: selectedCalendar.background_color || '#4285F4' }}
                                    />
                                )}
                                <select
                                    value={calendarId}
                                    onChange={(e) => setCalendarId(e.target.value)}
                                    className={selectClass}
                                >
                                    {isTask && <option className="bg-neutral-950" value="">なし</option>}
                                    {availableCalendars.map(cal => (
                                        <option className="bg-neutral-950" key={cal.id} value={cal.id}>
                                            {cal.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                            </div>
                        </div>
                    )}

                    {isTask && target.originalTask && (() => {
                        const task = target.originalTask!
                        const isRunning = timer.runningTaskId === task.id
                        const elapsedSeconds = isRunning
                            ? timer.currentElapsedSeconds
                            : (target.totalElapsedSeconds ?? 0)
                        const hasElapsed = elapsedSeconds > 0

                        return (
                            <div className={fieldClass}>
                                <label className={fieldLabelClass}>
                                    <Timer className="h-3 w-3" />
                                    記録時間
                                </label>
                                <div className="flex items-center gap-3">
                                    <span className={cn(
                                        "flex-1 font-mono text-lg",
                                        isRunning ? "text-emerald-300" : hasElapsed ? "text-neutral-50" : "text-neutral-500"
                                    )}>
                                        {formatTime(elapsedSeconds)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={async (e) => {
                                            e.stopPropagation()
                                            if (isRunning) {
                                                await timer.pauseTimer()
                                            } else {
                                                await timer.startTimer(task)
                                            }
                                        }}
                                        className={cn(
                                            "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                                            isRunning
                                                ? "bg-emerald-400/15 text-emerald-200 active:bg-emerald-400/25"
                                                : "bg-white/[0.06] text-neutral-300 active:bg-white/[0.1]"
                                        )}
                                    >
                                        {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                                    </button>
                                </div>
                                {(task.actual_time_minutes ?? 0) > 0 && !isRunning && (
                                    <p className="mt-0.5 text-[10px] text-neutral-500">
                                        実績: {task.actual_time_minutes}分
                                    </p>
                                )}
                            </div>
                        )
                    })()}

                    {onCreateSubTask && (
                        <div className={cn(fieldClass, "min-h-0")}>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <label className={fieldLabelClass}>
                                    <ListTodo className="h-3 w-3" />
                                    サブタスク
                                </label>
                                <span className="text-xs font-semibold text-neutral-100">{localChildTasks.length}件</span>
                            </div>
                            {localChildTasks.length > 0 && (
                                <div className="mb-1.5 max-h-24 space-y-1 overflow-y-auto overscroll-contain pr-0.5">
                                    {localChildTasks.map(child => (
                                        <div key={child.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2.5 py-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleSubTask(child.id)}
                                                className="flex-shrink-0 rounded p-1 text-neutral-400 active:bg-white/10"
                                            >
                                                {child.status === 'done' ? (
                                                    <CheckSquare className="h-4 w-4 text-emerald-300" />
                                                ) : (
                                                    <Square className="h-4 w-4 text-neutral-500" />
                                                )}
                                            </button>
                                            <span className={cn(
                                                "flex-1 truncate text-sm text-neutral-100",
                                                child.status === 'done' && "text-neutral-500 line-through"
                                            )}>
                                                {child.title}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteSubTask(child.id)}
                                                className="shrink-0 rounded p-1 text-neutral-500 active:bg-white/10 active:text-red-300"
                                                aria-label="サブタスクを削除"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={subtaskInput}
                                    onChange={(e) => setSubtaskInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            handleAddSubTask()
                                        }
                                    }}
                                    placeholder="サブタスクを追加..."
                                    className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/25"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddSubTask}
                                    disabled={!subtaskInput.trim() || isAddingSubTask}
                                    className={cn(
                                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 transition-colors",
                                        subtaskInput.trim() && !isAddingSubTask
                                            ? "bg-white text-neutral-950 active:bg-neutral-200"
                                            : "bg-white/[0.04] text-neutral-600"
                                    )}
                                    aria-label="サブタスクを追加"
                                >
                                    {isAddingSubTask ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Plus className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-neutral-400">
                            <StickyNote className="h-3 w-3" />
                            メモ（任意）
                        </label>
                        <textarea
                            value={isTask ? memo : eventDescription}
                            onChange={(e) => {
                                if (isTask) {
                                    setMemo(e.target.value)
                                } else {
                                    setEventDescription(e.target.value)
                                }
                            }}
                            rows={1}
                            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-relaxed text-neutral-50 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/25"
                            placeholder="メモを入力..."
                        />
                    </div>

                    </div>
                </div>

                <div className="flex-shrink-0 border-t border-white/10 bg-neutral-950 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-1.5">
                    <div className="mb-1.5 truncate text-center text-[11px] text-neutral-400">
                        {schedulePreview}
                    </div>
                    <div className="flex items-center gap-2">
                        {(onDeleteTask || onDeleteEvent) && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                aria-label="削除"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-300 transition-colors active:bg-red-500/20 disabled:opacity-60"
                            >
                                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!title.trim() || isDeleting}
                            className={cn(
                                "h-11 flex-1 rounded-xl text-base font-semibold transition-colors",
                                !title.trim() || isDeleting
                                    ? "bg-white/10 text-neutral-500"
                                    : "bg-white text-neutral-950 active:bg-neutral-300"
                            )}
                        >
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
}

export type { EditTarget }
