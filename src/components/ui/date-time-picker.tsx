"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Calendar as CalendarIcon, ChevronDown, ChevronUp, Check } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SimpleCalendar } from "@/components/ui/simple-calendar"

interface DateTimePickerProps {
    date: Date | undefined
    setDate?: (date: Date | undefined) => void
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
    estimatedMinutes?: number | null
    calendarId?: string | null
    calendars?: DateTimePickerCalendar[]
    onConfirmSchedule?: (params: { date: Date; estimatedMinutes: number; calendarId: string }) => void
}

interface DateTimePickerCalendar {
    google_calendar_id: string
    name: string
    selected?: boolean
    is_primary?: boolean
    color?: string | null
    background_color?: string | null
}

// ----------------------------------------------------------------------
// Time Wheel Component (Split Hours / Minutes)
// - scrollTop-based scroll for reliable mobile touch support
// ----------------------------------------------------------------------
const ITEM_HEIGHT = 32 // h-8 = 32px
const VISIBLE_HEIGHT = 200

function TimeWheel({
    selectedDate,
    onTimeChange,
}: {
    selectedDate: Date | undefined
    onTimeChange: (type: "hour" | "minute", value: number) => void
}) {
    const hours = Array.from({ length: 24 }, (_, i) => i)
    const minutes = Array.from({ length: 12 }, (_, i) => i * 5)

    const hourScrollRef = React.useRef<HTMLDivElement>(null)
    const minuteScrollRef = React.useRef<HTMLDivElement>(null)
    const isInitialMount = React.useRef(true)
    const hourTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const minuteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const isSnapping = React.useRef(false)

    const scrollToIndex = React.useCallback((container: HTMLDivElement | null, index: number, smooth: boolean) => {
        if (!container) return
        const targetScrollTop = index * ITEM_HEIGHT
        container.scrollTo({
            top: targetScrollTop,
            behavior: smooth ? 'smooth' : 'auto',
        })
    }, [])

    const handleItemSelect = React.useCallback((
        type: "hour" | "minute",
        value: number,
        index: number
    ) => {
        if (type === "hour") {
            scrollToIndex(hourScrollRef.current, index, true)
        } else {
            scrollToIndex(minuteScrollRef.current, index, true)
        }
        onTimeChange(type, value)
    }, [onTimeChange, scrollToIndex])

    React.useEffect(() => {
        if (selectedDate && isInitialMount.current) {
            setTimeout(() => {
                const hour = selectedDate.getHours()
                const minuteIndex = Math.floor(selectedDate.getMinutes() / 5)
                scrollToIndex(hourScrollRef.current, hour, false)
                scrollToIndex(minuteScrollRef.current, minuteIndex, false)
            }, 100)
            isInitialMount.current = false
        }
    }, [selectedDate, scrollToIndex])

    // スクロール終了検出 → スナップ＋自動選択
    const handleScrollEnd = React.useCallback((
        container: HTMLDivElement,
        type: "hour" | "minute",
        values: number[],
        timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
    ) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            if (isSnapping.current) return
            const scrollTop = container.scrollTop
            const snappedIndex = Math.round(scrollTop / ITEM_HEIGHT)
            const clampedIndex = Math.max(0, Math.min(snappedIndex, values.length - 1))
            const value = values[clampedIndex]

            // スナップアニメーション
            isSnapping.current = true
            container.scrollTo({
                top: clampedIndex * ITEM_HEIGHT,
                behavior: 'smooth',
            })
            setTimeout(() => { isSnapping.current = false }, 200)

            // 値を自動確定
            onTimeChange(type, value)
        }, 80)
    }, [onTimeChange])

    const paddingY = Math.floor(VISIBLE_HEIGHT / 2 - ITEM_HEIGHT / 2)

    return (
        <div className="flex flex-col w-[80px] shrink-0 border-l border-border/40 pl-1.5 ml-2">
            <div className="flex items-center justify-around py-1.5 text-[10px] font-medium text-muted-foreground border-b border-border/40 select-none">
                <span>時</span>
                <span>分</span>
            </div>

            <div className="relative" style={{ height: VISIBLE_HEIGHT }}>
                {/* Top chevrons */}
                <div className="absolute top-1 left-0 right-0 flex justify-around pointer-events-none text-muted-foreground/50 z-10">
                    <ChevronUp className="h-3.5 w-3.5" />
                    <ChevronUp className="h-3.5 w-3.5" />
                </div>

                {/* Bottom chevrons */}
                <div className="absolute bottom-1 left-0 right-0 flex justify-around pointer-events-none text-muted-foreground/50 z-10">
                    <ChevronDown className="h-3.5 w-3.5" />
                    <ChevronDown className="h-3.5 w-3.5" />
                </div>

                {/* Center highlight band */}
                <div
                    className="absolute left-0 right-0 rounded-lg pointer-events-none bg-primary/10 ring-1 ring-primary/20 z-[1]"
                    style={{ top: paddingY, height: ITEM_HEIGHT }}
                />

                {/* Top/Bottom fade */}
                <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background to-transparent pointer-events-none z-[2]" />
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent pointer-events-none z-[2]" />

                <div className="flex h-full">
                    {/* Hours */}
                    <div
                        ref={hourScrollRef}
                        className="h-full flex-1 overflow-y-scroll overscroll-contain no-scrollbar"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                        onTouchMove={(e) => e.stopPropagation()}
                        onScroll={() => {
                            if (hourScrollRef.current) {
                                handleScrollEnd(hourScrollRef.current, "hour", hours, hourTimerRef)
                            }
                        }}
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {hours.map((h) => {
                                const isSelected = selectedDate?.getHours() === h
                                return (
                                    <div
                                        key={h}
                                        className={cn(
                                            "w-8 flex items-center justify-center text-xs font-medium transition-colors shrink-0 cursor-pointer rounded-md hover:bg-muted/40",
                                            isSelected
                                                ? "text-primary font-bold"
                                                : "text-muted-foreground"
                                        )}
                                        style={{ height: ITEM_HEIGHT }}
                                        onClick={() => handleItemSelect("hour", h, h)}
                                    >
                                        {h.toString().padStart(2, "0")}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div className="w-px bg-border/40 mx-0.5" />

                    {/* Minutes */}
                    <div
                        ref={minuteScrollRef}
                        className="h-full flex-1 overflow-y-scroll overscroll-contain no-scrollbar"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                        onTouchMove={(e) => e.stopPropagation()}
                        onScroll={() => {
                            if (minuteScrollRef.current) {
                                handleScrollEnd(minuteScrollRef.current, "minute", minutes, minuteTimerRef)
                            }
                        }}
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {minutes.map((m, idx) => {
                                const currentMin = selectedDate?.getMinutes() ?? 0
                                const isSelected = currentMin === m
                                return (
                                    <div
                                        key={m}
                                        className={cn(
                                            "w-8 flex items-center justify-center text-xs font-medium transition-colors shrink-0 cursor-pointer rounded-md hover:bg-muted/40",
                                            isSelected
                                                ? "text-primary font-bold"
                                                : "text-muted-foreground"
                                        )}
                                        style={{ height: ITEM_HEIGHT }}
                                        onClick={() => handleItemSelect("minute", m, idx)}
                                    >
                                        {m.toString().padStart(2, "0")}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ----------------------------------------------------------------------
// Main DateTimePicker Component
// - Uses a bottom sheet overlay for reliable mobile touch/z-index
// ----------------------------------------------------------------------
export function DateTimePicker({
    date,
    setDate,
    trigger,
    open,
    onOpenChange,
    estimatedMinutes,
    calendarId,
    calendars = [],
    onConfirmSchedule,
}: DateTimePickerProps) {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const isControlled = open !== undefined
    const isOpen = isControlled ? open : internalOpen
    const setIsOpen = React.useCallback((nextOpen: boolean) => {
        if (!isControlled) setInternalOpen(nextOpen)
        onOpenChange?.(nextOpen)
    }, [isControlled, onOpenChange])
    const [currentMonth, setCurrentMonth] = React.useState<Date>(new Date())
    const [tempDate, setTempDate] = React.useState<Date | undefined>(date)
    const [tempEstimatedMinutes, setTempEstimatedMinutes] = React.useState(estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : 60)
    const [tempCalendarId, setTempCalendarId] = React.useState(calendarId ?? "")
    const [isMounted, setIsMounted] = React.useState(false)
    const availableCalendars = React.useMemo(() => {
        const writable = calendars.filter(calendar => calendar.google_calendar_id)
        const selected = writable.filter(calendar => calendar.selected)
        return selected.length > 0 ? selected : writable
    }, [calendars])
    const fallbackCalendarId = React.useMemo(() => (
        calendarId ||
        availableCalendars.find(calendar => calendar.is_primary)?.google_calendar_id ||
        availableCalendars[0]?.google_calendar_id ||
        "primary"
    ), [availableCalendars, calendarId])

    React.useEffect(() => {
        setIsMounted(true)
    }, [])

    React.useEffect(() => {
        if (isOpen) {
            setTempDate(date || new Date())
            setCurrentMonth(date || new Date())
            setTempEstimatedMinutes(estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : 60)
            setTempCalendarId(fallbackCalendarId)
        }
    }, [date, estimatedMinutes, fallbackCalendarId, isOpen])

    const handleOpen = () => setIsOpen(true)

    const handleConfirm = () => {
        if (tempDate) {
            if (onConfirmSchedule) {
                onConfirmSchedule({
                    date: tempDate,
                    estimatedMinutes: Math.max(5, tempEstimatedMinutes),
                    calendarId: tempCalendarId || fallbackCalendarId,
                })
            } else {
                setDate?.(tempDate)
            }
        }
        setIsOpen(false)
    }

    const handleCancel = () => {
        setIsOpen(false)
    }

    const handleDateSelect = (newDate: Date | undefined) => {
        if (!newDate) return
        const current = tempDate || new Date()
        newDate.setHours(tempDate ? current.getHours() : 9)
        newDate.setMinutes(tempDate ? current.getMinutes() : 0)
        setTempDate(newDate)
    }

    const handleTimeChange = (type: "hour" | "minute", value: number) => {
        const newDate = tempDate ? new Date(tempDate) : new Date()
        if (type === "hour") newDate.setHours(value)
        else newDate.setMinutes(value)
        setTempDate(newDate)
    }

    // SSR placeholder
    if (!isMounted) {
        return trigger || (
            <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                <span className="text-muted-foreground">読み込み中...</span>
            </Button>
        )
    }

    const pickerOverlay = isOpen ? createPortal(
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[999] bg-black/55 animate-in fade-in duration-150"
                onClick={handleCancel}
            />

            {/* Sheet */}
            <div className="fixed inset-x-0 bottom-0 z-[1000] flex max-h-[min(88dvh,680px)] flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl animate-in slide-in-from-bottom duration-200">
                {/* Drag handle */}
                <div className="flex shrink-0 justify-center pt-3 pb-1">
                    <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
                </div>

                {/* Calendar + Time Wheel */}
                <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-3 pb-2">
                    <SimpleCalendar
                        selected={tempDate}
                        onSelect={handleDateSelect}
                        month={currentMonth}
                        onMonthChange={setCurrentMonth}
                        className="w-[240px] shrink-0"
                    />
                    <TimeWheel selectedDate={tempDate} onTimeChange={handleTimeChange} />
                </div>

                <div className="grid shrink-0 gap-2 border-t border-border/40 px-4 py-3">
                    <label className="grid gap-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">カレンダー</span>
                        <select
                            value={tempCalendarId || fallbackCalendarId}
                            onChange={(event) => setTempCalendarId(event.currentTarget.value)}
                            className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35"
                        >
                            {availableCalendars.length > 0 ? (
                                availableCalendars.map(calendar => (
                                    <option key={calendar.google_calendar_id} value={calendar.google_calendar_id}>
                                        {calendar.name || calendar.google_calendar_id}
                                    </option>
                                ))
                            ) : (
                                <option value="primary">デフォルトカレンダー</option>
                            )}
                        </select>
                    </label>

                    <div className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-muted-foreground">所要時間</span>
                            <span className="text-xs text-muted-foreground">{tempEstimatedMinutes}分</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                            {[15, 30, 45, 60].map(minutes => (
                                <button
                                    key={minutes}
                                    type="button"
                                    onClick={() => setTempEstimatedMinutes(minutes)}
                                    className={cn(
                                        "h-8 rounded-lg border text-xs font-medium transition-colors",
                                        tempEstimatedMinutes === minutes
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border bg-background text-foreground active:bg-muted"
                                    )}
                                >
                                    {minutes}分
                                </button>
                            ))}
                        </div>
                        <input
                            type="range"
                            min={5}
                            max={180}
                            step={5}
                            value={tempEstimatedMinutes}
                            onChange={(event) => setTempEstimatedMinutes(Number(event.currentTarget.value))}
                            className="h-5 accent-primary"
                            aria-label="所要時間"
                        />
                    </div>
                </div>

                {/* Footer: Preview + Done button */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                        <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                            {tempDate
                                ? format(tempDate, "M月d日 (E) HH:mm", { locale: ja })
                                : "未選択"
                            }
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors active:bg-primary/90"
                    >
                        <Check className="w-4 h-4" />
                        完了
                    </button>
                </div>
            </div>
        </>,
        document.body
    ) : null

    return (
        <>
            {/* Trigger */}
            {trigger ? (
                <div onClick={handleOpen}>
                    {trigger}
                </div>
            ) : (
                <Button
                    variant="outline"
                    onClick={handleOpen}
                    className={cn(
                        "w-[240px] justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? (
                        format(date, "yyyy年 M月 d日 HH:mm", { locale: ja })
                    ) : (
                        <span>日時を選択</span>
                    )}
                </Button>
            )}

            {/* Bottom Sheet Overlay */}
            {pickerOverlay}
        </>
    )
}
