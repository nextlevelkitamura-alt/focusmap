"use client"

import { useMemo, useState } from "react"
import { IdealGoalWithItems, IdealItem, CostType } from "@/types/database"
import { format, startOfMonth, addMonths, isBefore, isSameMonth } from "date-fns"
import { ja } from "date-fns/locale"
import { Check, Circle, Diamond, Repeat, Coins, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface IdealTimelineViewProps {
    ideals: IdealGoalWithItems[]
    onItemsChanged: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
    appearance: '#ec4899',
    lifestyle: '#10b981',
    career: '#3b82f6',
    learning: '#8b5cf6',
    other: '#f59e0b',
}

interface MonthGroup {
    key: string       // "2026-03"
    label: string     // "2026年3月"
    isCurrent: boolean
    isPast: boolean
    items: (IdealItem & { idealTitle: string; idealColor: string })[]
}

export function IdealTimelineView({ ideals, onItemsChanged }: IdealTimelineViewProps) {
    const activeIdeals = ideals.filter(i => i.status === 'active')
    const [expandedGoalId, setExpandedGoalId] = useState<string | null>(
        activeIdeals.length === 1 ? activeIdeals[0].id : null
    )

    if (activeIdeals.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                理想を作成するとタイムラインが表示されます
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {activeIdeals.map(ideal => (
                <GoalTimeline
                    key={ideal.id}
                    ideal={ideal}
                    expanded={expandedGoalId === ideal.id || activeIdeals.length === 1}
                    onToggle={() => setExpandedGoalId(prev => prev === ideal.id ? null : ideal.id)}
                    onItemsChanged={onItemsChanged}
                />
            ))}
        </div>
    )
}

function GoalTimeline({ ideal, expanded, onToggle, onItemsChanged }: {
    ideal: IdealGoalWithItems
    expanded: boolean
    onToggle: () => void
    onItemsChanged: () => void
}) {
    const color = CATEGORY_COLORS[ideal.category ?? 'other'] ?? '#94a3b8'
    const items = ideal.ideal_items ?? []

    const { monthGroups, unscheduledItems } = useMemo(() => {
        const now = new Date()
        const currentMonth = startOfMonth(now)

        // Determine timeline range
        const startDate = ideal.start_date ? startOfMonth(new Date(ideal.start_date)) : currentMonth
        const endDate = ideal.target_date
            ? startOfMonth(new Date(ideal.target_date))
            : addMonths(currentMonth, 6)

        // Build month slots
        const months: MonthGroup[] = []
        let cursor = isBefore(startDate, currentMonth) ? startDate : currentMonth
        const finalMonth = addMonths(endDate, 1) // include target month

        while (isBefore(cursor, finalMonth) || isSameMonth(cursor, finalMonth)) {
            months.push({
                key: format(cursor, 'yyyy-MM'),
                label: format(cursor, 'yyyy年M月', { locale: ja }),
                isCurrent: isSameMonth(cursor, now),
                isPast: isBefore(cursor, currentMonth) && !isSameMonth(cursor, currentMonth),
                items: [],
            })
            cursor = addMonths(cursor, 1)
        }

        // Place items into months
        const unscheduled: (IdealItem & { idealTitle: string; idealColor: string })[] = []

        for (const item of items) {
            const enriched = { ...item, idealTitle: ideal.title, idealColor: color }

            if (item.scheduled_date) {
                const itemMonth = format(new Date(item.scheduled_date), 'yyyy-MM')
                const group = months.find(m => m.key === itemMonth)
                if (group) {
                    group.items.push(enriched)
                } else {
                    // Item is outside the timeline range, add to closest month
                    unscheduled.push(enriched)
                }
            } else {
                unscheduled.push(enriched)
            }
        }

        // Sort items within each month by scheduled_date
        for (const m of months) {
            m.items.sort((a, b) => {
                if (a.scheduled_date && b.scheduled_date) {
                    return a.scheduled_date.localeCompare(b.scheduled_date)
                }
                return a.display_order - b.display_order
            })
        }

        // Filter out empty past months
        const monthGroups = months.filter(m => m.items.length > 0 || m.isCurrent || !m.isPast)

        return { monthGroups, unscheduledItems: unscheduled }
    }, [ideal, items, color])

    const completedCount = items.filter(i => i.is_done).length
    const totalCount = items.length

    return (
        <div className="rounded-xl border overflow-hidden">
            {/* Header */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
            >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{ideal.title}</span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        {ideal.start_date && ideal.target_date && (
                            <span>
                                {format(new Date(ideal.start_date), 'yyyy/M')} → {format(new Date(ideal.target_date), 'yyyy/M')}
                            </span>
                        )}
                        <span>{completedCount}/{totalCount} 完了</span>
                    </div>
                </div>
                {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </button>

            {/* Timeline body */}
            {expanded && (
                <div className="border-t">
                    {monthGroups.map(month => (
                        <div key={month.key}>
                            {/* Month header */}
                            <div className={cn(
                                "px-4 py-2 text-xs font-medium border-b",
                                month.isCurrent
                                    ? "bg-primary/5 text-primary"
                                    : month.isPast
                                        ? "bg-muted/30 text-muted-foreground"
                                        : "bg-muted/10 text-muted-foreground"
                            )}>
                                {month.label}
                                {month.isCurrent && <span className="ml-1.5 text-[10px]">(今月)</span>}
                            </div>

                            {/* Items in this month */}
                            {month.items.length > 0 ? (
                                <div className="divide-y">
                                    {month.items.map(item => (
                                        <TimelineItem key={item.id} item={item} />
                                    ))}
                                </div>
                            ) : (
                                <div className="px-4 py-3 text-xs text-muted-foreground/40 italic">
                                    予定なし
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Unscheduled section */}
                    {unscheduledItems.length > 0 && (
                        <div>
                            <div className="px-4 py-2 text-xs font-medium border-b bg-amber-500/5 text-amber-600">
                                未スケジュール
                            </div>
                            <div className="divide-y">
                                {unscheduledItems.map(item => (
                                    <TimelineItem key={item.id} item={item} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function TimelineItem({ item }: { item: IdealItem & { idealTitle: string; idealColor: string } }) {
    const isDone = item.is_done ?? false
    const ct = (item.cost_type || 'once') as CostType

    return (
        <div className={cn(
            "flex items-center gap-3 px-4 py-2.5 text-sm",
            isDone && "opacity-50"
        )}>
            {/* Type icon */}
            <span className="flex-shrink-0">
                {isDone ? (
                    <Check className="w-4 h-4 text-green-500" />
                ) : item.item_type === 'milestone' ? (
                    <Diamond className="w-4 h-4 text-violet-500" />
                ) : item.item_type === 'habit' ? (
                    <Repeat className="w-4 h-4 text-blue-500" />
                ) : item.item_type === 'cost' ? (
                    <Coins className="w-4 h-4 text-amber-500" />
                ) : (
                    <Circle className="w-4 h-4 text-muted-foreground" />
                )}
            </span>

            {/* Title */}
            <span className={cn("flex-1 min-w-0 truncate", isDone && "line-through")}>
                {item.title}
            </span>

            {/* Meta info */}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0">
                {item.scheduled_date && (
                    <span>{format(new Date(item.scheduled_date), 'M/d')}</span>
                )}
                {item.item_cost && item.item_cost > 0 && (
                    <span>
                        ¥{item.item_cost.toLocaleString()}
                        {ct === 'monthly' && '/月'}
                        {ct === 'annual' && '/年'}
                    </span>
                )}
                {item.item_type === 'habit' && item.session_minutes && (
                    <span>{item.session_minutes}分</span>
                )}
            </div>
        </div>
    )
}
