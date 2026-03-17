"use client"

import { useState } from "react"
import { IdealGoalWithItems, IdealItem, IdealItemType, FrequencyType, calcDailyMinutes } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Plus, CheckCircle2, Circle, Trash2, Clock, Wallet, Milestone } from "lucide-react"
import { cn } from "@/lib/utils"

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

export function IdealItemsPanel({ ideal, onItemsChanged, onClose }: IdealItemsPanelProps) {
    const [isAdding, setIsAdding] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [newType, setNewType] = useState<IdealItemType>('habit')
    const [newFreqType, setNewFreqType] = useState<FrequencyType>('daily')
    const [newFreqValue, setNewFreqValue] = useState(1)
    const [newSessionMin, setNewSessionMin] = useState(15)
    const [newCost, setNewCost] = useState('')
    const [newCostType, setNewCostType] = useState<'once' | 'monthly' | 'annual'>('once')
    const [isSaving, setIsSaving] = useState(false)

    const items = ideal.ideal_items ?? []

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

    const handleAddItem = async () => {
        if (!newTitle.trim()) return
        setIsSaving(true)
        try {
            const body: Record<string, unknown> = {
                title: newTitle.trim(),
                item_type: newType,
            }
            if (newType === 'habit' || newType === 'action') {
                body.frequency_type = newFreqType
                body.frequency_value = newFreqValue
                body.session_minutes = newSessionMin
                body.daily_minutes = calcDailyMinutes(newFreqType, newFreqValue, newSessionMin)
            }
            if (newType === 'cost') {
                body.item_cost = newCost ? Number(newCost) : null
                body.cost_type = newCostType
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
            setIsAdding(false)
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

    const getItemIcon = (type: string) => {
        if (type === 'cost') return <Wallet className="h-3.5 w-3.5 text-amber-500" />
        if (type === 'milestone') return <Milestone className="h-3.5 w-3.5 text-violet-500" />
        return <Clock className="h-3.5 w-3.5 text-blue-500" />
    }

    return (
        <div className="flex flex-col h-full">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
                <div>
                    <p className="text-xs text-muted-foreground">アイテム</p>
                    <p className="font-medium text-sm truncate">{ideal.title}</p>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* アイテムリスト */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {items.length === 0 && !isAdding && (
                    <p className="text-xs text-muted-foreground/60 text-center py-6">
                        アイテムがありません。<br />「追加」ボタンから追加してください。
                    </p>
                )}
                {items.map(item => (
                    <div
                        key={item.id}
                        className="group flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50"
                    >
                        <button
                            onClick={() => handleToggleDone(item)}
                            className="mt-0.5 flex-shrink-0"
                        >
                            {item.is_done
                                ? <CheckCircle2 className="h-4 w-4 text-primary" />
                                : <Circle className="h-4 w-4 text-muted-foreground" />
                            }
                        </button>
                        <div className="flex-1 min-w-0">
                            <p className={cn(
                                "text-sm",
                                item.is_done && "line-through text-muted-foreground"
                            )}>
                                {item.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                                {getItemIcon(item.item_type)}
                                <span className="text-[10px] text-muted-foreground">
                                    {ITEM_TYPE_LABELS[item.item_type as IdealItemType] ?? item.item_type}
                                    {' · '}
                                    {formatItemMeta(item)}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDelete(item)}
                            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ))}

                {/* 追加フォーム */}
                {isAdding && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                        <Input
                            autoFocus
                            placeholder="アイテム名"
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setIsAdding(false) }}
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

                        {/* 費用設定（cost） */}
                        {newType === 'cost' && (
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder="金額（円）"
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
                        )}

                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddItem} disabled={isSaving || !newTitle.trim()} className="flex-1">
                                {isSaving ? '追加中...' : '追加'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setIsAdding(false)}>
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
                        onClick={() => setIsAdding(true)}
                    >
                        <Plus className="h-4 w-4 mr-1" /> アイテムを追加
                    </Button>
                </div>
            )}
        </div>
    )
}
