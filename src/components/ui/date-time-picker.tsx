"use client"

import * as React from "react"
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { SimpleCalendar } from "@/components/ui/simple-calendar"

interface DateTimePickerProps {
    date: Date | undefined
    setDate: (date: Date | undefined) => void
    trigger?: React.ReactNode
}

// ----------------------------------------------------------------------
// Time Wheel Component (Split Hours / Minutes)
// - Native scroll for reliable mobile touch support
// ----------------------------------------------------------------------
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
    const hourRefs = React.useRef<(HTMLButtonElement | null)[]>([])
    const minuteRefs = React.useRef<(HTMLButtonElement | null)[]>([])
    const isInitialMount = React.useRef(true)

    const scrollToCenter = (element: HTMLButtonElement | null, smooth: boolean = true) => {
        if (!element) return
        element.scrollIntoView({
            behavior: smooth ? 'smooth' : 'auto',
            block: 'center',
            inline: 'center'
        })
    }

    React.useEffect(() => {
        if (selectedDate && isInitialMount.current) {
            setTimeout(() => {
                const hour = selectedDate.getHours()
                const minute = selectedDate.getMinutes()
                const minuteIndex = Math.floor(minute / 5)

                scrollToCenter(hourRefs.current[hour], false)
                scrollToCenter(minuteRefs.current[minuteIndex], false)
            }, 50)
            isInitialMount.current = false
        }
    }, [selectedDate])

    const handleTimeChange = (type: "hour" | "minute", value: number) => {
        onTimeChange(type, value)

        if (type === "hour") {
            scrollToCenter(hourRefs.current[value], true)
        } else {
            const minuteIndex = value / 5
            scrollToCenter(minuteRefs.current[minuteIndex], true)
        }
    }

    return (
        <div className="flex flex-col w-[80px] shrink-0 border-l border-zinc-800/80 pl-1.5 ml-2">
            <div className="flex items-center justify-around py-1.5 text-[10px] font-medium text-zinc-400 border-b border-zinc-800/80 select-none">
                <span>時</span>
                <span>分</span>
            </div>

            <div className="relative h-[200px] overflow-hidden">
                {/* Top chevrons */}
                <div className="absolute top-1 left-0 right-0 flex justify-around pointer-events-none text-zinc-500/70 z-10">
                    <ChevronUp className="h-3.5 w-3.5" />
                    <ChevronUp className="h-3.5 w-3.5" />
                </div>

                {/* Bottom chevrons */}
                <div className="absolute bottom-1 left-0 right-0 flex justify-around pointer-events-none text-zinc-500/70 z-10">
                    <ChevronDown className="h-3.5 w-3.5" />
                    <ChevronDown className="h-3.5 w-3.5" />
                </div>

                {/* Center highlight band */}
                <div
                    className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-8 rounded-lg pointer-events-none bg-sky-500/15 ring-1 ring-sky-400/25 shadow-[0_0_18px_rgba(56,189,248,0.22)] z-[1]"
                />

                {/* Top/Bottom fade */}
                <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#18181b] to-transparent pointer-events-none z-[2]" />
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#18181b] to-transparent pointer-events-none z-[2]" />

                <div className="flex h-full">
                    {/* Hours - native scroll */}
                    <div
                        ref={hourScrollRef}
                        className="h-full flex-1 overflow-y-auto touch-auto no-scrollbar"
                    >
                        <div className="flex flex-col items-center py-[100px] space-y-0.5">
                            {hours.map((h) => {
                                const isSelected = selectedDate?.getHours() === h
                                return (
                                    <button
                                        key={h}
                                        ref={(el) => { hourRefs.current[h] = el }}
                                        type="button"
                                        className={cn(
                                            "w-7 h-7 rounded-md text-xs flex items-center justify-center transition-colors font-medium",
                                            isSelected
                                                ? "text-white"
                                                : "text-zinc-500 hover:text-zinc-200"
                                        )}
                                        onClick={() => handleTimeChange("hour", h)}
                                    >
                                        {h.toString().padStart(2, "0")}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="w-px bg-zinc-800/60 mx-0.5" />

                    {/* Minutes - native scroll */}
                    <div
                        ref={minuteScrollRef}
                        className="h-full flex-1 overflow-y-auto touch-auto no-scrollbar"
                    >
                        <div className="flex flex-col items-center py-[100px] space-y-0.5">
                            {minutes.map((m, index) => {
                                const currentMin = selectedDate?.getMinutes() ?? 0
                                const isSelected = currentMin === m
                                return (
                                    <button
                                        key={m}
                                        ref={(el) => { minuteRefs.current[index] = el }}
                                        type="button"
                                        className={cn(
                                            "w-7 h-7 rounded-md text-xs flex items-center justify-center transition-colors font-medium",
                                            isSelected
                                                ? "text-white"
                                                : "text-zinc-500 hover:text-zinc-200"
                                        )}
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
// ----------------------------------------------------------------------
export function DateTimePicker({ date, setDate, trigger }: DateTimePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false)
    const [currentMonth, setCurrentMonth] = React.useState<Date>(new Date())
    const [tempDate, setTempDate] = React.useState<Date | undefined>(date)
    const [isMounted, setIsMounted] = React.useState(false)

    // クライアントでマウントされたことを検知（SSR/Hydration Error 回避）
    React.useEffect(() => {
        setIsMounted(true)
    }, [])

    React.useEffect(() => {
        if (isOpen) {
            setTempDate(date || new Date())
            setCurrentMonth(date || new Date())
        }
    }, [isOpen, date])

    // ポップアップを閉じた時のみ親に確定値を渡す（閉じ防止）
    const handleOpenChange = (open: boolean) => {
        if (!open && tempDate) {
            setDate(tempDate)
        }
        setIsOpen(open)
    }

    const handleDateSelect = (newDate: Date | undefined) => {
        if (!newDate) return

        // 既に時間が設定されている場合はその時間を保持、初回はデフォルト時間（09:00）
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

    // SSR時は何も表示しない（Hydration Error 回避）
    if (!isMounted) {
        return trigger || (
            <Button
                variant={"outline"}
                className={cn(
                    "w-[240px] justify-start text-left font-normal border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-white",
                    !date && "text-muted-foreground"
                )}
            >
                <CalendarIcon className="mr-2 h-4 w-4" />
                <span>読み込み中...</span>
            </Button>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                {trigger || (
                    <Button
                        variant={"outline"}
                        className={cn(
                            "w-[240px] justify-start text-left font-normal border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-white",
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
            </PopoverTrigger>

            <PopoverContent
                className="w-auto p-0 border border-zinc-800 bg-[#18181b] shadow-2xl rounded-xl overflow-hidden"
                align="start"
                side="top"
                sideOffset={8}
            >
                <div className="flex p-3 pb-1.5">
                    {/* LEFT: SIMPLE CALENDAR */}
                    <SimpleCalendar
                        selected={tempDate}
                        onSelect={handleDateSelect}
                        month={currentMonth}
                        onMonthChange={setCurrentMonth}
                        className="w-[240px]"
                    />

                    {/* RIGHT: TIME WHEEL */}
                    <TimeWheel selectedDate={tempDate} onTimeChange={handleTimeChange} />
                </div>

                {/* 選択中の日時プレビュー */}
                {tempDate && (
                    <div className="px-3 pb-2 pt-1 border-t border-zinc-800/60">
                        <div className="text-xs text-zinc-400 flex items-center gap-2">
                            <CalendarIcon className="h-3.5 w-3.5" />
                            {format(tempDate, "M月d日 HH:mm", { locale: ja })}
                        </div>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
