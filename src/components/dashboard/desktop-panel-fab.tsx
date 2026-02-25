"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Plus, Sparkles, CalendarPlus } from "lucide-react"
import { cn } from "@/lib/utils"

interface DesktopPanelFabProps {
    onOpenAiChat: () => void
    onOpenTaskForm: () => void
    isTaskFormOpen: boolean
}

export function DesktopPanelFab({ onOpenAiChat, onOpenTaskForm, isTaskFormOpen }: DesktopPanelFabProps) {
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

    const handleAiClick = useCallback(() => {
        setIsExpanded(false)
        onOpenAiChat()
    }, [onOpenAiChat])

    const handleTaskClick = useCallback(() => {
        setIsExpanded(false)
        onOpenTaskForm()
    }, [onOpenTaskForm])

    // Hide FAB when task form is open
    if (isTaskFormOpen) return null

    return (
        <div ref={fabRef} className="absolute bottom-4 right-4 z-[80] flex flex-col-reverse items-end gap-2">
            {/* Main FAB button */}
            <button
                onClick={() => setIsExpanded(prev => !prev)}
                className="w-12 h-12 rounded-full bg-neutral-900 text-white shadow-xl shadow-black/30 ring-1 ring-white/10 flex items-center justify-center hover:bg-neutral-800 active:scale-95 transition-all"
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
                <span className="text-xs font-medium text-white bg-neutral-950 px-2 py-1 rounded-md shadow-md border border-white/10 whitespace-nowrap">
                    タスク追加
                </span>
                <button
                    onClick={handleTaskClick}
                    className="w-10 h-10 rounded-full bg-blue-700 text-white shadow-lg shadow-blue-900/30 flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all"
                >
                    <CalendarPlus className="w-4 h-4" />
                </button>
            </div>

            {/* AI chat button */}
            <div
                className={cn(
                    "flex items-center gap-2 transition-all duration-200 ease-out delay-75",
                    isExpanded
                        ? "opacity-100 scale-100 translate-y-0"
                        : "opacity-0 scale-75 translate-y-2 pointer-events-none"
                )}
            >
                <span className="text-xs font-medium text-white bg-neutral-950 px-2 py-1 rounded-md shadow-md border border-white/10 whitespace-nowrap">
                    AIチャット
                </span>
                <button
                    onClick={handleAiClick}
                    className="w-10 h-10 rounded-full bg-violet-700 text-white shadow-lg shadow-violet-900/30 flex items-center justify-center hover:bg-violet-600 active:scale-95 transition-all"
                >
                    <Sparkles className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
