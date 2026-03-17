"use client"

import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface IdealCardEmptyProps {
    onClick: () => void
}

export function IdealCardEmpty({ onClick }: IdealCardEmptyProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "rounded-2xl border-2 border-dashed border-muted-foreground/30",
                "hover:border-primary/50 hover:bg-primary/5 transition-all duration-200",
                "flex flex-col items-center justify-center gap-3",
                "aspect-[3/4] w-full text-muted-foreground"
            )}
        >
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-current flex items-center justify-center">
                <Plus className="h-6 w-6" />
            </div>
            <div className="text-center">
                <p className="text-sm font-medium">理想を追加</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">なりたい自分を描く</p>
            </div>
        </button>
    )
}
