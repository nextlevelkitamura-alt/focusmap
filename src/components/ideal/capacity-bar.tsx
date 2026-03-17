"use client"

import { useState, useRef } from "react"
import { IdealGoalWithItems } from "@/types/database"
import { cn } from "@/lib/utils"
import { Pencil } from "lucide-react"

interface CapacityBarProps {
    ideals: IdealGoalWithItems[]
    dailyCapacityMinutes?: number
    onCapacityChange?: (minutes: number) => void
}

// カテゴリ別カラー
const CATEGORY_COLORS: Record<string, string> = {
    appearance: 'bg-pink-400',
    lifestyle:  'bg-emerald-400',
    career:     'bg-blue-400',
    learning:   'bg-violet-400',
    other:      'bg-amber-400',
}

const DEFAULT_CAPACITY = 120 // 分

export function CapacityBar({ ideals, dailyCapacityMinutes, onCapacityChange }: CapacityBarProps) {
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const activeIdeals = ideals.filter(i => i.status === 'active')
    const total = activeIdeals.reduce((sum, i) => sum + (i.total_daily_minutes ?? 0), 0)
    const capacity = dailyCapacityMinutes ?? DEFAULT_CAPACITY
    const ratio = total / capacity

    const colorClass =
        ratio >= 1.0 ? 'text-destructive' :
        ratio >= 0.9 ? 'text-orange-500' :
        ratio >= 0.7 ? 'text-yellow-500' :
        'text-emerald-600'

    const barBgClass =
        ratio >= 1.0 ? 'bg-destructive/20' :
        ratio >= 0.9 ? 'bg-orange-100' :
        ratio >= 0.7 ? 'bg-yellow-100' :
        'bg-emerald-50'

    const handleConfirm = (value: string) => {
        const num = parseInt(value, 10)
        if (!isNaN(num) && num >= 30 && num <= 720) {
            onCapacityChange?.(num)
        }
        setIsEditing(false)
    }

    if (activeIdeals.length === 0) return null

    return (
        <div className={cn("px-4 md:px-6 py-2 border-b text-xs", barBgClass)}>
            <div className="flex items-center gap-2 mb-1">
                <span className="text-muted-foreground font-medium">今日の時間バジェット</span>
                <div className="flex items-center gap-1 flex-wrap">
                    {activeIdeals.map(ideal => (
                        <span
                            key={ideal.id}
                            className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-[10px]",
                                CATEGORY_COLORS[ideal.category ?? 'other'] ?? 'bg-gray-400'
                            )}
                        >
                            {ideal.title} {ideal.total_daily_minutes}分
                        </span>
                    ))}
                </div>
                <span className={cn("ml-auto font-semibold tabular-nums flex items-center gap-1", colorClass)}>
                    合計 {total}分 /
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="number"
                            className="w-14 text-right bg-transparent border-b border-current outline-none tabular-nums"
                            defaultValue={capacity}
                            min={30}
                            max={720}
                            step={30}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleConfirm(e.currentTarget.value)
                                if (e.key === 'Escape') setIsEditing(false)
                            }}
                            onBlur={(e) => handleConfirm(e.target.value)}
                        />
                    ) : (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="inline-flex items-center gap-0.5 hover:underline"
                        >
                            {capacity}分
                            <Pencil className="h-2.5 w-2.5 opacity-50" />
                        </button>
                    )}
                    {ratio >= 1.0 && <span className="ml-1">⚠ キャパオーバー</span>}
                </span>
            </div>
            {/* バー */}
            <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                    className={cn(
                        "h-full rounded-full transition-all",
                        ratio >= 1.0 ? 'bg-destructive' :
                        ratio >= 0.9 ? 'bg-orange-400' :
                        ratio >= 0.7 ? 'bg-yellow-400' :
                        'bg-emerald-400'
                    )}
                    style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                />
            </div>
        </div>
    )
}
