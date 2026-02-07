"use client"

import { useState, useMemo } from "react"
import { useCalendars } from "@/hooks/useCalendars"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Check, Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface TaskCalendarSelectProps {
    value?: string | null
    onChange: (calendarType: string | null) => void
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

    // Find selected calendar by calendar_type (Personal/Work/etc)
    const selectedCalendar = useMemo(() => {
        if (!value) return null
        return calendars.find(c =>
            c.name === value ||
            c.id === value ||
            c.google_calendar_id === value ||
            c.color === value
        )
    }, [calendars, value])

    const handleSelect = (calendarType: string) => {
        onChange(calendarType)
        setOpen(false)
    }

    // Get display name
    const displayName = useMemo(() => {
        if (!value) return "カレンダーを選択"

        // If it's already a calendar name, use it directly
        if (selectedCalendar) {
            return selectedCalendar.name
        }

        // Otherwise, treat it as a predefined type
        const typeMap: Record<string, string> = {
            'Personal': '個人用',
            'Work': '仕事用',
            'Other': 'その他'
        }

        return typeMap[value] || value
    }, [value, selectedCalendar])

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
                        <CalendarIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    )}

                    <span className="truncate max-w-[100px]">
                        {displayName}
                    </span>
                    <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <div className="p-1 max-h-[300px] overflow-y-auto">
                    {/* Predefined options */}
                    <div className="space-y-0.5 mb-1">
                        <button
                            onClick={() => handleSelect('Personal')}
                            className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left",
                                value === 'Personal' && "bg-accent/50"
                            )}
                        >
                            <div className="w-2 h-2 rounded-full shrink-0 bg-blue-500" />
                            <span className="flex-1 truncate">Personal</span>
                            {value === 'Personal' && <Check className="w-3 h-3 ml-auto opacity-50" />}
                        </button>

                        <button
                            onClick={() => handleSelect('Work')}
                            className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left",
                                value === 'Work' && "bg-accent/50"
                            )}
                        >
                            <div className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
                            <span className="flex-1 truncate">Work</span>
                            {value === 'Work' && <Check className="w-3 h-3 ml-auto opacity-50" />}
                        </button>

                        <button
                            onClick={() => handleSelect('Other')}
                            className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left",
                                value === 'Other' && "bg-accent/50"
                            )}
                        >
                            <div className="w-2 h-2 rounded-full shrink-0 bg-purple-500" />
                            <span className="flex-1 truncate">Other</span>
                            {value === 'Other' && <Check className="w-3 h-3 ml-auto opacity-50" />}
                        </button>
                    </div>

                    {/* Google Calendars */}
                    {calendars.length > 0 && (
                        <>
                            <div className="border-t my-1" />
                            <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                                Googleカレンダー
                            </div>
                            {calendars.map((calendar) => {
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
                        </>
                    )}

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
                </div>
            </PopoverContent>
        </Popover>
    )
}