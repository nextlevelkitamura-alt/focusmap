"use client"

import * as React from "react"
import { Calendar as CalendarIcon, ChevronDown, ChevronUp, Check } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SimpleCalendar } from "@/components/ui/simple-calendar"

interface DateTimePickerProps {
    date: Date | undefined
    setDate: (date: Date | undefined) => void
    trigger?: React.ReactNode
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

    // scrollTop ベースで中央にスクロール（scrollIntoView はモバイルで親をスクロールするため不使用）
    const scrollToIndex = React.useCallback((container: HTMLDivElement | null, index: number, smooth: boolean) => {
        if (!container) return
        const paddingTop = VISIBLE_HEIGHT / 2 - ITEM_HEIGHT / 2
        const targetScrollTop = index * ITEM_HEIGHT
        container.scrollTo({
            top: targetScrollTop,
            behavior: smooth ? 'smooth' : 'auto',
        })
        void paddingTop // used in CSS padding calculation
    }, [])

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

    const handleTimeChange = (type: "hour" | "minute", value: number) => {
        onTimeChange(type, value)
        if (type === "hour") {
            scrollToIndex(hourScrollRef.current, value, true)
        } else {
            scrollToIndex(minuteScrollRef.current, value / 5, true)
        }
    }

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
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {hours.map((h) => {
                                const isSelected = selectedDate?.getHours() === h
                                return (
                                    <button
                                        key={h}
                                        type="button"
                                        className={cn(
                                            "w-8 flex items-center justify-center text-xs font-medium transition-colors shrink-0",
                                            isSelected
                                                ? "text-primary font-bold"
                                                : "text-muted-foreground"
                                        )}
                                        style={{ height: ITEM_HEIGHT }}
                                        onClick={() => handleTimeChange("hour", h)}
                                    >
                                        {h.toString().padStart(2, "0")}
                                    </button>
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
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {minutes.map((m) => {
                                const currentMin = selectedDate?.getMinutes() ?? 0
                                const isSelected = currentMin === m
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        className={cn(
                                            "w-8 flex items-center justify-center text-xs font-medium transition-colors shrink-0",
                                            isSelected
                                                ? "text-primary font-bold"
                                                : "text-muted-foreground"
                                        )}
                                        style={{ height: ITEM_HEIGHT }}
                                        onClick={() => handleTimeChange("minute", m)}
                                    >
                                        {m.toString().padStart(2, "0")}
                                    </button>
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
export function DateTimePicker({ date, setDate, trigger }: DateTimePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false)
    const [currentMonth, setCurrentMonth] = React.useState<Date>(new Date())
    const [tempDate, setTempDate] = React.useState<Date | undefined>(date)
    const [isMounted, setIsMounted] = React.useState(false)

    React.useEffect(() => {
        setIsMounted(true)
    }, [])

    React.useEffect(() => {
        if (isOpen) {
            setTempDate(date || new Date())
            setCurrentMonth(date || new Date())
        }
    }, [isOpen, date])

    const handleOpen = () => setIsOpen(true)

    const handleConfirm = () => {
        if (tempDate) {
            setDate(tempDate)
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
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-[80] bg-black/50 animate-in fade-in duration-150"
                        onClick={handleCancel}
                    />

                    {/* Sheet */}
                    <div className="fixed inset-x-0 bottom-0 z-[80] bg-background rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-200">
                        {/* Drag handle */}
                        <div className="flex justify-center pt-3 pb-1">
                            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                        </div>

                        {/* Calendar + Time Wheel */}
                        <div className="flex px-3 pb-2 justify-center">
                            <SimpleCalendar
                                selected={tempDate}
                                onSelect={handleDateSelect}
                                month={currentMonth}
                                onMonthChange={setCurrentMonth}
                                className="w-[240px]"
                            />
                            <TimeWheel selectedDate={tempDate} onTimeChange={handleTimeChange} />
                        </div>

                        {/* Footer: Preview + Done button */}
                        <div className="flex items-center justify-between px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 border-t border-border/40">
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                <CalendarIcon className="h-3.5 w-3.5" />
                                {tempDate
                                    ? format(tempDate, "M月d日 (E) HH:mm", { locale: ja })
                                    : "未選択"
                                }
                            </div>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg active:bg-primary/90 transition-colors"
                            >
                                <Check className="w-4 h-4" />
                                完了
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
