"use client"

import { useState, useRef } from "react"
import { IdealItemWithDetails, IdealItemImage, IdealCandidate, FrequencyType } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IdealImageLightbox } from "./ideal-image-lightbox"
import {
    ArrowLeft, Calendar, Wallet, Link2, Upload, X,
    FileText, Star, Check, XIcon, MoreHorizontal, Trash2, ImageIcon
} from "lucide-react"
import { cn } from "@/lib/utils"

interface IdealItemDetailProps {
    item: IdealItemWithDetails
    idealId: string
    onBack: () => void
    onItemChanged: () => void
}

const FREQUENCY_LABELS: Record<string, string> = {
    daily: '毎日',
    weekly: '週',
    monthly: '月',
    once: '単発',
}

function formatCost(cost: number | null, costType: string | null): string {
    if (!cost) return ''
    const formatted = cost.toLocaleString()
    switch (costType) {
        case 'monthly': return `¥${formatted}/月`
        case 'annual': return `¥${formatted}/年`
        default: return `¥${formatted}`
    }
}

function formatFrequency(item: IdealItemWithDetails): string {
    const type = item.frequency_type as FrequencyType
    if (type === 'daily') return `毎日 ${item.session_minutes}分`
    if (type === 'weekly') return `週${item.frequency_value}回・${item.session_minutes}分`
    if (type === 'monthly') return `月${item.frequency_value}回・${item.session_minutes}分`
    return '単発'
}

export function IdealItemDetail({ item, idealId, onBack, onItemChanged }: IdealItemDetailProps) {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
    const [isEditingMemo, setIsEditingMemo] = useState(false)
    const [memo, setMemo] = useState(item.description || '')
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const images = item.ideal_item_images ?? []
    const candidates = item.ideal_candidates ?? []

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch(`/api/ideals/${idealId}/items/${item.id}/images`, {
                method: 'POST',
                body: formData,
            })
            if (res.ok) onItemChanged()
        } finally {
            setIsUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const handleDeleteImage = async (img: IdealItemImage) => {
        const res = await fetch(`/api/ideals/${idealId}/items/${item.id}/images/${img.id}`, {
            method: 'DELETE',
        })
        if (res.ok) onItemChanged()
    }

    const handleSaveMemo = async () => {
        await fetch(`/api/ideals/${idealId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: memo || null }),
        })
        setIsEditingMemo(false)
        onItemChanged()
    }

    const handleSaveDate = async (date: string) => {
        await fetch(`/api/ideals/${idealId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduled_date: date || null }),
        })
        onItemChanged()
    }

    const handleSaveCost = async (cost: number | null, costType: string) => {
        await fetch(`/api/ideals/${idealId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_cost: cost, cost_type: costType }),
        })
        onItemChanged()
    }

    const handleSaveUrl = async (url: string) => {
        await fetch(`/api/ideals/${idealId}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference_url: url || null }),
        })
        onItemChanged()
    }

    return (
        <div className="flex flex-col h-full">
            {/* ヘッダー */}
            <div className="flex items-center gap-2 p-3 border-b">
                <button onClick={onBack} className="p-1 rounded hover:bg-muted">
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <h3 className="font-semibold text-sm flex-1 truncate">{item.title}</h3>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* メイン画像エリア */}
                {images.length > 0 ? (
                    <div className="relative">
                        <div
                            className="aspect-[4/3] cursor-pointer overflow-hidden"
                            onClick={() => setLightboxIndex(0)}
                        >
                            <img
                                src={images[0].image_url}
                                alt={images[0].caption || item.title}
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>
                ) : (
                    <div
                        className="aspect-[4/3] bg-muted/30 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <ImageIcon className="w-8 h-8 text-muted-foreground/40 mb-2" />
                        <span className="text-xs text-muted-foreground/60">画像を追加</span>
                    </div>
                )}

                {/* 横スクロール画像ギャラリー */}
                {(images.length > 0) && (
                    <div className="flex gap-1.5 px-3 py-2 overflow-x-auto">
                        {images.map((img, idx) => (
                            <div key={img.id} className="relative flex-shrink-0 group/thumb">
                                <div
                                    className="w-16 h-16 rounded-md overflow-hidden cursor-pointer border border-border hover:border-primary active:border-primary transition-colors"
                                    onClick={() => setLightboxIndex(idx)}
                                >
                                    <img src={img.image_url} alt={img.caption || ''} className="w-full h-full object-cover" />
                                </div>
                                <button
                                    onClick={() => handleDeleteImage(img)}
                                    className="absolute -top-1.5 -right-1.5 w-7 h-7 md:w-5 md:h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center shadow-sm"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-16 h-16 rounded-md border-2 border-dashed border-muted-foreground/20 flex items-center justify-center hover:border-muted-foreground/40 active:border-primary transition-colors flex-shrink-0"
                            disabled={isUploading}
                        >
                            <Upload className="w-4 h-4 text-muted-foreground/40" />
                        </button>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                />

                {/* メタ情報 */}
                <div className="px-3 py-3 space-y-2.5">
                    {/* 頻度・時間 */}
                    {item.item_type !== 'cost' && item.item_type !== 'milestone' && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                                {formatFrequency(item)}
                            </span>
                        </div>
                    )}

                    {/* 予定日 */}
                    <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        <input
                            type="date"
                            value={item.scheduled_date || ''}
                            onChange={e => handleSaveDate(e.target.value)}
                            className="bg-transparent border-none text-sm p-0 focus:outline-none"
                            placeholder="予定日を設定"
                        />
                        {!item.scheduled_date && (
                            <span className="text-xs text-muted-foreground/50">予定日を設定</span>
                        )}
                    </div>

                    {/* コスト（編集可能） */}
                    <EditableCost
                        cost={item.item_cost}
                        costType={item.cost_type}
                        onSave={handleSaveCost}
                    />

                    {/* 参考URL */}
                    <EditableUrl
                        url={item.reference_url}
                        onSave={handleSaveUrl}
                    />
                </div>

                {/* メモセクション */}
                <div className="px-3 py-3 border-t">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            メモ
                        </span>
                        {!isEditingMemo && (
                            <button
                                onClick={() => setIsEditingMemo(true)}
                                className="text-xs text-primary hover:underline"
                            >
                                {item.description ? '編集' : '追加'}
                            </button>
                        )}
                    </div>

                    {isEditingMemo ? (
                        <div className="space-y-2">
                            <textarea
                                value={memo}
                                onChange={e => setMemo(e.target.value)}
                                className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="メモを入力..."
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <Button size="sm" onClick={handleSaveMemo}>保存</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setIsEditingMemo(false); setMemo(item.description || '') }}>
                                    キャンセル
                                </Button>
                            </div>
                        </div>
                    ) : item.description ? (
                        <p className="text-sm whitespace-pre-wrap text-foreground/80">{item.description}</p>
                    ) : (
                        <p className="text-xs text-muted-foreground/50">メモなし</p>
                    )}
                </div>

                {/* 検討候補セクション */}
                <div className="px-3 py-3 border-t">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground">
                            検討候補 {candidates.length > 0 && `(${candidates.length}件)`}
                        </span>
                        <AddCandidateButton idealId={idealId} itemId={item.id} onAdded={onItemChanged} />
                    </div>
                    {candidates.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {candidates.map(c => (
                                <CandidateCard
                                    key={c.id}
                                    candidate={c}
                                    idealId={idealId}
                                    itemId={item.id}
                                    onChanged={onItemChanged}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground/50 text-center py-2">候補なし</p>
                    )}
                </div>
            </div>

            {/* ライトボックス */}
            {lightboxIndex !== null && (
                <IdealImageLightbox
                    images={images}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxIndex(null)}
                />
            )}
        </div>
    )
}

function EditableUrl({ url, onSave }: { url: string | null; onSave: (url: string) => void }) {
    const [isEditing, setIsEditing] = useState(false)
    const [value, setValue] = useState(url || '')

    if (isEditing) {
        return (
            <div className="flex items-center gap-1">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <Input
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    placeholder="https://..."
                    className="h-7 text-xs"
                    autoFocus
                    onBlur={() => { onSave(value); setIsEditing(false) }}
                    onKeyDown={e => { if (e.key === 'Enter') { onSave(value); setIsEditing(false) } }}
                />
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 text-sm">
            <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
            {url ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-xs truncate max-w-[60vw]"
                >
                    {url.replace(/^https?:\/\//, '').split('/')[0]}
                </a>
            ) : (
                <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground"
                >
                    URLを追加
                </button>
            )}
            {url && (
                <button onClick={() => setIsEditing(true)} className="text-xs text-muted-foreground hover:text-foreground">
                    編集
                </button>
            )}
        </div>
    )
}

function EditableCost({ cost, costType, onSave }: {
    cost: number | null
    costType: string | null
    onSave: (cost: number | null, costType: string) => void
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [costValue, setCostValue] = useState(cost?.toString() || '')
    const [typeValue, setTypeValue] = useState(costType || 'once')

    if (isEditing) {
        return (
            <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <Input
                        type="number"
                        value={costValue}
                        onChange={e => setCostValue(e.target.value)}
                        placeholder="金額（円）"
                        className="h-8 text-sm flex-1"
                        autoFocus
                        inputMode="numeric"
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                onSave(costValue ? Number(costValue) : null, typeValue)
                                setIsEditing(false)
                            }
                            if (e.key === 'Escape') setIsEditing(false)
                        }}
                    />
                    <select
                        value={typeValue}
                        onChange={e => setTypeValue(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                        <option value="once">一括</option>
                        <option value="monthly">月払い</option>
                        <option value="annual">年払い</option>
                    </select>
                </div>
                <div className="flex gap-2 pl-5">
                    <Button
                        size="sm"
                        className="h-8 text-xs px-4"
                        onClick={() => {
                            onSave(costValue ? Number(costValue) : null, typeValue)
                            setIsEditing(false)
                        }}
                    >
                        保存
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs px-3"
                        onClick={() => setIsEditing(false)}
                    >
                        取消
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 text-sm">
            <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
            {cost ? (
                <>
                    <span className="font-medium">{formatCost(cost, costType)}</span>
                    <button onClick={() => setIsEditing(true)} className="text-xs text-muted-foreground hover:text-foreground">
                        編集
                    </button>
                </>
            ) : (
                <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground"
                >
                    コストを設定
                </button>
            )}
        </div>
    )
}

function CandidateCard({ candidate, idealId, itemId, onChanged }: {
    candidate: IdealCandidate
    idealId: string
    itemId: string
    onChanged: () => void
}) {
    const statusColors = {
        considering: 'border-border',
        selected: 'border-green-500 bg-green-50 dark:bg-green-950/20',
        rejected: 'border-muted opacity-50',
    }

    const handleStatusChange = async (status: string) => {
        await fetch(`/api/ideals/${idealId}/items/${itemId}/candidates/${candidate.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        })
        onChanged()
    }

    const handleDelete = async () => {
        await fetch(`/api/ideals/${idealId}/items/${itemId}/candidates/${candidate.id}`, {
            method: 'DELETE',
        })
        onChanged()
    }

    return (
        <div className={cn(
            "rounded-lg border p-2 text-xs group/cand relative",
            statusColors[candidate.status as keyof typeof statusColors] || statusColors.considering
        )}>
            {/* 削除ボタン */}
            <button
                onClick={handleDelete}
                className="absolute top-1 right-1 p-1.5 md:p-0.5 rounded-full bg-background/80 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover/cand:opacity-100 transition-opacity"
            >
                <Trash2 className="w-3 h-3" />
            </button>

            {candidate.image_url && (
                <div className="aspect-square rounded-md overflow-hidden mb-1.5">
                    <img src={candidate.image_url} alt={candidate.title} className="w-full h-full object-cover" />
                </div>
            )}
            <p className="font-medium truncate">{candidate.title}</p>
            {candidate.url && (
                <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block">
                    {candidate.url.replace(/^https?:\/\//, '').split('/')[0]}
                </a>
            )}
            {candidate.price != null && candidate.price > 0 && (
                <p className="text-muted-foreground">¥{candidate.price.toLocaleString()}</p>
            )}
            {candidate.rating && (
                <div className="flex gap-0.5 mt-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                            key={i}
                            className={cn(
                                "w-3 h-3",
                                i < candidate.rating! ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"
                            )}
                        />
                    ))}
                </div>
            )}
            {/* ステータスボタン */}
            <div className="flex gap-1.5 mt-2">
                {candidate.status !== 'selected' && (
                    <button
                        onClick={() => handleStatusChange('selected')}
                        className="px-2.5 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 active:bg-green-200 dark:active:bg-green-900/50 transition-colors text-xs"
                    >
                        <Check className="w-3 h-3 inline mr-0.5" /> 選定
                    </button>
                )}
                {candidate.status !== 'rejected' && (
                    <button
                        onClick={() => handleStatusChange('rejected')}
                        className="px-2.5 py-1 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 active:bg-red-200 dark:active:bg-red-900/50 transition-colors text-xs"
                    >
                        <XIcon className="w-3 h-3 inline mr-0.5" /> 却下
                    </button>
                )}
                {candidate.status !== 'considering' && (
                    <button
                        onClick={() => handleStatusChange('considering')}
                        className="px-2.5 py-1 rounded-md bg-muted text-muted-foreground active:bg-muted/80 transition-colors text-xs"
                    >
                        検討中
                    </button>
                )}
            </div>
        </div>
    )
}

function AddCandidateButton({ idealId, itemId, onAdded }: {
    idealId: string
    itemId: string
    onAdded: () => void
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [url, setUrl] = useState('')
    const [price, setPrice] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    const handleAdd = async () => {
        if (!title.trim()) return
        setIsSaving(true)
        try {
            await fetch(`/api/ideals/${idealId}/items/${itemId}/candidates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    url: url || null,
                    price: price ? Number(price) : null,
                }),
            })
            setTitle('')
            setUrl('')
            setPrice('')
            setIsOpen(false)
            onAdded()
        } finally {
            setIsSaving(false)
        }
    }

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="text-xs text-primary hover:underline"
            >
                + 追加
            </button>
        )
    }

    return (
        <div className="w-full mt-2 rounded-lg border p-2 space-y-1.5 bg-muted/30">
            <Input
                autoFocus
                placeholder="候補名"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-7 text-xs"
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setIsOpen(false) }}
            />
            <Input
                placeholder="URL (任意)"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="h-7 text-xs"
            />
            <Input
                type="number"
                placeholder="価格 (任意)"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="h-7 text-xs"
            />
            <div className="flex gap-1">
                <Button size="sm" onClick={handleAdd} disabled={isSaving || !title.trim()} className="h-6 text-xs px-2">
                    追加
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)} className="h-6 text-xs px-2">
                    取消
                </Button>
            </div>
        </div>
    )
}
