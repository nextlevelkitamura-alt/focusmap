"use client"

import { useState } from "react"
import { IdealGoalWithItems, IdealItem } from "@/types/database"
import { cn } from "@/lib/utils"
import { MoreHorizontal, Pencil, Trash2, CheckCircle2, Circle, Clock, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IdealEditDialog } from "./ideal-edit-dialog"
import { IdealCoverUpload } from "./ideal-cover-upload"

interface IdealCardProps {
    ideal: IdealGoalWithItems
    isSelected: boolean
    onSelect: () => void
    onUpdated: (ideal: IdealGoalWithItems) => void
    onDeleted: (id: string) => void
}

const CATEGORY_LABELS: Record<string, string> = {
    appearance: '見た目',
    lifestyle: 'ライフスタイル',
    career: 'キャリア',
    learning: '学習',
    other: 'その他',
}

export function IdealCard({ ideal, isSelected, onSelect, onUpdated, onDeleted }: IdealCardProps) {
    const [editOpen, setEditOpen] = useState(false)
    const [coverOpen, setCoverOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    const items = ideal.ideal_items ?? []
    const doneCount = items.filter(i => i.is_done).length
    const totalCount = items.length
    const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

    const previewItems = items.slice(0, 3)

    const handleDelete = async () => {
        if (!window.confirm(`「${ideal.title}」を削除しますか？`)) return
        setIsDeleting(true)
        try {
            await fetch(`/api/ideals/${ideal.id}`, { method: 'DELETE' })
            onDeleted(ideal.id)
        } finally {
            setIsDeleting(false)
        }
    }

    const formatFrequency = (item: IdealItem) => {
        if (item.item_type === 'cost') return null
        switch (item.frequency_type) {
            case 'daily':   return `毎日 ${item.session_minutes}分`
            case 'weekly':  return `週${item.frequency_value}回・${item.session_minutes}分`
            case 'monthly': return `月${item.frequency_value}回・${item.session_minutes}分`
            case 'once':    return '単発'
            default:        return null
        }
    }

    return (
        <>
            <div
                className={cn(
                    "group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200",
                    "border-2 bg-card",
                    isSelected
                        ? "border-primary shadow-lg shadow-primary/20 scale-[1.01]"
                        : "border-transparent hover:border-primary/30 hover:shadow-md"
                )}
                onClick={onSelect}
            >
                {/* カバー画像エリア (aspect-[3/4]) */}
                <div className="relative aspect-[3/4] bg-muted overflow-hidden">
                    {ideal.cover_image_url ? (
                        <img
                            src={ideal.cover_image_url}
                            alt={ideal.title}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/50">
                            <span className="text-4xl">✨</span>
                            <span className="text-xs">カバー画像なし</span>
                        </div>
                    )}

                    {/* グラデーションオーバーレイ */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                    {/* 下部テキスト */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                        {ideal.category && (
                            <span className="text-[10px] bg-white/20 rounded-full px-2 py-0.5 mb-1 inline-block">
                                {CATEGORY_LABELS[ideal.category] ?? ideal.category}
                            </span>
                        )}
                        <p className="font-bold text-base leading-tight">{ideal.title}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-white/80">
                            {(ideal.total_daily_minutes ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {ideal.total_daily_minutes}分/日
                                </span>
                            )}
                            {ideal.cost_monthly && (
                                <span className="flex items-center gap-1">
                                    <Wallet className="h-3 w-3" />
                                    ¥{ideal.cost_monthly.toLocaleString()}/月
                                </span>
                            )}
                        </div>
                    </div>

                    {/* メニューボタン */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 bg-black/40 hover:bg-black/60 text-white rounded-full"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setCoverOpen(true)}>
                                    カバー画像を変更
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                                    <Pencil className="h-3.5 w-3.5 mr-2" /> 編集
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={handleDelete}
                                    className="text-destructive"
                                    disabled={isDeleting}
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-2" /> 削除
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {/* 下部: プログレス + アイテムプレビュー */}
                <div className="p-3 space-y-2">
                    {/* プログレスバー */}
                    {totalCount > 0 && (
                        <button
                            type="button"
                            className="group/progress w-full text-left space-y-1 rounded-lg px-1 py-0.5 -mx-1 hover:bg-primary/5 transition-all cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); onSelect() }}
                        >
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{doneCount}/{totalCount} 完了</span>
                                <span className="flex items-center gap-1">
                                    {progressPct}%
                                    <span className="opacity-0 group-hover/progress:opacity-100 transition-opacity text-primary text-[10px]">
                                        ▶ 詳細
                                    </span>
                                </span>
                            </div>
                            <div className="h-1.5 group-hover/progress:h-2 rounded-full bg-muted overflow-hidden transition-all">
                                <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </button>
                    )}

                    {/* アイテムプレビュー */}
                    <div className="space-y-1">
                        {previewItems.map(item => (
                            <div key={item.id} className="flex items-center gap-1.5 text-xs">
                                {item.is_done
                                    ? <CheckCircle2 className="h-3 w-3 text-primary flex-shrink-0" />
                                    : <Circle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                }
                                <span className={cn("truncate flex-1", item.is_done && "line-through text-muted-foreground")}>
                                    {item.title}
                                </span>
                                {item.item_type === 'cost' && item.item_cost && (
                                    <span className="text-muted-foreground text-[10px] flex-shrink-0">
                                        ¥{item.item_cost.toLocaleString()}
                                    </span>
                                )}
                                {item.item_type !== 'cost' && (
                                    <span className="text-muted-foreground text-[10px] flex-shrink-0">
                                        {formatFrequency(item)}
                                    </span>
                                )}
                            </div>
                        ))}
                        {totalCount === 0 && (
                            <button
                                type="button"
                                className="w-full text-center py-2 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); onSelect() }}
                            >
                                <span className="text-xs text-muted-foreground/60 hover:text-primary/60 transition-colors">
                                    タップしてアイテムを追加
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <IdealEditDialog
                open={editOpen}
                ideal={ideal}
                onOpenChange={setEditOpen}
                onSaved={(updated) => {
                    onUpdated(updated)
                    setEditOpen(false)
                }}
            />

            <IdealCoverUpload
                open={coverOpen}
                idealId={ideal.id}
                onOpenChange={setCoverOpen}
                onUploaded={(url) => {
                    onUpdated({ ...ideal, cover_image_url: url })
                    setCoverOpen(false)
                }}
            />
        </>
    )
}
