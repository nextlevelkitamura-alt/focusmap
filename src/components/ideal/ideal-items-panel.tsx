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
    const [newStartDate, setNewStartDate] = useState('')
    const [newEndDate, setNewEndDate] = useState('')
    const [newMonthlyAmount, setNewMonthlyAmount] = useState('')
    const [newPayDay, setNewPayDay] = useState(25)
    const [newSubtasks, setNewSubtasks] = useState<string[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [linkingItemId, setLinkingItemId] = useState<string | null>(null)
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
    const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

    const items = ideal.ideal_items ?? []
    const { roots } = useMemo(() => buildItemTree(items), [items])

    // アイテム詳細画面（画像・候補管理）へのドリルダウン
    const detailItemId = selectedItemId?.endsWith('_detail') ? selectedItemId.replace('_detail', '') : null
    const detailItem = detailItemId ? items.find(i => i.id === detailItemId) : null
    if (detailItem) {
        const itemWithDetails: IdealItemWithDetails = {
            ...detailItem,
            ideal_item_images: (detailItem as IdealItemWithDetails).ideal_item_images ?? [],
            ideal_candidates: (detailItem as IdealItemWithDetails).ideal_candidates ?? [],
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

    // 貯蓄の月額自動計算
    const autoMonthlyAmount = useMemo(() => {
        if (newCostType !== 'annual' || !newCost || !newEndDate) return 0
        const target = Number(newCost)
        if (!target) return 0
        const now = new Date()
        const end = new Date(newEndDate + 'T00:00:00')
        const months = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30)))
        return Math.ceil(target / months)
    }, [newCost, newEndDate, newCostType])

    const effectiveMonthlyAmount = newMonthlyAmount ? Number(newMonthlyAmount) : autoMonthlyAmount

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
        // 日付
        if (newType === 'habit') {
            if (newEndDate) body.scheduled_date = newEndDate
            if (newStartDate) body.description = `開始: ${newStartDate}`
        } else if (newEndDate) {
            body.scheduled_date = newEndDate
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
                const res = await fetch(`/api/ideals/${ideal.id}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildItemBody(newTitle)),
                })
                if (res.ok) {
                    const { item: parentItem } = await res.json()

                    // サブタスクがあれば一括作成
                    const subtaskTitles = newSubtasks.filter(s => s.trim())
                    for (const subTitle of subtaskTitles) {
                        await fetch(`/api/ideals/${ideal.id}/items`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: subTitle.trim(),
                                item_type: 'action',
                                parent_item_id: parentItem.id,
                            }),
                        })
                    }

                    // 費用「貯めて買う」→ 貯蓄習慣を自動作成
                    if (newType === 'cost' && newCostType === 'annual' && effectiveMonthlyAmount > 0) {
                        await fetch(`/api/ideals/${ideal.id}/items`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: `毎月¥${effectiveMonthlyAmount.toLocaleString()}を貯蓄`,
                                item_type: 'habit',
                                frequency_type: 'monthly',
                                frequency_value: 1,
                                session_minutes: 5,
                                parent_item_id: parentItem.id,
                                description: `毎月${newPayDay}日に貯蓄 / 目標: ¥${Number(newCost).toLocaleString()} / 期限: ${newEndDate}`,
                            }),
                        })
                    }

                    // 費用「月額サブスク」→ 支払い習慣を自動作成
                    if (newType === 'cost' && newCostType === 'monthly' && newCost) {
                        await fetch(`/api/ideals/${ideal.id}/items`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: `毎月¥${Number(newCost).toLocaleString()}の支払い`,
                                item_type: 'habit',
                                frequency_type: 'monthly',
                                frequency_value: 1,
                                session_minutes: 5,
                                parent_item_id: parentItem.id,
                                description: `毎月${newPayDay}日に支払い`,
                            }),
                        })
                    }
                }
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
        setNewStartDate('')
        setNewEndDate('')
        setNewMonthlyAmount('')
        setNewPayDay(25)
        setNewSubtasks([])
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

    // インライン編集の保存（複数フィールド対応）
    const handleInlineSave = async (itemId: string, updates: Record<string, unknown>) => {
        await fetch(`/api/ideals/${ideal.id}/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
        onItemsChanged()
    }

    const renderItemRow = (item: IdealItem, isChild = false) => {
        const isExpanded = selectedItemId === item.id
        return (
            <div key={item.id}>
                {/* アイテム行 */}
                <div
                    className={cn(
                        "flex items-center gap-2.5 p-3 rounded-lg cursor-pointer transition-colors",
                        isExpanded ? "bg-muted/60" : "hover:bg-muted/40 active:bg-muted/60",
                        isChild && "py-2"
                    )}
                    onClick={() => setSelectedItemId(isExpanded ? null : item.id)}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); handleToggleDone(item) }}
                        className="flex-shrink-0"
                    >
                        {item.is_done
                            ? <CheckCircle2 className="h-5 w-5 text-primary" />
                            : <Circle className="h-5 w-5 text-muted-foreground/40" />
                        }
                    </button>
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
                        </div>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item) }}
                        className="p-1.5 rounded-md text-muted-foreground/30 hover:text-destructive transition-colors flex-shrink-0"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
                    }
                </div>

                {/* インライン編集パネル */}
                {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 animate-in slide-in-from-top-1 duration-150">
                        <div className="ml-7 space-y-2.5 border-l-2 border-primary/20 pl-3">
                            {/* タイトル */}
                            <div>
                                <span className="text-[10px] text-muted-foreground">タイトル</span>
                                <Input
                                    defaultValue={item.title}
                                    onBlur={e => {
                                        if (e.target.value.trim() && e.target.value !== item.title)
                                            handleInlineSave(item.id, { title: e.target.value.trim() })
                                    }}
                                    className="h-8 text-sm mt-0.5"
                                />
                            </div>

                            {/* 頻度・時間（habit/action） */}
                            {(item.item_type === 'habit' || item.item_type === 'action') && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <select
                                        defaultValue={item.frequency_type || 'daily'}
                                        onChange={e => {
                                            const ft = e.target.value as FrequencyType
                                            const fv = ft === 'daily' ? 1 : (item.frequency_value || 1)
                                            handleInlineSave(item.id, {
                                                frequency_type: ft,
                                                frequency_value: fv,
                                                daily_minutes: calcDailyMinutes(ft, fv, item.session_minutes),
                                            })
                                        }}
                                        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                                    >
                                        <option value="daily">毎日</option>
                                        <option value="weekly">週N回</option>
                                        <option value="monthly">月N回</option>
                                        <option value="once">単発</option>
                                    </select>
                                    {(item.frequency_type === 'weekly' || item.frequency_type === 'monthly') && (
                                        <Input
                                            type="number"
                                            min={1}
                                            defaultValue={item.frequency_value || 1}
                                            onBlur={e => {
                                                const fv = Number(e.target.value) || 1
                                                handleInlineSave(item.id, {
                                                    frequency_value: fv,
                                                    daily_minutes: calcDailyMinutes(item.frequency_type as FrequencyType, fv, item.session_minutes),
                                                })
                                            }}
                                            className="h-7 w-14 text-xs"
                                            placeholder="回"
                                        />
                                    )}
                                    {item.frequency_type !== 'once' && (
                                        <div className="flex items-center gap-1">
                                            <Input
                                                type="number"
                                                min={1}
                                                defaultValue={item.session_minutes || 15}
                                                onBlur={e => {
                                                    const sm = Number(e.target.value) || 15
                                                    handleInlineSave(item.id, {
                                                        session_minutes: sm,
                                                        daily_minutes: calcDailyMinutes(item.frequency_type as FrequencyType, item.frequency_value, sm),
                                                    })
                                                }}
                                                className="h-7 w-14 text-xs"
                                            />
                                            <span className="text-xs text-muted-foreground">分</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 費用（cost） */}
                            {item.item_type === 'cost' && (
                                <div className="flex items-center gap-2">
                                    <Wallet className="h-3 w-3 text-amber-500 flex-shrink-0" />
                                    <Input
                                        type="number"
                                        min={0}
                                        defaultValue={item.item_cost || ''}
                                        placeholder="金額"
                                        onBlur={e => {
                                            const cost = Number(e.target.value) || null
                                            handleInlineSave(item.id, { item_cost: cost })
                                        }}
                                        className="h-7 text-xs flex-1"
                                    />
                                    <span className="text-xs text-muted-foreground">円</span>
                                    <select
                                        defaultValue={item.cost_type || 'once'}
                                        onChange={e => handleInlineSave(item.id, { cost_type: e.target.value })}
                                        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                                    >
                                        <option value="once">一括</option>
                                        <option value="monthly">月額</option>
                                        <option value="annual">貯蓄</option>
                                    </select>
                                </div>
                            )}

                            {/* 予定日 */}
                            <div className="flex items-center gap-2">
                                <Calendar className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <span className="text-[10px] text-muted-foreground">予定日</span>
                                <input
                                    type="date"
                                    defaultValue={item.scheduled_date || ''}
                                    onChange={e => handleInlineSave(item.id, { scheduled_date: e.target.value || null })}
                                    className="h-7 px-2 text-xs border rounded-md bg-background"
                                />
                            </div>

                            {/* メモ */}
                            <div>
                                <span className="text-[10px] text-muted-foreground">メモ</span>
                                <textarea
                                    defaultValue={item.description || ''}
                                    placeholder="メモを入力..."
                                    onBlur={e => {
                                        if (e.target.value !== (item.description || ''))
                                            handleInlineSave(item.id, { description: e.target.value || null })
                                    }}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none mt-0.5"
                                    rows={2}
                                />
                            </div>

                            {/* 連携 + 詳細 */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setLinkingItemId(item.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors"
                                >
                                    <Link2 className="h-3 w-3" />
                                    {item.linked_habit_id ? '習慣連携中' : item.linked_task_id ? 'タスク連携中' : '連携'}
                                </button>
                                <button
                                    onClick={() => setSelectedItemId(item.id + '_detail')}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors ml-auto"
                                >
                                    <ImageIcon className="h-3 w-3" />
                                    画像・候補
                                    <ChevronRight className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }

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
                        <div key={item.id} className={cn(
                            "border rounded-lg transition-all",
                            hasChildren && !isCollapsed && "border-border",
                            hasChildren && isCollapsed && "border-border/50",
                            !hasChildren && "border-transparent"
                        )}>
                            {/* 親アイテム行 */}
                            <div className="flex items-center">
                                {hasChildren && (
                                    <button
                                        onClick={() => toggleCollapse(item.id)}
                                        className="p-2 text-muted-foreground hover:text-foreground flex-shrink-0"
                                    >
                                        {isCollapsed
                                            ? <ChevronRight className="h-4 w-4" />
                                            : <ChevronDown className="h-4 w-4" />
                                        }
                                    </button>
                                )}
                                <div className={cn("flex-1 min-w-0", !hasChildren && "pl-1")}>
                                    {renderItemRow(item)}
                                </div>
                                {hasChildren && (
                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full mr-3 flex-shrink-0">
                                        {doneCount}/{item.children.length}
                                    </span>
                                )}
                            </div>

                            {/* 子アイテム（展開時） */}
                            {hasChildren && !isCollapsed && (
                                <div className="border-t px-2 pb-2 space-y-0 animate-in slide-in-from-top-1 duration-150">
                                    {item.children.map(child => (
                                        <div key={child.id} className="ml-6">
                                            {renderItemRow(child, true)}
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => startAddingSubItem(item.id)}
                                        className="flex items-center gap-1 ml-8 py-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <Plus className="h-3 w-3" /> ステップ追加
                                    </button>
                                </div>
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

                        {/* 習慣の場合: 曜日選択 + 時間 + 期間 */}
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
                                {/* 期間 */}
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 space-y-0.5">
                                        <span className="text-[11px] text-muted-foreground">開始日</span>
                                        <input
                                            type="date"
                                            value={newStartDate}
                                            onChange={e => setNewStartDate(e.target.value)}
                                            className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                                        />
                                    </div>
                                    <span className="text-muted-foreground mt-4">〜</span>
                                    <div className="flex-1 space-y-0.5">
                                        <span className="text-[11px] text-muted-foreground">終了日</span>
                                        <input
                                            type="date"
                                            value={newEndDate}
                                            onChange={e => setNewEndDate(e.target.value)}
                                            className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* やることの場合: 期限 */}
                        {newType === 'action' && (
                            <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="text-xs text-muted-foreground flex-shrink-0">期限</span>
                                <input
                                    type="date"
                                    value={newEndDate}
                                    onChange={e => setNewEndDate(e.target.value)}
                                    className="flex-1 h-8 px-2 text-xs border rounded-md bg-background"
                                />
                            </div>
                        )}

                        {/* 費用の場合: 金額 + 支払い形態 + 期限 */}
                        {newType === 'cost' && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        placeholder="金額（円）"
                                        value={newCost}
                                        onChange={e => setNewCost(e.target.value)}
                                        className="h-8 text-xs flex-1"
                                    />
                                </div>
                                {/* 支払い形態チップ */}
                                <div className="flex gap-1.5">
                                    {([
                                        { value: 'once', label: '一括購入' },
                                        { value: 'monthly', label: '月額サブスク' },
                                        { value: 'annual', label: '貯めて買う' },
                                    ] as const).map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setNewCostType(opt.value)}
                                            className={cn(
                                                "px-2 py-1 text-[11px] rounded-md transition-colors flex-1",
                                                newCostType === opt.value
                                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium"
                                                    : "text-muted-foreground hover:bg-muted/50 border border-border"
                                            )}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {/* 一括購入: 購入予定日 */}
                                {newCostType === 'once' && (
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                        <span className="text-xs text-muted-foreground flex-shrink-0">購入予定</span>
                                        <input
                                            type="date"
                                            value={newEndDate}
                                            onChange={e => setNewEndDate(e.target.value)}
                                            className="flex-1 h-8 px-2 text-xs border rounded-md bg-background"
                                        />
                                    </div>
                                )}

                                {/* 月額サブスク: 支払日 */}
                                {newCostType === 'monthly' && (
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                        <span className="text-xs text-muted-foreground flex-shrink-0">毎月</span>
                                        <select
                                            value={newPayDay}
                                            onChange={e => setNewPayDay(Number(e.target.value))}
                                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                        >
                                            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                                <option key={d} value={d}>{d}日</option>
                                            ))}
                                        </select>
                                        <span className="text-xs text-muted-foreground">に支払い</span>
                                    </div>
                                )}

                                {/* 貯めて買う: 期限 + 月額 + 貯蓄日 */}
                                {newCostType === 'annual' && (
                                    <div className="space-y-2 p-2 rounded-md bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-800/30">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                                            <span className="text-xs text-muted-foreground flex-shrink-0">購入期限</span>
                                            <input
                                                type="date"
                                                value={newEndDate}
                                                onChange={e => setNewEndDate(e.target.value)}
                                                className="flex-1 h-8 px-2 text-xs border rounded-md bg-background"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Wallet className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                                            <span className="text-xs text-muted-foreground flex-shrink-0">毎月</span>
                                            <Input
                                                type="number"
                                                min={1}
                                                placeholder={autoMonthlyAmount > 0 ? `¥${autoMonthlyAmount.toLocaleString()}` : '金額'}
                                                value={newMonthlyAmount}
                                                onChange={e => setNewMonthlyAmount(e.target.value)}
                                                className="h-8 text-xs flex-1"
                                            />
                                            <span className="text-xs text-muted-foreground">円</span>
                                        </div>
                                        {autoMonthlyAmount > 0 && !newMonthlyAmount && (
                                            <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                                自動計算: 毎月 ¥{autoMonthlyAmount.toLocaleString()} × {Math.max(1, Math.ceil((new Date(newEndDate + 'T00:00:00').getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)))}ヶ月
                                            </p>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground flex-shrink-0">毎月</span>
                                            <select
                                                value={newPayDay}
                                                onChange={e => setNewPayDay(Number(e.target.value))}
                                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                            >
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                                    <option key={d} value={d}>{d}日</option>
                                                ))}
                                            </select>
                                            <span className="text-xs text-muted-foreground">に貯蓄する</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* サブタスク（ルートアイテム + 単一追加モード時のみ） */}
                        {!addingParentId && !isBulkMode && (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-muted-foreground">サブタスク（任意）</span>
                                    {newSubtasks.length === 0 && (
                                        <button
                                            onClick={() => setNewSubtasks([''])}
                                            className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
                                        >
                                            <Plus className="h-3 w-3" /> 追加
                                        </button>
                                    )}
                                </div>
                                {newSubtasks.map((sub, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5 pl-3 border-l-2 border-muted">
                                        <Circle className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                                        <Input
                                            placeholder={`サブタスク ${idx + 1}`}
                                            value={sub}
                                            onChange={e => {
                                                const next = [...newSubtasks]
                                                next[idx] = e.target.value
                                                setNewSubtasks(next)
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault()
                                                    setNewSubtasks([...newSubtasks, ''])
                                                }
                                                if (e.key === 'Backspace' && !sub && newSubtasks.length > 1) {
                                                    const next = newSubtasks.filter((_, i) => i !== idx)
                                                    setNewSubtasks(next)
                                                }
                                            }}
                                            className="h-7 text-xs flex-1"
                                            autoFocus={idx === newSubtasks.length - 1 && idx > 0}
                                        />
                                        <button
                                            onClick={() => setNewSubtasks(newSubtasks.filter((_, i) => i !== idx))}
                                            className="text-muted-foreground/30 hover:text-destructive transition-colors p-0.5"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                                {newSubtasks.length > 0 && (
                                    <button
                                        onClick={() => setNewSubtasks([...newSubtasks, ''])}
                                        className="flex items-center gap-0.5 pl-3 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <Plus className="h-3 w-3" /> サブタスクを追加
                                    </button>
                                )}
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
