"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export type Priority = 1 | 2 | 3 | 4

export interface PriorityOption {
    value: Priority
    label: string
    color: string
    bgColor: string
    hoverColor: string
    ringColor: string
    icon: string
}

export const PRIORITY_OPTIONS: Record<Priority, PriorityOption> = {
    1: {
        value: 1,
        label: "緊急",
        color: "text-red-500",
        bgColor: "bg-red-500/90",
        hoverColor: "hover:bg-red-500",
        ringColor: "ring-red-500/30",
        icon: "🎯",
    },
    2: {
        value: 2,
        label: "高い",
        color: "text-orange-500",
        bgColor: "bg-orange-500/90",
        hoverColor: "hover:bg-orange-500",
        ringColor: "ring-orange-500/30",
        icon: "🎯",
    },
    3: {
        value: 3,
        label: "中",
        color: "text-yellow-500",
        bgColor: "bg-yellow-500/90",
        hoverColor: "hover:bg-yellow-500",
        ringColor: "ring-yellow-500/30",
        icon: "🎯",
    },
    4: {
        value: 4,
        label: "低い",
        color: "text-blue-500",
        bgColor: "bg-blue-500/90",
        hoverColor: "hover:bg-blue-500",
        ringColor: "ring-blue-500/30",
        icon: "🎯",
    },
}

// Get icon color based on priority
export function getPriorityIconColor(priority: Priority): string {
    return PRIORITY_OPTIONS[priority].color
}

// ----------------------------------------------------------------------
// PriorityBadge: Compact display (text-only, no emoji)
// ----------------------------------------------------------------------
export function PriorityBadge({
    value,
    onClick,
    className,
}: {
    value: Priority
    onClick?: () => void
    className?: string
}) {
    const option = PRIORITY_OPTIONS[value]

    return (
        <span
            onClick={onClick}
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-white transition-colors cursor-pointer active:scale-95 active:opacity-80",
                option.bgColor,
                option.hoverColor,
                className
            )}
        >
            {option.label}
        </span>
    )
}

// ----------------------------------------------------------------------
// PrioritySelect: Full select dropdown (for forms)
// ----------------------------------------------------------------------
export function PrioritySelect({
    value,
    onChange,
    className,
}: {
    value: Priority
    onChange: (value: Priority) => void
    className?: string
}) {
    const option = PRIORITY_OPTIONS[value]

    return (
        <Select
            value={value.toString()}
            onValueChange={(v) => onChange(Number(v) as Priority)}
        >
            <SelectTrigger
                className={cn(
                    "w-[70px] h-7 text-xs border-zinc-700 text-white",
                    option.bgColor,
                    className
                )}
            >
                <SelectValue>
                    <span>{option.label}</span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
                {Object.values(PRIORITY_OPTIONS).map((opt) => (
                    <SelectItem
                        key={opt.value}
                        value={opt.value.toString()}
                        className="text-xs hover:bg-zinc-800 focus:bg-zinc-800"
                    >
                        <div className="flex items-center gap-1.5">
                            <span className={opt.color}>{opt.label}</span>
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

// ----------------------------------------------------------------------
// PriorityPopover: Popover menu for mind map nodes (compact)
// ----------------------------------------------------------------------
export function PriorityPopover({
    value,
    onChange,
    trigger,
    className,
}: {
    value: Priority
    onChange: (value: Priority) => void
    trigger?: React.ReactNode
    className?: string
}) {
    const [open, setOpen] = React.useState(false)
    const option = PRIORITY_OPTIONS[value]

    const handleSelect = (newValue: Priority) => {
        onChange(newValue)
        setOpen(false)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {trigger || (
                    <button
                        type="button"
                        className={cn(
                            "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-white transition-colors",
                            option.bgColor,
                            option.hoverColor,
                            className
                        )}
                    >
                        {option.label}
                    </button>
                )}
            </PopoverTrigger>
            <PopoverContent
                className="w-24 p-1 border border-zinc-800 bg-zinc-900 shadow-xl"
                align="start"
            >
                <div className="flex flex-col gap-0.5">
                    {Object.values(PRIORITY_OPTIONS).map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleSelect(opt.value)}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors text-left",
                                "hover:bg-zinc-800",
                                value === opt.value && "bg-zinc-800"
                            )}
                        >
                            <span className={opt.color}>{opt.label}</span>
                            {value === opt.value && (
                                <span className="ml-auto text-zinc-400">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}
