"use client"

import { useMemo, useState } from "react"
import { IdealGoalWithItems, IdealItem, IdealItemType, CostType } from "@/types/database"
import { format, startOfMonth, addMonths, isBefore, isSameMonth } from "date-fns"
import { ja } from "date-fns/locale"
import { Check, Circle, Diamond, Repeat, Coins, ChevronDown, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

interface IdealTimelineViewProps {
    ideals: IdealGoalWithItems[]
    onItemsChanged: () => void
    onSelectItem?: (idealId: string, itemId: string) => void
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
    items: (IdealItem & { idealId: string; idealTitle: string; idealColor: string })[]
}

export function IdealTimelineView({ ideals, onItemsChanged, onSelectItem }: IdealTimelineViewProps) {
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
                    onSelectItem={onSelectItem}
                />
            ))}
        </div>
    )
}

function GoalTimeline({ ideal, expanded, onToggle, onItemsChanged, onSelectItem }: {
    ideal: IdealGoalWithItems
    expanded: boolean
    onToggle: () => void
    onItemsChanged: () => void
    onSelectItem?: (idealId: string, itemId: string) => void
}) {
    const color = CATEGORY_COLORS[ideal.category ?? 'other'] ?? '#94a3b8'
    const items = ideal.ideal_items ?? []
    const [addingMonthKey, setAddingMonthKey] = useState<string | null>(null)
    const [newTitle, setNewTitle] = useState('')
    const [newType, setNewType] = useState<IdealItemType>('action')
    const [isSaving, setIsSaving] = useState(false)

    const { monthGroups, unscheduledItems } = useMemo(() => {
        const now = new Date()
        const currentMonth = startOfMonth(now)

        const startDate = ideal.start_date ? startOfMonth(new Date(ideal.start_date)) : currentMonth
        const endDate = ideal.target_date
            ? startOfMonth(new Date(ideal.target_date))
            : addMonths(currentMonth, 6)

        const months: MonthGroup[] = []
        let cursor = isBefore(startDate, currentMonth) ? startDate : currentMonth
        const finalMonth = addMonths(endDate, 1)

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

        const unscheduled: (IdealItem & { idealId: string; idealTitle: string; idealColor: string })[] = []

        for (const item of items) {
            const enriched = { ...item, idealId: ideal.id, idealTitle: ideal.title, idealColor: color }

            if (item.scheduled_date) {
                const itemMonth = format(new Date(item.scheduled_date), 'yyyy-MM')
                const group = months.find(m => m.key === itemMonth)
                if (group) {
                    group.items.push(enriched)
                } else {
                    unscheduled.push(enriched)
                }
            } else {
                unscheduled.push(enriched)
            }
        }

        for (const m of months) {
            m.items.sort((a, b) => {
                if (a.scheduled_date && b.scheduled_date) {
                    return a.scheduled_date.localeCompare(b.scheduled_date)
                }
                return a.display_order - b.display_order
            })
        }

        const monthGroups = months.filter(m => m.items.length > 0 || m.isCurrent || !m.isPast)

        return { monthGroups, unscheduledItems: unscheduled }
    }, [ideal, items, color])

    const completedCount = items.filter(i => i.is_done).length
    const totalCount = items.length

    const handleToggleDone = async (item: IdealItem) => {
        await fetch(`/api/ideals/${ideal.id}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_done: !item.is_done }),
        })
        onItemsChanged()
    }

    const handleAddItem = async (monthKey: string) => {
        if (!newTitle.trim()) return
        setIsSaving(true)
        try {
            const scheduledDate = `${monthKey}-01`
            await fetch(`/api/ideals/${ideal.id}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTitle.trim(),
                    item_type: newType,
                    scheduled_date: scheduledDate,
                }),
            })
            setNewTitle('')
            setNewType('action')
            setAddingMonthKey(null)
            onItemsChanged()
        } finally {
            setIsSaving(false)
        }
    }

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
                                "flex items-center justify-between px-4 py-2 text-xs font-medium border-b",
                                month.isCurrent
                                    ? "bg-primary/5 text-primary"
                                    : month.isPast
                                        ? "bg-muted/30 text-muted-foreground"
                                        : "bg-muted/10 text-muted-foreground"
                            )}>
                                <span>
                                    {month.label}
                                    {month.isCurrent && <span className="ml-1.5 text-[10px]">(今月)</span>}
                                </span>
                                <button
                                    onClick={() => setAddingMonthKey(addingMonthKey === month.key ? null : month.key)}
                                    className="p-1.5 -mr-1 rounded-md hover:bg-primary/10 active:bg-primary/20 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Inline add form */}
                            {addingMonthKey === month.key && (
                                <div className="px-4 py-2 border-b bg-muted/20 space-y-2">
                                    <div className="flex gap-2">
                                        <Input
                                            autoFocus
                                            placeholder="アイテム名"
                                            value={newTitle}
                                            onChange={e => setNewTitle(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleAddItem(month.key)
                                                if (e.key === 'Escape') { setAddingMonthKey(null); setNewTitle('') }
                                            }}
                                            className="h-8 text-sm flex-1"
                                        />
                                        <select
                                            value={newType}
                                            onChange={e => setNewType(e.target.value as IdealItemType)}
                                            className="h-8 rounded-md border border-input bg-background px-2 text-xs w-24"
                                        >
                                            <option value="action">アクション</option>
                                            <option value="milestone">マイルストーン</option>
                                            <option value="cost">費用</option>
                                            <option value="habit">定期行動</option>
                                        </select>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleAddItem(month.key)}
                                            disabled={isSaving || !newTitle.trim()}
                                            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                                        >
                                            {isSaving ? '追加中...' : '追加'}
                                        </button>
                                        <button
                                            onClick={() => { setAddingMonthKey(null); setNewTitle('') }}
                                            className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            キャンセル
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Items in this month */}
                            {month.items.length > 0 ? (
                                <div className="divide-y">
                                    {month.items.map(item => (
                                        <TimelineItem
                                            key={item.id}
                                            item={item}
                                            onToggleDone={() => handleToggleDone(item)}
                                            onSelect={() => onSelectItem?.(ideal.id, item.id)}
                                        />
                                    ))}
                                </div>
                            ) : addingMonthKey !== month.key ? (
                                <div className="px-4 py-3 text-xs text-muted-foreground/40 italic">
                                    予定なし
                                </div>
                            ) : null}
                        </div>
                    ))}

                    {/* Unscheduled section */}
                    {unscheduledItems.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between px-4 py-2 text-xs font-medium border-b bg-amber-500/5 text-amber-600">
                                <span>未スケジュール</span>
                                <button
                                    onClick={() => setAddingMonthKey(addingMonthKey === '__unscheduled' ? null : '__unscheduled')}
                                    className="p-1.5 -mr-1 rounded-md hover:bg-amber-500/10 active:bg-amber-500/20 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {addingMonthKey === '__unscheduled' && (
                                <div className="px-4 py-2 border-b bg-muted/20 space-y-2">
                                    <div className="flex gap-2">
                                        <Input
                                            autoFocus
                                            placeholder="アイテム名"
                                            value={newTitle}
                                            onChange={e => setNewTitle(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleAddUnscheduled()
                                                if (e.key === 'Escape') { setAddingMonthKey(null); setNewTitle('') }
                                            }}
                                            className="h-8 text-sm flex-1"
                                        />
                                        <select
                                            value={newType}
                                            onChange={e => setNewType(e.target.value as IdealItemType)}
                                            className="h-8 rounded-md border border-input bg-background px-2 text-xs w-24"
                                        >
                                            <option value="action">アクション</option>
                                            <option value="milestone">マイルストーン</option>
                                            <option value="cost">費用</option>
                                            <option value="habit">定期行動</option>
                                        </select>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleAddUnscheduled}
                                            disabled={isSaving || !newTitle.trim()}
                                            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                                        >
                                            {isSaving ? '追加中...' : '追加'}
                                        </button>
                                        <button
                                            onClick={() => { setAddingMonthKey(null); setNewTitle('') }}
                                            className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            キャンセル
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="divide-y">
                                {unscheduledItems.map(item => (
                                    <TimelineItem
                                        key={item.id}
                                        item={item}
                                        onToggleDone={() => handleToggleDone(item)}
                                        onSelect={() => onSelectItem?.(ideal.id, item.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )

    async function handleAddUnscheduled() {
        if (!newTitle.trim()) return
        setIsSaving(true)
        try {
            await fetch(`/api/ideals/${ideal.id}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTitle.trim(),
                    item_type: newType,
                }),
            })
            setNewTitle('')
            setNewType('action')
            setAddingMonthKey(null)
            onItemsChanged()
        } finally {
            setIsSaving(false)
        }
    }
}

function TimelineItem({ item, onToggleDone, onSelect }: {
    item: IdealItem & { idealId: string; idealTitle: string; idealColor: string }
    onToggleDone: () => void
    onSelect: () => void
}) {
    const isDone = item.is_done ?? false
    const ct = (item.cost_type || 'once') as CostType

    return (
        <div
            className={cn(
                "flex items-center gap-3 px-4 py-3 min-h-[44px] text-sm cursor-pointer hover:bg-muted/50 active:bg-muted/70 transition-colors",
                isDone && "opacity-50"
            )}
            onClick={onSelect}
        >
            {/* Type icon — tappable for toggle */}
            <button
                onClick={(e) => { e.stopPropagation(); onToggleDone() }}
                className="flex-shrink-0 p-1 -m-1 rounded-md active:bg-muted"
            >
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
            </button>

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

            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
        </div>
    )
}
