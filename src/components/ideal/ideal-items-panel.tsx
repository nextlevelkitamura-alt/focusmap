"use client"

import { useState, useMemo } from "react"
import { IdealGoalWithItems, IdealItem, IdealItemWithDetails, IdealItemType, FrequencyType, calcDailyMinutes } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Plus, CheckCircle2, Circle, Trash2, Clock, Wallet, Milestone, Link2, Calendar, ImageIcon, FileText, ChevronRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { IdealItemLinkPicker } from "./ideal-item-link-picker"
import { IdealItemDetail } from "./ideal-item-detail"

interface IdealItemsPanelProps {
    ideal: IdealGoalWithItems
    onItemsChanged: () => void
    onClose: () => void
}

const ITEM_TYPE_LABELS: Record<IdealItemType, string> = {
    habit:     '定期行動',
    action:    '単発アクション',
    cost:      '費用',
    milestone: 'マイルストーン',
}

const FREQUENCY_OPTIONS: { value: FrequencyType; label: string }[] = [
    { value: 'daily',   label: '毎日' },
    { value: 'weekly',  label: '週N回' },
    { value: 'monthly', label: '月N回' },
    { value: 'once',    label: '単発（1回のみ）' },
]

type ItemWithChildren = IdealItem & { children: IdealItem[] }

function buildItemTree(items: IdealItem[]): { roots: ItemWithChildren[]; orphans: IdealItem[] } {
    const itemMap = new Map(items.map(i => [i.id, i]))
    const childrenMap = new Map<string, IdealItem[]>()
    const roots: ItemWithChildren[] = []
    const orphans: IdealItem[] = []

    for (const item of items) {
        if (item.parent_item_id) {
            const children = childrenMap.get(item.parent_item_id) ?? []
            children.push(item)
            childrenMap.set(item.parent_item_id, children)
        }
    }

    for (const item of items) {
        if (!item.parent_item_id) {
            const children = (childrenMap.get(item.id) ?? []).sort((a, b) => a.display_order - b.display_order)
            roots.push({ ...item, children })
        }
    }

    return { roots, orphans }
}

export function IdealItemsPanel({ ideal, onItemsChanged, onClose }: IdealItemsPanelProps) {
    const [isAdding, setIsAdding] = useState(false)
    const [addingParentId, setAddingParentId] = useState<string | null>(null)
    const [newTitle, setNewTitle] = useState('')
    const [newType, setNewType] = useState<IdealItemType>('habit')
    const [newFreqType, setNewFreqType] = useState<FrequencyType>('daily')
    const [newFreqValue, setNewFreqValue] = useState(1)
    const [newSessionMin, setNewSessionMin] = useState(15)
    const [newCost, setNewCost] = useState('')
    const [newCostType, setNewCostType] = useState<'once' | 'monthly' | 'annual'>('once')
    const [newDescription, setNewDescription] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [linkingItemId, setLinkingItemId] = useState<string | null>(null)
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
    const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

    const items = ideal.ideal_items ?? []
    const { roots } = useMemo(() => buildItemTree(items), [items])

    // アイテム詳細ドリルダウン
    const selectedItem = selectedItemId ? items.find(i => i.id === selectedItemId) : null
    if (selectedItem) {
        const itemWithDetails: IdealItemWithDetails = {
            ...selectedItem,
            ideal_item_images: (selectedItem as IdealItemWithDetails).ideal_item_images ?? [],
            ideal_candidates: (selectedItem as IdealItemWithDetails).ideal_candidates ?? [],
        }
        return (
            <IdealItemDetail
                item={itemWithDetails}
                idealId={ideal.id}
                onBack={() => setSelectedItemId(null)}
                onItemChanged={onItemChanged}
            />
        )
    }

    function onItemChanged() {
        onItemsChanged()
    }

    const handleToggleDone = async (item: IdealItem) => {
        await fetch(`/api/ideals/${ideal.id}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_done: !item.is_done }),
        })
        onItemsChanged()
    }

    const handleDelete = async (item: IdealItem) => {
        if (!window.confirm(`「${item.title}」を削除しますか？`)) return
        await fetch(`/api/ideals/${ideal.id}/items/${item.id}`, { method: 'DELETE' })
        onItemsChanged()
    }

    const startAddingSubItem = (parentId: string) => {
        setAddingParentId(parentId)
        setIsAdding(true)
        setNewType('action')
        setNewTitle('')
        setNewCost('')
    }

    const startAddingRootItem = () => {
        setAddingParentId(null)
        setIsAdding(true)
        setNewType('habit')
        setNewTitle('')
        setNewCost('')
    }

    const handleAddItem = async () => {
        if (!newTitle.trim()) return
        setIsSaving(true)
        try {
            const body: Record<string, unknown> = {
                title: newTitle.trim(),
                item_type: newType,
            }
            if (addingParentId) {
                body.parent_item_id = addingParentId
            }
            if (newType === 'habit' || newType === 'action') {
                body.frequency_type = newFreqType
                body.frequency_value = newFreqValue
                body.session_minutes = newSessionMin
                body.daily_minutes = calcDailyMinutes(newFreqType, newFreqValue, newSessionMin)
            }
            if (newCost) {
                body.item_cost = Number(newCost)
                body.cost_type = newCostType
            }
            if (newDescription.trim()) {
                body.description = newDescription.trim()
            }

            await fetch(`/api/ideals/${ideal.id}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })

            setNewTitle('')
            setNewType('habit')
            setNewFreqType('daily')
            setNewFreqValue(1)
            setNewSessionMin(15)
            setNewCost('')
            setNewDescription('')
            setIsAdding(false)
            setAddingParentId(null)
            onItemsChanged()
        } finally {
            setIsSaving(false)
        }
    }

    const formatItemMeta = (item: IdealItem): string => {
        if (item.item_type === 'cost') {
            const costLabel = item.cost_type === 'monthly' ? '/月' : item.cost_type === 'annual' ? '/年' : '(一括)'
            return item.item_cost ? `¥${item.item_cost.toLocaleString()}${costLabel}` : '費用未設定'
        }
        if (item.frequency_type === 'once') return '単発'
        if (item.frequency_type === 'daily') return `毎日 ${item.session_minutes}分`
        if (item.frequency_type === 'weekly') return `週${item.frequency_value}回・${item.session_minutes}分`
        if (item.frequency_type === 'monthly') return `月${item.frequency_value}回・${item.session_minutes}分`
        return ''
    }

    const handleLink = async (itemId: string, link: { taskId?: string | null; habitId?: string | null }) => {
        await fetch(`/api/ideals/${ideal.id}/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                linked_task_id: link.taskId ?? null,
                linked_habit_id: link.habitId ?? null,
            }),
        })
        onItemsChanged()
    }

    const getItemIcon = (type: string) => {
        if (type === 'cost') return <Wallet className="h-3.5 w-3.5 text-amber-500" />
        if (type === 'milestone') return <Milestone className="h-3.5 w-3.5 text-violet-500" />
        return <Clock className="h-3.5 w-3.5 text-blue-500" />
    }

    const toggleCollapse = (id: string) => {
        setCollapsedParents(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const renderItem = (item: IdealItem, isChild = false) => (
        <div
            key={item.id}
            className={cn(
                "group flex items-start gap-2.5 p-3 rounded-lg hover:bg-muted/50 active:bg-muted/70 cursor-pointer transition-colors",
                isChild && "ml-6 border-l-2 border-muted pl-3"
            )}
            onClick={() => setSelectedItemId(item.id)}
        >
            {item.thumbnail_url ? (
                <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 border border-border">
                    <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
            ) : (
                <button
                    onClick={(e) => { e.stopPropagation(); handleToggleDone(item) }}
                    className="mt-0.5 flex-shrink-0"
                >
                    {item.is_done
                        ? <CheckCircle2 className="h-5 w-5 text-primary" />
                        : <Circle className="h-5 w-5 text-muted-foreground" />
                    }
                </button>
            )}
            <div className="flex-1 min-w-0">
                <p className={cn("text-sm", item.is_done && "line-through text-muted-foreground")}>
                    {item.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {item.scheduled_date && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Calendar className="h-2.5 w-2.5" />
                            {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        {getItemIcon(item.item_type)}
                        {formatItemMeta(item)}
                    </span>
                    {(item as IdealItemWithDetails).ideal_item_images?.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <ImageIcon className="h-2.5 w-2.5" />
                            {(item as IdealItemWithDetails).ideal_item_images.length}
                        </span>
                    )}
                    {item.description && (
                        <span className="text-[10px] text-muted-foreground">
                            <FileText className="h-2.5 w-2.5 inline" />
                        </span>
                    )}
                </div>
                {(item.linked_task_id || item.linked_habit_id) && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setLinkingItemId(item.id) }}
                        className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors"
                    >
                        <Link2 className="h-2.5 w-2.5" />
                        {item.linked_habit_id ? 'ハビット連携中' : 'タスク連携中'}
                    </button>
                )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
                <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(item) }}
                    className="p-2.5 md:p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive active:bg-destructive/10 transition-colors"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
            </div>
        </div>
    )

    return (
        <div className="flex flex-col h-full">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
                <div>
                    <p className="text-xs text-muted-foreground">アイテム</p>
                    <p className="font-medium text-sm truncate">{ideal.title}</p>
                </div>
                <button onClick={onClose} className="p-2 -mr-2 text-muted-foreground hover:text-foreground active:text-foreground">
                    <X className="h-5 w-5 md:h-4 md:w-4" />
                </button>
            </div>

            {/* アイテムリスト */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {roots.length === 0 && !isAdding && (
                    <p className="text-xs text-muted-foreground/60 text-center py-6">
                        アイテムがありません。<br />「追加」ボタンから追加してください。
                    </p>
                )}
                {roots.map(item => {
                    const hasChildren = item.children.length > 0
                    const isCollapsed = collapsedParents.has(item.id)
                    const doneCount = item.children.filter(c => c.is_done).length

                    return (
                        <div key={item.id}>
                            {/* Parent item row */}
                            <div className="relative">
                                {hasChildren && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleCollapse(item.id) }}
                                        className="absolute left-0 top-3 z-10 p-1 text-muted-foreground hover:text-foreground"
                                    >
                                        {isCollapsed
                                            ? <ChevronRight className="h-3.5 w-3.5" />
                                            : <ChevronDown className="h-3.5 w-3.5" />
                                        }
                                    </button>
                                )}
                                <div className={hasChildren ? "ml-5" : ""}>
                                    {renderItem(item)}
                                </div>
                                {/* Progress badge for parents with children */}
                                {hasChildren && (
                                    <span className="absolute right-16 top-3 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                        {doneCount}/{item.children.length}
                                    </span>
                                )}
                            </div>

                            {/* Children */}
                            {hasChildren && !isCollapsed && (
                                <div className="ml-5 space-y-0.5">
                                    {item.children.map(child => renderItem(child, true))}
                                    {/* Add sub-item button */}
                                    <button
                                        onClick={() => startAddingSubItem(item.id)}
                                        className="flex items-center gap-1 ml-6 pl-3 py-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <Plus className="h-3 w-3" /> サブアイテム追加
                                    </button>
                                </div>
                            )}

                            {/* Add first sub-item button (when no children yet) */}
                            {!hasChildren && !isCollapsed && (
                                <button
                                    onClick={() => startAddingSubItem(item.id)}
                                    className="flex items-center gap-1 ml-8 py-1 text-[10px] text-muted-foreground/50 hover:text-primary transition-colors"
                                >
                                    <Plus className="h-3 w-3" /> ステップを追加
                                </button>
                            )}
                        </div>
                    )
                })}

                {/* 追加フォーム */}
                {isAdding && (
                    <div className={cn(
                        "rounded-lg border p-3 space-y-2 bg-muted/30",
                        addingParentId && "ml-6 border-l-2 border-primary/30"
                    )}>
                        {addingParentId && (
                            <p className="text-[10px] text-primary font-medium">
                                サブアイテムを追加
                            </p>
                        )}
                        <Input
                            autoFocus
                            placeholder="アイテム名"
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') { setIsAdding(false); setAddingParentId(null) } }}
                            className="h-8 text-sm"
                        />
                        <select
                            value={newType}
                            onChange={e => setNewType(e.target.value as IdealItemType)}
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                            {(Object.entries(ITEM_TYPE_LABELS) as [IdealItemType, string][]).map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                            ))}
                        </select>

                        {/* 時間設定（habit/action） */}
                        {(newType === 'habit' || newType === 'action') && (
                            <div className="grid grid-cols-3 gap-2">
                                <select
                                    value={newFreqType}
                                    onChange={e => setNewFreqType(e.target.value as FrequencyType)}
                                    className="col-span-2 h-8 rounded-md border border-input bg-background px-2 text-xs"
                                >
                                    {FREQUENCY_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                                {newFreqType !== 'once' && (
                                    <>
                                        {(newFreqType === 'weekly' || newFreqType === 'monthly') && (
                                            <Input
                                                type="number"
                                                min={1}
                                                value={newFreqValue}
                                                onChange={e => setNewFreqValue(Number(e.target.value))}
                                                className="h-8 text-xs"
                                                placeholder="回数"
                                            />
                                        )}
                                        <div className="col-span-2 flex items-center gap-1">
                                            <Input
                                                type="number"
                                                min={1}
                                                value={newSessionMin}
                                                onChange={e => setNewSessionMin(Number(e.target.value))}
                                                className="h-8 text-xs"
                                            />
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">分/回</span>
                                        </div>
                                        <p className="col-span-3 text-[10px] text-muted-foreground">
                                            日次換算: {calcDailyMinutes(newFreqType, newFreqValue, newSessionMin)}分
                                        </p>
                                    </>
                                )}
                            </div>
                        )}

                        {/* 費用設定（全タイプ共通） */}
                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                type="number"
                                min={0}
                                placeholder="金額（円・任意）"
                                value={newCost}
                                onChange={e => setNewCost(e.target.value)}
                                className="h-8 text-xs"
                            />
                            <select
                                value={newCostType}
                                onChange={e => setNewCostType(e.target.value as 'once' | 'monthly' | 'annual')}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            >
                                <option value="once">一括</option>
                                <option value="monthly">月払い</option>
                                <option value="annual">年払い</option>
                            </select>
                        </div>

                        {/* 目的・メモ（任意） */}
                        <textarea
                            placeholder="なぜこれをやるのか？（例: 基礎体力をつけて仕事のパフォーマンスを上げる）"
                            value={newDescription}
                            onChange={e => setNewDescription(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none placeholder:text-muted-foreground/50"
                            rows={2}
                        />

                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddItem} disabled={isSaving || !newTitle.trim()} className="flex-1">
                                {isSaving ? '追加中...' : '追加'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setIsAdding(false); setAddingParentId(null) }}>
                                キャンセル
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* フッター */}
            {!isAdding && (
                <div className="border-t p-3 flex-shrink-0">
                    <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={startAddingRootItem}
                    >
                        <Plus className="h-4 w-4 mr-1" /> アイテムを追加
                    </Button>
                </div>
            )}

            {/* リンクピッカーモーダル */}
            {linkingItemId && (() => {
                const linkingItem = items.find(i => i.id === linkingItemId)
                if (!linkingItem) return null
                return (
                    <IdealItemLinkPicker
                        currentTaskId={linkingItem.linked_task_id}
                        currentHabitId={linkingItem.linked_habit_id}
                        onSelect={(link) => handleLink(linkingItemId, link)}
                        onClose={() => setLinkingItemId(null)}
                    />
                )
            })()}
        </div>
    )
}
