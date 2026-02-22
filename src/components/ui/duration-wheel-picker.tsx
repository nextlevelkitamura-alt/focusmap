"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Check, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface DurationWheelPickerProps {
    duration: number // minutes
    onDurationChange: (minutes: number) => void
    trigger: React.ReactNode
}

const ITEM_HEIGHT = 32
const VISIBLE_HEIGHT = 160

const PRESETS = [
    { label: '15分', value: 15 },
    { label: '30分', value: 30 },
    { label: '1h', value: 60 },
    { label: '2h', value: 120 },
]

function DurationWheel({
    hours,
    minutes,
    onWheelChange,
}: {
    hours: number
    minutes: number
    onWheelChange: (type: "hour" | "minute", value: number) => void
}) {
    const hourValues = Array.from({ length: 13 }, (_, i) => i) // 0-12h
    const minuteValues = Array.from({ length: 12 }, (_, i) => i * 5) // 0-55 (5min steps)

    const hourScrollRef = React.useRef<HTMLDivElement>(null)
    const minuteScrollRef = React.useRef<HTMLDivElement>(null)
    const isInitialMount = React.useRef(true)
    const hourTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const minuteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const isSnapping = React.useRef(false)

    const scrollToIndex = React.useCallback((container: HTMLDivElement | null, index: number, smooth: boolean) => {
        if (!container) return
        container.scrollTo({
            top: index * ITEM_HEIGHT,
            behavior: smooth ? 'smooth' : 'auto',
        })
    }, [])

    // 初期位置にスクロール
    React.useEffect(() => {
        if (isInitialMount.current) {
            setTimeout(() => {
                scrollToIndex(hourScrollRef.current, hours, false)
                const minuteIndex = Math.floor(minutes / 5)
                scrollToIndex(minuteScrollRef.current, minuteIndex, false)
            }, 100)
            isInitialMount.current = false
        }
    }, [hours, minutes, scrollToIndex])

    // 外部から値が変更された時にスクロール位置を同期
    const prevHoursRef = React.useRef(hours)
    const prevMinutesRef = React.useRef(minutes)
    React.useEffect(() => {
        if (!isInitialMount.current) {
            if (prevHoursRef.current !== hours) {
                scrollToIndex(hourScrollRef.current, hours, true)
            }
            if (prevMinutesRef.current !== minutes) {
                scrollToIndex(minuteScrollRef.current, Math.floor(minutes / 5), true)
            }
        }
        prevHoursRef.current = hours
        prevMinutesRef.current = minutes
    }, [hours, minutes, scrollToIndex])

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

            isSnapping.current = true
            container.scrollTo({
                top: clampedIndex * ITEM_HEIGHT,
                behavior: 'smooth',
            })
            setTimeout(() => { isSnapping.current = false }, 200)

            onWheelChange(type, value)
        }, 80)
    }, [onWheelChange])

    const paddingY = Math.floor(VISIBLE_HEIGHT / 2 - ITEM_HEIGHT / 2)

    return (
        <div className="flex flex-col w-full">
            <div className="flex items-center justify-around py-1.5 text-[10px] font-medium text-muted-foreground border-b border-border/40 select-none">
                <span>時間</span>
                <span>分</span>
            </div>

            <div className="relative" style={{ height: VISIBLE_HEIGHT }}>
                <div className="absolute top-1 left-0 right-0 flex justify-around pointer-events-none text-muted-foreground/50 z-10">
                    <ChevronUp className="h-3.5 w-3.5" />
                    <ChevronUp className="h-3.5 w-3.5" />
                </div>
                <div className="absolute bottom-1 left-0 right-0 flex justify-around pointer-events-none text-muted-foreground/50 z-10">
                    <ChevronDown className="h-3.5 w-3.5" />
                    <ChevronDown className="h-3.5 w-3.5" />
                </div>

                <div
                    className="absolute left-2 right-2 rounded-lg pointer-events-none bg-primary/10 ring-1 ring-primary/20 z-[1]"
                    style={{ top: paddingY, height: ITEM_HEIGHT }}
                />
                <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent pointer-events-none z-[2]" />
                <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none z-[2]" />

                <div className="flex h-full">
                    {/* Hours */}
                    <div
                        ref={hourScrollRef}
                        className="h-full flex-1 overflow-y-scroll overscroll-contain no-scrollbar"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                        onTouchMove={(e) => e.stopPropagation()}
                        onScroll={() => {
                            if (hourScrollRef.current) {
                                handleScrollEnd(hourScrollRef.current, "hour", hourValues, hourTimerRef)
                            }
                        }}
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {hourValues.map((h) => (
                                <div
                                    key={h}
                                    className={cn(
                                        "w-10 flex items-center justify-center text-sm font-medium transition-colors shrink-0",
                                        hours === h ? "text-primary font-bold" : "text-muted-foreground"
                                    )}
                                    style={{ height: ITEM_HEIGHT }}
                                >
                                    {h}h
                                </div>
                            ))}
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
                                handleScrollEnd(minuteScrollRef.current, "minute", minuteValues, minuteTimerRef)
                            }
                        }}
                    >
                        <div className="flex flex-col items-center" style={{ paddingTop: paddingY, paddingBottom: paddingY }}>
                            {minuteValues.map((m) => (
                                <div
                                    key={m}
                                    className={cn(
                                        "w-10 flex items-center justify-center text-sm font-medium transition-colors shrink-0",
                                        minutes === m ? "text-primary font-bold" : "text-muted-foreground"
                                    )}
                                    style={{ height: ITEM_HEIGHT }}
                                >
                                    {m.toString().padStart(2, "0")}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function DurationWheelPicker({ duration, onDurationChange, trigger }: DurationWheelPickerProps) {
    const [isOpen, setIsOpen] = React.useState(false)
    const [tempHours, setTempHours] = React.useState(Math.floor(duration / 60))
    const [tempMinutes, setTempMinutes] = React.useState(duration % 60)

    React.useEffect(() => {
        if (isOpen) {
            setTempHours(Math.floor(duration / 60))
            // 5分刻みに丸める
            setTempMinutes(Math.round((duration % 60) / 5) * 5)
        }
    }, [isOpen, duration])

    const handleWheelChange = React.useCallback((type: "hour" | "minute", value: number) => {
        if (type === "hour") {
            setTempHours(value)
        } else {
            setTempMinutes(value)
        }
    }, [])

    const handlePreset = React.useCallback((value: number) => {
        setTempHours(Math.floor(value / 60))
        setTempMinutes(value % 60)
    }, [])

    const handleConfirm = () => {
        const totalMinutes = tempHours * 60 + tempMinutes
        onDurationChange(totalMinutes > 0 ? totalMinutes : 5) // 最低5分
        setIsOpen(false)
    }

    const handleCancel = () => {
        setIsOpen(false)
    }

    const displayDuration = tempHours * 60 + tempMinutes

    return (
        <>
            <div onClick={() => setIsOpen(true)}>
                {trigger}
            </div>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-[80] bg-black/50 animate-in fade-in duration-150"
                        onClick={handleCancel}
                    />

                    <div className="fixed inset-x-0 bottom-0 z-[80] bg-background rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-200">
                        <div className="flex justify-center pt-3 pb-1">
                            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                        </div>

                        <div className="px-4 pb-2">
                            <h3 className="text-sm font-semibold text-center mb-3">所要時間</h3>

                            {/* Presets */}
                            <div className="flex gap-2 justify-center mb-3">
                                {PRESETS.map(p => (
                                    <button
                                        key={p.value}
                                        onClick={() => handlePreset(p.value)}
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                                            displayDuration === p.value
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                                        )}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            {/* Wheel */}
                            <div className="mx-auto max-w-[200px]">
                                <DurationWheel
                                    hours={tempHours}
                                    minutes={tempMinutes}
                                    onWheelChange={handleWheelChange}
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 border-t border-border/40">
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5" />
                                {displayDuration >= 60
                                    ? `${Math.floor(displayDuration / 60)}時間${displayDuration % 60 > 0 ? `${displayDuration % 60}分` : ''}`
                                    : `${displayDuration}分`
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

export function formatDuration(minutes: number): string {
    if (minutes >= 60) {
        const h = Math.floor(minutes / 60)
        const m = minutes % 60
        return m > 0 ? `${h}時間${m}分` : `${h}時間`
    }
    return `${minutes}分`
}
