"use client"

import { useState, useMemo } from "react"
import { useCalendars } from "@/hooks/useCalendars"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Check, Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface TaskCalendarSelectProps {
    value?: string | null
    onChange: (calendarId: string | null) => void
    disabled?: boolean
    className?: string
}

export function TaskCalendarSelect({
    value,
    onChange,
    disabled = false,
    className
}: TaskCalendarSelectProps) {
    const [open, setOpen] = useState(false)
    const { calendars, isLoading } = useCalendars()

    // Find selected calendar
    const selectedCalendar = useMemo(() => {
        if (!value) return null
        // Try to find by our ID first, then by google_calendar_id just in case
        return calendars.find(c => c.id === value || c.google_calendar_id === value)
    }, [calendars, value])

    const handleSelect = (calendarId: string) => {
        onChange(calendarId)
        setOpen(false)
    }

    // Get primary calendar or fallback
    const displayCalendar = selectedCalendar || {
        name: "未設定",
        color: null,
        background_color: null
    }

    // Filter out read-only calendars if needed (optional)
    const selectableCalendars = calendars.filter(c => c.access_level !== 'read')

    if (isLoading) {
        return (
            <Button variant="ghost" size="sm" disabled className={cn("h-6 text-xs gap-1", className)}>
                <span className="w-2 h-2 rounded-full bg-muted animate-pulse" />
                <span className="text-muted-foreground">読込中...</span>
            </Button>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        "h-6 px-1.5 text-xs gap-1.5 font-normal hover:bg-muted/50 transition-colors",
                        !selectedCalendar && "text-muted-foreground",
                        className
                    )}
                >
                    {selectedCalendar ? (
                        <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: selectedCalendar.background_color || selectedCalendar.color || '#4285F4' }}
                        />
                    ) : (
                        <CalendarIcon className="w-3.5 h-3.5 shrink-0 opactiy-70" />
                    )}

                    <span className="truncate max-w-[100px]">
                        {selectedCalendar ? selectedCalendar.name : "カレンダーを選択"}
                    </span>
                    <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <div className="p-1 max-h-[300px] overflow-y-auto">
                    {selectableCalendars.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground text-center">
                            カレンダーが見つかりません
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {selectableCalendars.map((calendar) => {
                                const isSelected = value === calendar.id || value === calendar.google_calendar_id
                                return (
                                    <button
                                        key={calendar.id}
                                        onClick={() => handleSelect(calendar.id)}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left",
                                            isSelected && "bg-accent/50"
                                        )}
                                    >
                                        <div
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: calendar.background_color || calendar.color || '#4285F4' }}
                                        />
                                        <span className="flex-1 truncate">{calendar.name}</span>
                                        {isSelected && <Check className="w-3 h-3 ml-auto opacity-50" />}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Clear selection option */}
                {value && (
                    <div className="border-t p-1">
                        <button
                            onClick={() => {
                                onChange(null)
                                setOpen(false)
                            }}
                            className="w-full flex items-center justify-center px-2 py-1.5 text-xs rounded-sm hover:bg-destructive/10 hover:text-destructive transition-colors"
                        >
                            設定を解除
                        </button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
