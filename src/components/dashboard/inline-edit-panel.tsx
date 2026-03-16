"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { X, Clock, Calendar as CalendarIcon, Type, ChevronDown, Play, Pause, Timer, Trash2, StickyNote, Bell } from "lucide-react"
import { TaskAttachmentPanel } from "@/components/tasks/task-attachment-panel"
import { cn } from "@/lib/utils"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import type { TimeBlock } from "@/lib/time-block"

// --- Types ---

type EditTarget = TimeBlock

interface InlineEditPanelProps {
    target: EditTarget | null
    isOpen: boolean
    onClose: () => void
    onSaveTask: (taskId: string, updates: { title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string; memo?: string | null; reminders?: number[] }) => Promise<void>
    onSaveEvent: (eventId: string, updates: { title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string; reminders?: number[] }) => Promise<void>
    onDeleteTask?: (taskId: string) => void
    onDeleteEvent?: (eventId: string, googleEventId: string, calendarId: string) => void
    availableCalendars: { id: string; name: string; background_color?: string }[]
    onScheduleReminder?: (targetType: 'task' | 'event', targetId: string, scheduledAt: Date, title: string, advanceMinutes: number) => void
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

// --- Component ---

export function InlineEditPanel({
    target,
    isOpen,
    onClose,
    onSaveTask,
    onSaveEvent,
    onDeleteTask,
    onDeleteEvent,
    availableCalendars,
    onScheduleReminder,
}: InlineEditPanelProps) {
    const [title, setTitle] = useState('')
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [duration, setDuration] = useState(60)
    const [calendarId, setCalendarId] = useState('')
    const [memo, setMemo] = useState('')
    const [reminder, setReminder] = useState(-1)
    const [showCalendarPicker, setShowCalendarPicker] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    const timer = useTimer()

    const reminderOptions = useMemo(() => {
        if (BASE_REMINDER_OPTIONS.some(opt => opt.value === reminder)) {
            return BASE_REMINDER_OPTIONS
        }
        if (reminder < 0) {
            return BASE_REMINDER_OPTIONS
        }
        return [...BASE_REMINDER_OPTIONS, { label: `${reminder}分前`, value: reminder }]
    }, [reminder])

    // Reset confirm state on open
    useEffect(() => {
        if (isOpen) setShowDeleteConfirm(false)
    }, [isOpen])

    // Initialize form when target changes
    useEffect(() => {
        if (!target) return
        setTitle(target.title)
        setScheduledDate(new Date(target.startTime))
        setCalendarId(target.calendarId || '')
        setMemo(target.originalTask?.memo || '')
        if (target.source === 'task') {
            setDuration(target.estimatedTime || 60)
        } else {
            const dur = Math.round((target.endTime.getTime() - target.startTime.getTime()) / 60000)
            setDuration(dur)
        }
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
    }, [target])

    // Save
    const handleSave = useCallback(() => {
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
                console.error('[InlineEditPanel] Save task error:', err)
            })
        } else {
            const newEnd = new Date(scheduledDate.getTime() + duration * 60000)
            onSaveEvent(target.id, {
                title,
                start_time: scheduledDate.toISOString(),
                end_time: newEnd.toISOString(),
                googleEventId: target.googleEventId || '',
                calendarId: target.calendarId || '',
                reminders: reminder >= 0 ? [reminder] : [],
            }).catch(err => {
                console.error('[InlineEditPanel] Save event error:', err)
            })
        }

        if (reminder >= 0 && onScheduleReminder && scheduledDate) {
            const targetType = target.source === 'task' ? 'task' as const : 'event' as const
            const targetId = target.source === 'task' ? target.taskId! : target.id
            const reminderAt = new Date(scheduledDate.getTime() - reminder * 60000)
            onScheduleReminder(targetType, targetId, reminderAt, title, reminder)
        }
    }, [target, scheduledDate, title, duration, calendarId, memo, reminder, onClose, onSaveTask, onSaveEvent, onScheduleReminder])

    // Delete
    const handleDelete = useCallback(() => {
        if (!target) return
        if (target.source === 'task') {
            onDeleteTask?.(target.taskId!)
        } else {
            onDeleteEvent?.(target.id, target.googleEventId!, target.calendarId!)
        }
        onClose()
    }, [target, onDeleteTask, onDeleteEvent, onClose])

    const endTimeStr = scheduledDate
        ? toTimeString(new Date(scheduledDate.getTime() + duration * 60000))
        : '--:--'

    if (!isOpen || !target) return null

    const isTask = target.source === 'task'
    const selectedCalendar = availableCalendars.find(c => c.id === calendarId)

    return (
        <div className="absolute inset-0 z-10 bg-background flex flex-col animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0">
                <h3 className="text-xs font-semibold">
                    {isTask ? 'タスクを編集' : '予定を編集'}
                </h3>
                <button
                    onClick={onClose}
                    className="p-1 rounded-full hover:bg-muted transition-colors"
                >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
            </div>

            {/* Form (scrollable) */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-3 py-2">
                {/* Title */}
                <div className="space-y-1">
                    <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <Type className="w-3 h-3" />
                        タイトル
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="タイトルを入力"
                    />
                </div>

                {/* Start Date/Time */}
                <div className="space-y-1">
                    <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        開始日時
                    </label>
                    <DateTimePicker
                        date={scheduledDate}
                        setDate={setScheduledDate}
                        trigger={
                            <button
                                type="button"
                                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs border rounded-md bg-background text-left focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            >
                                <CalendarIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                                {scheduledDate
                                    ? format(scheduledDate, "M月d日 (E) HH:mm", { locale: ja })
                                    : "日時を選択"
                                }
                            </button>
                        }
                    />
                </div>

                {/* Duration */}
                <div className="space-y-1">
                    <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        所要時間
                    </label>
                    <DurationWheelPicker
                        duration={duration}
                        onDurationChange={setDuration}
                        trigger={
                            <button
                                type="button"
                                className="w-full flex items-center justify-between px-2.5 py-2 text-xs border rounded-md bg-background hover:bg-muted transition-colors"
                            >
                                <span>{formatDuration(duration)}</span>
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                        }
                    />
                    <p className="text-[9px] text-muted-foreground">終了: {endTimeStr}</p>
                </div>

                {/* Calendar Selection (Task only) */}
                {isTask && availableCalendars.length > 0 && (
                    <div className="space-y-1">
                        <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            カレンダー
                        </label>
                        <button
                            onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                            className="w-full flex items-center justify-between px-2.5 py-2 text-xs border rounded-md bg-background hover:bg-muted transition-colors"
                        >
                            <div className="flex items-center gap-1.5">
                                {selectedCalendar && (
                                    <div
                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: selectedCalendar.background_color || '#4285F4' }}
                                    />
                                )}
                                <span>{selectedCalendar?.name || '未選択'}</span>
                            </div>
                            <ChevronDown className={cn(
                                "w-3.5 h-3.5 text-muted-foreground transition-transform",
                                showCalendarPicker && "rotate-180"
                            )} />
                        </button>
                        {showCalendarPicker && (
                            <div className="border rounded-md overflow-hidden">
                                {availableCalendars.map(cal => (
                                    <button
                                        key={cal.id}
                                        onClick={() => { setCalendarId(cal.id); setShowCalendarPicker(false) }}
                                        className={cn(
                                            "w-full flex items-center gap-1.5 px-2.5 py-2 text-xs text-left hover:bg-muted transition-colors",
                                            calendarId === cal.id && "bg-primary/5"
                                        )}
                                    >
                                        <div
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: cal.background_color || '#4285F4' }}
                                        />
                                        <span>{cal.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Event calendar (read-only) */}
                {!isTask && selectedCalendar && (
                    <div className="space-y-1">
                        <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            カレンダー
                        </label>
                        <div className="flex items-center gap-1.5 px-2.5 py-2 text-xs border rounded-md bg-muted/30">
                            <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: selectedCalendar.background_color || '#4285F4' }}
                            />
                            <span className="text-muted-foreground">{selectedCalendar.name}</span>
                        </div>
                    </div>
                )}

                {/* Timer (Task only) */}
                {isTask && target.originalTask && (() => {
                    const task = target.originalTask!
                    const isRunning = timer.runningTaskId === task.id
                    const elapsedSeconds = isRunning
                        ? timer.currentElapsedSeconds
                        : (target.totalElapsedSeconds ?? 0)
                    const hasElapsed = elapsedSeconds > 0

                    return (
                        <div className="space-y-1">
                            <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                <Timer className="w-3 h-3" />
                                記録時間
                            </label>
                            <div className="flex items-center gap-2 px-2.5 py-2 border rounded-md bg-background">
                                <span className={cn(
                                    "font-mono text-sm flex-1",
                                    isRunning ? "text-primary" : hasElapsed ? "text-foreground" : "text-muted-foreground"
                                )}>
                                    {formatTime(elapsedSeconds)}
                                </span>
                                <button
                                    type="button"
                                    onClick={async (e) => {
                                        e.stopPropagation()
                                        if (isRunning) await timer.pauseTimer()
                                        else await timer.startTimer(task)
                                    }}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        isRunning
                                            ? "bg-primary/10 text-primary hover:bg-primary/20"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    )}
                                >
                                    {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )
                })()}

                {/* Reminder */}
                <div className="space-y-1">
                    <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <Bell className="w-3 h-3" />
                        通知
                    </label>
                    <select
                        value={reminder}
                        onChange={(e) => setReminder(Number(e.target.value))}
                        className="w-full px-2.5 py-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none cursor-pointer"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                    >
                        {reminderOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Memo (Task only) */}
                {isTask && (
                    <div className="space-y-1">
                        <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <StickyNote className="w-3 h-3" />
                            メモ
                        </label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-2.5 py-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none min-h-[60px]"
                            placeholder="メモを入力..."
                        />
                    </div>
                )}

                {/* Attachments (Task only) */}
                {isTask && target.taskId && (
                    <div className="pt-1 border-t">
                        <TaskAttachmentPanel taskId={target.taskId} />
                    </div>
                )}
            </div>

            {/* Footer: Save + Delete */}
            <div className="flex-shrink-0 px-3 py-2 border-t">
                {showDeleteConfirm ? (
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={handleDelete}
                            className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                        >
                            削除する
                        </button>
                        <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="flex-1 py-2 text-xs font-medium text-muted-foreground bg-muted rounded-md transition-colors hover:bg-muted/80"
                        >
                            キャンセル
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={handleSave}
                            disabled={!title.trim()}
                            className={cn(
                                "py-2 text-xs font-medium rounded-md transition-colors",
                                (onDeleteTask || onDeleteEvent) ? "basis-3/4" : "w-full",
                                !title.trim()
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                        >
                            完了
                        </button>
                        {(onDeleteTask || onDeleteEvent) && (
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                className="basis-1/4 flex items-center justify-center gap-1 py-2 text-xs font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-md transition-colors"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
