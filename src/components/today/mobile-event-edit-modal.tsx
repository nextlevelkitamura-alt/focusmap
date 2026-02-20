"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { X, Clock, Calendar as CalendarIcon, Type, ChevronDown, Play, Pause, Timer, Trash2, StickyNote } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import type { TimeBlock } from "@/lib/time-block"

// --- Types ---

type EditTarget = TimeBlock

interface MobileEventEditModalProps {
    target: EditTarget | null
    isOpen: boolean
    onClose: () => void
    onSaveTask: (taskId: string, updates: { title?: string; scheduled_at?: string; estimated_time?: number; calendar_id?: string; memo?: string | null }) => Promise<void>
    onSaveEvent: (eventId: string, updates: { title: string; start_time: string; end_time: string; googleEventId: string; calendarId: string }) => Promise<void>
    onDeleteTask?: (taskId: string) => void
    onDeleteEvent?: (eventId: string, googleEventId: string, calendarId: string) => void
    availableCalendars: { id: string; name: string; background_color?: string }[]
}

// --- Time helpers ---

function toTimeString(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}


const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

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
}: MobileEventEditModalProps) {
    const [title, setTitle] = useState('')
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined)
    const [duration, setDuration] = useState(60)
    const [calendarId, setCalendarId] = useState('')
    const [memo, setMemo] = useState('')
    const [showCalendarPicker, setShowCalendarPicker] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    const timer = useTimer()
    const sheetRef = useRef<HTMLDivElement>(null)
    const dragStartY = useRef(0)
    const currentTranslateY = useRef(0)
    const openedAtRef = useRef(0)

    // モーダルが開いた瞬間を記録（ゴーストクリック防止）+ 確認リセット
    useEffect(() => {
        if (isOpen) {
            openedAtRef.current = Date.now()
            setShowDeleteConfirm(false)
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
        setCalendarId(target.calendarId || '')
        setMemo(target.originalTask?.memo || '')
        if (target.source === 'task') {
            setDuration(target.estimatedTime || 60)
        } else {
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
            }).catch(err => {
                console.error('[MobileEventEditModal] Save task error:', err)
            })
        } else {
            const newEnd = new Date(scheduledDate.getTime() + duration * 60000)

            onSaveEvent(target.id, {
                title,
                start_time: scheduledDate.toISOString(),
                end_time: newEnd.toISOString(),
                googleEventId: target.googleEventId!,
                calendarId: target.calendarId!,
            }).catch(err => {
                console.error('[MobileEventEditModal] Save event error:', err)
            })
        }
    }

    // Delete handler
    const handleDelete = useCallback(() => {
        if (!target) return
        if (target.source === 'task') {
            onDeleteTask?.(target.taskId!)
        } else {
            onDeleteEvent?.(target.id, target.googleEventId!, target.calendarId!)
        }
        onClose()
    }, [target, onDeleteTask, onDeleteEvent, onClose])

    // 終了時刻の計算
    const endTimeStr = scheduledDate
        ? toTimeString(new Date(scheduledDate.getTime() + duration * 60000))
        : '--:--'

    if (!isOpen || !target) return null

    const isTask = target.source === 'task'
    const selectedCalendar = availableCalendars.find(c => c.id === calendarId)

    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 z-[60] bg-black/40 animate-in fade-in duration-200"
                onClick={safeClose}
            />

            {/* Bottom Sheet */}
            <div
                ref={sheetRef}
                className="fixed inset-x-0 bottom-0 z-[60] bg-background rounded-t-2xl shadow-xl animate-in slide-in-from-bottom duration-300 max-h-[80dvh] flex flex-col overflow-hidden"
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
                <div className="flex-1 min-h-0 overflow-y-auto px-4 space-y-4 pb-2">
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

                    {/* Start Date/Time */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            開始日時
                        </label>
                        <DateTimePicker
                            date={scheduledDate}
                            setDate={setScheduledDate}
                            trigger={
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm border rounded-lg bg-background text-left focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                >
                                    <CalendarIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                                    {scheduledDate
                                        ? format(scheduledDate, "M月d日 (E) HH:mm", { locale: ja })
                                        : "日時を選択"
                                    }
                                </button>
                            }
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
                            onChange={(e) => setDuration(Number(e.target.value))}
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
                            終了: {endTimeStr}
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
                    {isTask && target.originalTask && (() => {
                        const task = target.originalTask!
                        const isRunning = timer.runningTaskId === task.id
                        const elapsedSeconds = isRunning
                            ? timer.currentElapsedSeconds
                            : (target.totalElapsedSeconds ?? 0)
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

                    {/* Memo (Task only) */}
                    {isTask && (
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <StickyNote className="w-3.5 h-3.5" />
                                メモ
                            </label>
                            <textarea
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none min-h-[80px]"
                                placeholder="メモを入力..."
                            />
                        </div>
                    )}

                </div>

                {/* Footer: Save + Delete side by side */}
                <div className="flex-shrink-0 px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t">
                    {showDeleteConfirm ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleDelete}
                                className="flex-1 py-3 text-sm font-medium text-white bg-red-600 active:bg-red-700 rounded-lg transition-colors"
                            >
                                削除する
                            </button>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 py-3 text-sm font-medium text-muted-foreground bg-muted rounded-lg transition-colors active:bg-muted/80"
                            >
                                キャンセル
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSave}
                                disabled={!title.trim()}
                                className={cn(
                                    "py-3 text-sm font-medium rounded-lg transition-colors",
                                    (onDeleteTask || onDeleteEvent) ? "basis-3/4" : "w-full",
                                    !title.trim()
                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                        : "bg-primary text-primary-foreground active:bg-primary/90"
                                )}
                            >
                                完了
                            </button>
                            {(onDeleteTask || onDeleteEvent) && (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="basis-1/4 flex items-center justify-center gap-1 py-3 text-sm font-medium text-red-500 bg-red-500/10 active:bg-red-500/20 rounded-lg transition-colors"
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
