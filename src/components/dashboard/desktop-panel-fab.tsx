"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Plus, Sparkles, CalendarPlus, CalendarClock } from "lucide-react"
import { cn } from "@/lib/utils"

interface DesktopPanelFabProps {
    onOpenAiChat: () => void
    onOpenTaskForm: () => void
    onOpenScheduling?: () => void
    isTaskFormOpen: boolean
}

export function DesktopPanelFab({ onOpenAiChat, onOpenTaskForm, onOpenScheduling, isTaskFormOpen }: DesktopPanelFabProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const fabRef = useRef<HTMLDivElement>(null)

    // Close on outside click
    useEffect(() => {
        if (!isExpanded) return
        const handleClick = (e: MouseEvent) => {
            if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
                setIsExpanded(false)
            }
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsExpanded(false)
        }
        document.addEventListener('mousedown', handleClick)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handleClick)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isExpanded])

    // Hide FAB when task form is open
    if (isTaskFormOpen) return null

    const handleAiClick = useCallback(() => {
        setIsExpanded(false)
        onOpenAiChat()
    }, [onOpenAiChat])

    const handleSchedulingClick = useCallback(() => {
        setIsExpanded(false)
        onOpenScheduling?.()
    }, [onOpenScheduling])

    const handleTaskClick = useCallback(() => {
        setIsExpanded(false)
        onOpenTaskForm()
    }, [onOpenTaskForm])

    return (
        <div ref={fabRef} className="absolute bottom-4 right-4 z-10 flex flex-col-reverse items-end gap-2">
            {/* Main FAB button */}
            <button
                onClick={() => setIsExpanded(prev => !prev)}
                className="w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
            >
                <Plus className={cn("w-5 h-5 transition-transform duration-200", isExpanded && "rotate-45")} />
            </button>

            {/* Expanded menu items */}
            {/* Task add button */}
            <div
                className={cn(
                    "flex items-center gap-2 transition-all duration-200 ease-out",
                    isExpanded
                        ? "opacity-100 scale-100 translate-y-0"
                        : "opacity-0 scale-75 translate-y-2 pointer-events-none"
                )}
            >
                <span className="text-xs font-medium text-foreground bg-background/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm whitespace-nowrap">
                    タスク追加
                </span>
                <button
                    onClick={handleTaskClick}
                    className="w-10 h-10 rounded-full bg-blue-500 text-white shadow-md flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all"
                >
                    <CalendarPlus className="w-4 h-4" />
                </button>
            </div>

            {/* Scheduling button */}
            {onOpenScheduling && (
                <div
                    className={cn(
                        "flex items-center gap-2 transition-all duration-200 ease-out delay-75",
                        isExpanded
                            ? "opacity-100 scale-100 translate-y-0"
                            : "opacity-0 scale-75 translate-y-2 pointer-events-none"
                    )}
                >
                    <span className="text-xs font-medium text-foreground bg-background/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm whitespace-nowrap">
                        スケジュール調整
                    </span>
                    <button
                        onClick={handleSchedulingClick}
                        className="w-10 h-10 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center hover:bg-emerald-600 active:scale-95 transition-all"
                    >
                        <CalendarClock className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* AI chat button */}
            <div
                className={cn(
                    "flex items-center gap-2 transition-all duration-200 ease-out delay-[150ms]",
                    isExpanded
                        ? "opacity-100 scale-100 translate-y-0"
                        : "opacity-0 scale-75 translate-y-2 pointer-events-none"
                )}
            >
                <span className="text-xs font-medium text-foreground bg-background/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm whitespace-nowrap">
                    AIチャット
                </span>
                <button
                    onClick={handleAiClick}
                    className="w-10 h-10 rounded-full bg-violet-500 text-white shadow-md flex items-center justify-center hover:bg-violet-600 active:scale-95 transition-all"
                >
                    <Sparkles className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
