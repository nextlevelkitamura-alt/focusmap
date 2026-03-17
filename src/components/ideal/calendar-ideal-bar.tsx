"use client"

import { useState } from "react"
import { IdealGoalWithItems } from "@/types/database"
import { useIdealTracking, DaySummary, IdealTrackingItem } from "@/hooks/useIdealTracking"
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { format, startOfWeek, addDays } from "date-fns"

interface CalendarIdealBarProps {
    ideals: IdealGoalWithItems[]
    currentDate: Date
}

const MINUTE_PRESETS = [5, 10, 15, 25, 30, 45, 60]

export function CalendarIdealBar({ ideals, currentDate }: CalendarIdealBarProps) {
    const [isExpanded, setIsExpanded] = useState(true)
    const [minutePickerItem, setMinutePickerItem] = useState<{ itemId: string; date: string } | null>(null)

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const from = format(weekStart, 'yyyy-MM-dd')
    const to = format(addDays(weekStart, 6), 'yyyy-MM-dd')

    const { daySummaries, toggleItemCompletion, updateElapsedMinutes } = useIdealTracking(ideals, { from, to })

    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const todaySummary = daySummaries.get(todayStr)

    if (!todaySummary || todaySummary.totalCount === 0) return null

    return (
        <div className="border-b bg-muted/20">
            {/* サマリーヘッダー */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/30 transition-colors"
            >
                <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">理想アクション</span>
                    <span className="text-muted-foreground">
                        {todaySummary.completedCount}/{todaySummary.totalCount}完了
                    </span>
                    {todaySummary.totalElapsedMinutes > 0 && (
                        <span className="text-muted-foreground flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {todaySummary.totalElapsedMinutes}分
                        </span>
                    )}
                    {/* ミニプログレス */}
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{
                                width: `${todaySummary.totalCount > 0
                                    ? (todaySummary.completedCount / todaySummary.totalCount) * 100
                                    : 0}%`
                            }}
                        />
                    </div>
                </div>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* 展開時のアイテムリスト */}
            {isExpanded && (
                <div className="px-3 pb-2 space-y-1">
                    {todaySummary.items.map(item => (
                        <div key={item.idealItem.id} className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    if (item.source === 'direct') {
                                        toggleItemCompletion(item.idealItem.id, todayStr)
                                    }
                                }}
                                className="flex-shrink-0"
                                disabled={item.source === 'habit'}
                            >
                                {item.completionStatus === 'completed'
                                    ? <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                                    : <Circle className="w-3.5 h-3.5 text-muted-foreground" />
                                }
                            </button>
                            <span className={cn(
                                "text-xs flex-1 truncate",
                                item.completionStatus === 'completed' && "line-through text-muted-foreground"
                            )}>
                                {item.idealItem.title}
                            </span>

                            {/* 時間記録 */}
                            <button
                                onClick={() => setMinutePickerItem({
                                    itemId: item.idealItem.id,
                                    date: todayStr,
                                })}
                                className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted transition-colors"
                            >
                                {item.elapsedMinutes > 0 ? `${item.elapsedMinutes}分` : `${item.targetMinutes}分`}
                            </button>

                            {item.source === 'habit' && (
                                <span className="text-[10px] text-muted-foreground/50">習慣</span>
                            )}
                        </div>
                    ))}

                    {/* 時間選択ポップオーバー */}
                    {minutePickerItem && (
                        <div className="flex items-center gap-1 p-1.5 rounded-md bg-muted border">
                            <span className="text-[10px] text-muted-foreground mr-1">時間:</span>
                            {MINUTE_PRESETS.map(m => (
                                <button
                                    key={m}
                                    onClick={() => {
                                        updateElapsedMinutes(minutePickerItem.itemId, minutePickerItem.date, m)
                                        setMinutePickerItem(null)
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
                                >
                                    {m}分
                                </button>
                            ))}
                            <button
                                onClick={() => setMinutePickerItem(null)}
                                className="text-[10px] text-muted-foreground ml-1"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
