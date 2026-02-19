"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { UserCalendar } from "@/hooks/useCalendars"
import { X, Clock, Calendar as CalendarIcon, Type, ChevronDown, Play, Pause, Timer, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTimer, formatTime } from "@/contexts/TimerContext"

// --- Types ---

type EditTarget =
    | { type: 'task'; data: Task; startTime: Date; endTime: Date }
    | { type: 'event'; data: CalendarEvent; startTime: Date; endTime: Date }

interface MobileEventEditModalProps {
    target: EditTarget | null
    isOpen: boolean
    onClose: () => void
    onSaveTask: (taskId: string, updates: { title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string }) => Promise<void>
    onSaveEvent: (eventId: string, updates: { title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string }) => Promise<void>
    onDeleteEvent?: (eventId: string, googleEventId: string, calendarId: string) => Promise<void>
    availableCalendars: { id: string; name: string; background_color?: string }[]
}

// --- Time helpers ---

function toTimeString(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function parseTimeToDate(base: Date, timeStr: string): Date {
    const [h, m] = timeStr.split(':').map(Number)
    const d = new Date(base)
    d.setHours(h, m, 0, 0)
    return d
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

// --- Main Component ---

export function MobileEventEditModal({
    target,
    isOpen,
    onClose,
    onSaveTask,
    onSaveEvent,
    onDeleteEvent,
    availableCalendars,
}: MobileEventEditModalProps) {
    const [title, setTitle] = useState('')
    const [startTime, setStartTime] = useState('')
    const [endTime, setEndTime] = useState('')
    const [duration, setDuration] = useState(60)
    const [calendarId, setCalendarId] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showCalendarPicker, setShowCalendarPicker] = useState(false)

    const timer = useTimer()
    const sheetRef = useRef<HTMLDivElement>(null)
    const dragStartY = useRef(0)
    const currentTranslateY = useRef(0)
    const openedAtRef = useRef(0)

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

        if (target.type === 'task') {
            const task = target.data
            setTitle(task.title)
            setStartTime(toTimeString(target.startTime))
            setDuration(task.estimated_time || 60)
            setCalendarId(task.calendar_id || '')
            // Calculate end time from start + duration
            const end = new Date(target.startTime.getTime() + (task.estimated_time || 60) * 60000)
            setEndTime(toTimeString(end))
        } else {
            const event = target.data
            setTitle(event.title)
            setStartTime(toTimeString(target.startTime))
            setEndTime(toTimeString(target.endTime))
            setCalendarId(event.calendar_id)
            // Calculate duration from event times
            const dur = Math.round((target.endTime.getTime() - target.startTime.getTime()) / 60000)
            setDuration(dur)
        }
    }, [target])

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

    // Save handler
    const handleSave = async () => {
        if (!target) return
        setIsSaving(true)

        try {
            if (target.type === 'task') {
                const task = target.data
                const baseDate = target.startTime
                const newStart = parseTimeToDate(baseDate, startTime)

                await onSaveTask(task.id, {
                    title: title !== task.title ? title : undefined,
                    scheduled_at: newStart.toISOString(),
                    estimated_time: duration,
                    calendar_id: calendarId || undefined,
                })
            } else {
                const event = target.data
                const baseDate = target.startTime
                const newStart = parseTimeToDate(baseDate, startTime)
                const newEnd = new Date(newStart.getTime() + duration * 60000)

                await onSaveEvent(event.id, {
                    title,
                    start_time: newStart.toISOString(),
                    end_time: newEnd.toISOString(),
                    googleEventId: event.google_event_id,
                    calendarId: event.calendar_id,
                })
            }
            onClose()
        } catch (err) {
            console.error('[MobileEventEditModal] Save error:', err)
        } finally {
            setIsSaving(false)
        }
    }

    // Update end time when start or duration changes
    const handleStartTimeChange = (newTime: string) => {
        setStartTime(newTime)
        if (target) {
            const base = target.startTime
            const newStart = parseTimeToDate(base, newTime)
            const newEnd = new Date(newStart.getTime() + duration * 60000)
            setEndTime(toTimeString(newEnd))
        }
    }

    const handleDurationChange = (newDuration: number) => {
        setDuration(newDuration)
        if (target) {
            const base = target.startTime
            const newStart = parseTimeToDate(base, startTime)
            const newEnd = new Date(newStart.getTime() + newDuration * 60000)
            setEndTime(toTimeString(newEnd))
        }
    }

    // Delete handler (events only)
    const handleDelete = async () => {
        if (!target || target.type !== 'event' || !onDeleteEvent) return
        const event = target.data as CalendarEvent
        setIsDeleting(true)
        try {
            await onDeleteEvent(event.id, event.google_event_id, event.calendar_id)
            onClose()
        } catch (err) {
            console.error('[MobileEventEditModal] Delete error:', err)
        } finally {
            setIsDeleting(false)
            setShowDeleteConfirm(false)
        }
    }

    if (!isOpen || !target) return null

    const isTask = target.type === 'task'
    const selectedCalendar = availableCalendars.find(c => c.id === calendarId)

    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 z-50 bg-black/40 animate-in fade-in duration-200"
                onClick={safeClose}
            />

            {/* Bottom Sheet */}
            <div
                ref={sheetRef}
                className="fixed inset-x-0 bottom-0 z-50 bg-background rounded-t-2xl shadow-xl animate-in slide-in-from-bottom duration-300 max-h-[92vh] flex flex-col"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Drag Handle (fixed) */}
                <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                    <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>

                {/* Header (fixed) */}
                <div className="flex items-center justify-between px-4 py-2 flex-shrink-0">
                    <h3 className="text-base font-semibold">
                        {isTask ? 'タスクを編集' : '予定を編集'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full hover:bg-muted transition-colors"
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Form (scrollable) */}
                <div className="flex-1 overflow-y-auto px-4 space-y-4 pb-2">
                    {/* Title */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Type className="w-3.5 h-3.5" />
                            タイトル
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            placeholder="タイトルを入力"
                        />
                    </div>

                    {/* Start Time */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            開始時間
                        </label>
                        <input
                            type="time"
                            value={startTime}
                            onChange={(e) => handleStartTimeChange(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    {/* Duration (both task and event) */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            所要時間
                        </label>
                        <select
                            value={duration}
                            onChange={(e) => handleDurationChange(Number(e.target.value))}
                            className="w-full px-3 py-2.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none cursor-pointer"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                        >
                            {DURATION_OPTIONS.map(d => (
                                <option key={d} value={d}>
                                    {d >= 60 ? `${d / 60}時間` : `${d}分`}
                                </option>
                            ))}
                        </select>
                        <p className="text-[10px] text-muted-foreground">
                            終了: {endTime}
                        </p>
                    </div>

                    {/* Calendar Selection (Task only, writable calendars) */}
                    {isTask && availableCalendars.length > 0 && (
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <CalendarIcon className="w-3.5 h-3.5" />
                                カレンダー
                            </label>
                            <button
                                onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-sm border rounded-lg bg-background hover:bg-muted transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    {selectedCalendar && (
                                        <div
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: selectedCalendar.background_color || '#4285F4' }}
                                        />
                                    )}
                                    <span>{selectedCalendar?.name || '未選択'}</span>
                                </div>
                                <ChevronDown className={cn(
                                    "w-4 h-4 text-muted-foreground transition-transform",
                                    showCalendarPicker && "rotate-180"
                                )} />
                            </button>
                            {showCalendarPicker && (
                                <div className="border rounded-lg overflow-hidden">
                                    {availableCalendars.map(cal => (
                                        <button
                                            key={cal.id}
                                            onClick={() => { setCalendarId(cal.id); setShowCalendarPicker(false) }}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-muted transition-colors",
                                                calendarId === cal.id && "bg-primary/5"
                                            )}
                                        >
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
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
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <CalendarIcon className="w-3.5 h-3.5" />
                                カレンダー
                            </label>
                            <div className="flex items-center gap-2 px-3 py-2.5 text-sm border rounded-lg bg-muted/30">
                                <div
                                    className="w-3 h-3 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: selectedCalendar.background_color || '#4285F4' }}
                                />
                                <span className="text-muted-foreground">{selectedCalendar.name}</span>
                            </div>
                        </div>
                    )}

                    {/* Timer Section (Tasks only) */}
                    {isTask && (() => {
                        const task = target.data as Task
                        const isRunning = timer.runningTaskId === task.id
                        const elapsedSeconds = isRunning
                            ? timer.currentElapsedSeconds
                            : (task.total_elapsed_seconds ?? 0)
                        const hasElapsed = elapsedSeconds > 0

                        return (
                            <div className="space-y-1.5">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Timer className="w-3.5 h-3.5" />
                                    記録時間
                                </label>
                                <div className="flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-background">
                                    <span className={cn(
                                        "font-mono text-lg flex-1",
                                        isRunning ? "text-primary" : hasElapsed ? "text-foreground" : "text-muted-foreground"
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
                                            "p-2.5 rounded-full transition-colors",
                                            isRunning
                                                ? "bg-primary/10 text-primary active:bg-primary/20"
                                                : "bg-muted text-muted-foreground active:bg-muted/80"
                                        )}
                                    >
                                        {isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                                    </button>
                                </div>
                                {(task.actual_time_minutes ?? 0) > 0 && !isRunning && (
                                    <p className="text-[10px] text-muted-foreground">
                                        実績: {task.actual_time_minutes}分
                                    </p>
                                )}
                            </div>
                        )
                    })()}

                </div>

                {/* Footer (fixed) */}
                <div className="flex-shrink-0 px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t">
                    {/* Delete confirmation (events only) */}
                    {!isTask && showDeleteConfirm && onDeleteEvent ? (
                        <div className="space-y-2">
                            <p className="text-sm text-center text-muted-foreground">この予定を削除しますか？</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="flex-1 py-2.5 text-sm font-medium rounded-lg border bg-background hover:bg-muted transition-colors"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="flex-1 py-2.5 text-sm font-medium rounded-lg bg-destructive text-destructive-foreground active:bg-destructive/90 transition-colors"
                                >
                                    {isDeleting ? '削除中...' : '削除する'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            {/* Save button */}
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !title.trim()}
                                className={cn(
                                    "flex-1 py-3 text-sm font-medium rounded-lg transition-colors",
                                    isSaving || !title.trim()
                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                        : "bg-primary text-primary-foreground active:bg-primary/90"
                                )}
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </button>
                            {/* Delete button (events only) */}
                            {!isTask && onDeleteEvent && (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="px-4 py-3 text-sm font-medium rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

export type { EditTarget }
