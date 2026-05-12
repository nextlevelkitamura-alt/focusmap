"use client"

import { Plus } from "lucide-react"

interface DesktopPanelFabProps {
    onOpenAiChat: () => void
    onOpenTaskForm: () => void
    isTaskFormOpen: boolean
}

export function DesktopPanelFab({ onOpenTaskForm, isTaskFormOpen }: DesktopPanelFabProps) {
    // Hide FAB when task form is open
    if (isTaskFormOpen) return null

    return (
        <div className="absolute bottom-4 right-4 z-[80]">
            <button
                onClick={onOpenTaskForm}
                className="w-12 h-12 rounded-full bg-neutral-900 text-white shadow-xl shadow-black/30 ring-1 ring-white/10 flex items-center justify-center hover:bg-neutral-800 active:scale-95 transition-all"
                aria-label="タスクを追加"
            >
                <Plus className="w-5 h-5" />
            </button>
        </div>
    )
}
