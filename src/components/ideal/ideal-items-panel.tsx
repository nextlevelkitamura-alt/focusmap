"use client"

import { useState, useMemo } from "react"
import { IdealGoalWithItems, IdealItem, IdealItemWithDetails, IdealItemType, FrequencyType, calcDailyMinutes } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Plus, CheckCircle2, Circle, Trash2, Clock, Wallet, Milestone, Link2, Calendar, ImageIcon, FileText, ChevronRight, ChevronDown, Repeat, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { IdealItemLinkPicker } from "./ideal-item-link-picker"
import { IdealItemDetail } from "./ideal-item-detail"

interface IdealItemsPanelProps {
    ideal: IdealGoalWithItems
    onItemsChanged: () => void
    onClose: () => void
}

const ITEM_TYPE_CHIPS: { value: IdealItemType; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: 'habit',     label: '習慣',     icon: <Repeat className="h-3 w-3" />,    desc: '繰り返す' },
    { value: 'action',    label: 'やること', icon: <CheckCircle2 className="h-3 w-3" />, desc: '1回きり' },
    { value: 'cost',      label: '費用',     icon: <Wallet className="h-3 w-3" />,     desc: 'お金' },
    { value: 'milestone', label: '目標',     icon: <Target className="h-3 w-3" />,     desc: '達成点' },
]

const HABIT_DAYS = [
    { key: 'mon', label: '月' },
    { key: 'tue', label: '火' },
    { key: 'wed', label: '水' },
    { key: 'thu', label: '木' },
    { key: 'fri', label: '金' },
    { key: 'sat', label: '土' },
    { key: 'sun', label: '日' },
] as const

const DAY_PRESETS = [
    { label: '毎日', val: 'mon,tue,wed,thu,fri,sat,sun' },
    { label: '平日', val: 'mon,tue,wed,thu,fri' },
    { label: '土日', val: 'sat,sun' },
]

type ItemWithChildren = IdealItem & { children: IdealItem[] }

function buildItemTree(items: IdealItem[]): { roots: ItemWithChildren[]; orphans: IdealItem[] } {
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
    const [isBulkMode, setIsBulkMode] = useState(false)
    const [addingParentId, setAddingParentId] = useState<string | null>(null)
    const [newTitle, setNewTitle] = useState('')
    const [bulkTitles, setBulkTitles] = useState('')
    const [newType, setNewType] = useState<IdealItemType>('habit')
    const [newHabitDays, setNewHabitDays] = useState('mon,tue,wed,thu,fri,sat,sun')
    const [newSessionMin, setNewSessionMin] = useState(15)
    const [newCost, setNewCost] = useState('')
    const [newCostType, setNewCostType] = useState<'once' | 'monthly' | 'annual'>('once')
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
                onItemChanged={onItemsChanged}
            />
        )
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
        setIsBulkMode(false)
        setNewType('action')
        setNewTitle('')
        setBulkTitles('')
        setNewCost('')
    }

    const startAddingRootItem = () => {
        setAddingParentId(null)
        setIsAdding(true)
        setIsBulkMode(false)
        setNewType('habit')
        setNewTitle('')
        setBulkTitles('')
        setNewCost('')
    }

    const selectedDaySet = new Set(newHabitDays.split(',').filter(Boolean))
    const selectedDayCount = selectedDaySet.size

    const toggleDay = (key: string) => {
        const next = new Set(selectedDaySet)
        if (next.has(key)) next.delete(key); else next.add(key)
        const newVal = HABIT_DAYS.map(d => d.key).filter(k => next.has(k)).join(',')
        setNewHabitDays(newVal)
    }

    const buildItemBody = (title: string): Record<string, unknown> => {
        const body: Record<string, unknown> = {
            title: title.trim(),
            item_type: newType,
        }
        if (addingParentId) {
            body.parent_item_id = addingParentId
        }
        if (newType === 'habit') {
            // 曜日選択を frequency_type/value に変換
            if (selectedDayCount === 7 || selectedDayCount === 0) {
                body.frequency_type = 'daily'
                body.frequency_value = 1
            } else {
                body.frequency_type = 'weekly'
                body.frequency_value = selectedDayCount
            }
            body.session_minutes = newSessionMin
            body.daily_minutes = calcDailyMinutes(
                body.frequency_type as FrequencyType,
                body.frequency_value as number,
                newSessionMin
            )
        }
        if (newType === 'cost' && newCost) {
            body.item_cost = Number(newCost)
            body.cost_type = newCostType
        }
        return body
    }

    const handleAddItem = async () => {
        if (isBulkMode) {
            const titles = bulkTitles.split('\n').map(t => t.trim()).filter(Boolean)
            if (titles.length === 0) return
            setIsSaving(true)
            try {
                for (const title of titles) {
                    await fetch(`/api/ideals/${ideal.id}/items`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildItemBody(title)),
                    })
                }
                resetForm()
                onItemsChanged()
            } finally {
                setIsSaving(false)
            }
        } else {
            if (!newTitle.trim()) return
            setIsSaving(true)
            try {
                await fetch(`/api/ideals/${ideal.id}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildItemBody(newTitle)),
                })
                resetForm()
                onItemsChanged()
            } finally {
                setIsSaving(false)
            }
        }
    }

    const resetForm = () => {
        setNewTitle('')
        setBulkTitles('')
        setNewType('habit')
        setNewHabitDays('mon,tue,wed,thu,fri,sat,sun')
        setNewSessionMin(15)
        setNewCost('')
        setIsAdding(false)
        setIsBulkMode(false)
        setAddingParentId(null)
    }

    const formatItemMeta = (item: IdealItem): string => {
        if (item.item_type === 'cost') {
            const costLabel = item.cost_type === 'monthly' ? '/月' : item.cost_type === 'annual' ? '/年' : '(一括)'
            return item.item_cost ? `¥${item.item_cost.toLocaleString()}${costLabel}` : '費用未設定'
        }
        if (item.item_type === 'milestone') return '目標'
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
        if (type === 'milestone') return <Target className="h-3.5 w-3.5 text-violet-500" />
        if (type === 'habit') return <Repeat className="h-3.5 w-3.5 text-green-500" />
        return <Clock className="h-3.5 w-3.5 text-blue-500" />
    }

    const getItemTypeLabel = (type: string) => {
        const chip = ITEM_TYPE_CHIPS.find(c => c.value === type)
        return chip?.label ?? type
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
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                        {getItemIcon(item.item_type)}
                        {formatItemMeta(item)}
                    </span>
                    {(item as IdealItemWithDetails).ideal_item_images?.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <ImageIcon className="h-3 w-3" />
                            {(item as IdealItemWithDetails).ideal_item_images.length}
                        </span>
                    )}
                    {item.description && (
                        <span className="text-xs text-muted-foreground">
                            <FileText className="h-3 w-3 inline" />
                        </span>
                    )}
                </div>
                {(item.linked_task_id || item.linked_habit_id) && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setLinkingItemId(item.id) }}
                        className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                    >
                        <Link2 className="h-3 w-3" />
                        {item.linked_habit_id ? '習慣と連携中' : 'タスクと連携中'}
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

    const canSubmit = isBulkMode
        ? bulkTitles.split('\n').some(t => t.trim())
        : !!newTitle.trim()

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
                                    <span className="absolute right-16 top-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
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
                                        className="flex items-center gap-1 ml-6 pl-3 py-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <Plus className="h-3 w-3" /> ステップ追加
                                    </button>
                                </div>
                            )}

                            {/* Add first sub-item button (when no children yet) */}
                            {!hasChildren && !isCollapsed && (
                                <button
                                    onClick={() => startAddingSubItem(item.id)}
                                    className="flex items-center gap-1 ml-8 py-1 text-xs text-muted-foreground/50 hover:text-primary transition-colors"
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
                        "rounded-lg border p-3 space-y-3 bg-muted/30",
                        addingParentId && "ml-6 border-l-2 border-primary/30"
                    )}>
                        {addingParentId && (
                            <p className="text-xs text-primary font-medium">
                                ステップを追加
                            </p>
                        )}

                        {/* タイプ選択チップ */}
                        <div className="flex gap-1.5 flex-wrap">
                            {ITEM_TYPE_CHIPS.map(chip => (
                                <button
                                    key={chip.value}
                                    onClick={() => setNewType(chip.value)}
                                    className={cn(
                                        "flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs transition-colors border",
                                        newType === chip.value
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-background text-muted-foreground border-border hover:border-primary/50"
                                    )}
                                >
                                    {chip.icon}
                                    {chip.label}
                                </button>
                            ))}
                        </div>

                        {/* アイテム名入力（単一 or 複数切り替え） */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <button
                                    onClick={() => setIsBulkMode(!isBulkMode)}
                                    className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                                >
                                    {isBulkMode ? '1つずつ入力に戻す' : '複数まとめて追加'}
                                </button>
                            </div>
                            {isBulkMode ? (
                                <textarea
                                    autoFocus
                                    placeholder={"1行に1つずつ入力\n例:\nジムに通う\n英語の勉強\nプロテインを買う"}
                                    value={bulkTitles}
                                    onChange={e => setBulkTitles(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') resetForm() }}
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/40"
                                    rows={4}
                                />
                            ) : (
                                <Input
                                    autoFocus
                                    placeholder="アイテム名"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') resetForm() }}
                                    className="h-9 text-sm"
                                />
                            )}
                        </div>

                        {/* 習慣の場合のみ: 曜日選択 + 時間 */}
                        {newType === 'habit' && (
                            <div className="space-y-2">
                                {/* 曜日ボタン */}
                                <div className="flex gap-1">
                                    {HABIT_DAYS.map(({ key, label }) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => toggleDay(key)}
                                            className={cn(
                                                "flex-1 h-8 text-xs rounded-md font-medium transition-colors",
                                                selectedDaySet.has(key)
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {/* プリセット + 時間 */}
                                <div className="flex items-center gap-1.5">
                                    {DAY_PRESETS.map(p => (
                                        <button
                                            key={p.val}
                                            type="button"
                                            onClick={() => setNewHabitDays(p.val)}
                                            className={cn(
                                                "px-2 py-1 text-[11px] rounded-md transition-colors",
                                                newHabitDays === p.val
                                                    ? "bg-primary/20 text-primary font-medium"
                                                    : "text-muted-foreground hover:bg-muted/50 border border-border"
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                    <div className="flex items-center gap-1 ml-auto">
                                        <Input
                                            type="number"
                                            min={1}
                                            value={newSessionMin}
                                            onChange={e => setNewSessionMin(Number(e.target.value))}
                                            className="h-7 w-14 text-xs"
                                        />
                                        <span className="text-xs text-muted-foreground">分</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 費用の場合のみ: 金額入力 */}
                        {newType === 'cost' && (
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder="金額（円）"
                                    value={newCost}
                                    onChange={e => setNewCost(e.target.value)}
                                    className="h-8 text-xs flex-1"
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
                        )}

                        {/* ボタン */}
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddItem} disabled={isSaving || !canSubmit} className="flex-1">
                                {isSaving ? '追加中...' : isBulkMode ? 'まとめて追加' : '追加'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={resetForm}>
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
