"use client"

import { useState } from "react"
import { IdealGoalWithItems, IdealItemWithDetails, IdealItem } from "@/types/database"
import { IdealItemDetail } from "./ideal-item-detail"
import { Clock, Wallet, Calendar, ImageIcon, FileText, Star, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface IdealGalleryViewProps {
    ideals: IdealGoalWithItems[]
    onItemsChanged: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
    appearance: '見た目',
    lifestyle: 'ライフスタイル',
    career: 'キャリア',
    learning: '学習',
    other: 'その他',
}

export function IdealGalleryView({ ideals, onItemsChanged }: IdealGalleryViewProps) {
    const [filter, setFilter] = useState<string | null>(null)
    const [selectedItem, setSelectedItem] = useState<{ item: IdealItemWithDetails; idealId: string } | null>(null)

    const activeIdeals = ideals.filter(i => i.status === 'active')
    const filteredIdeals = filter
        ? activeIdeals.filter(i => i.id === filter)
        : activeIdeals

    // 全アイテムをフラット化
    const allItems = filteredIdeals.flatMap(ideal =>
        (ideal.ideal_items ?? []).map(item => ({
            item: {
                ...item,
                ideal_item_images: (item as IdealItemWithDetails).ideal_item_images ?? [],
                ideal_candidates: (item as IdealItemWithDetails).ideal_candidates ?? [],
            } as IdealItemWithDetails,
            ideal,
        }))
    )

    // サマリー計算
    const totalMonthly = activeIdeals.reduce((sum, i) => sum + (i.cost_monthly ?? 0), 0)
    const totalDailyMin = activeIdeals.reduce((sum, i) => sum + (i.total_daily_minutes ?? 0), 0)
    const totalItems = activeIdeals.reduce((sum, i) => sum + (i.ideal_items?.length ?? 0), 0)
    const doneItems = activeIdeals.reduce((sum, i) => sum + (i.ideal_items?.filter(it => it.is_done).length ?? 0), 0)

    if (selectedItem) {
        return (
            <div className="h-full">
                <IdealItemDetail
                    item={selectedItem.item}
                    idealId={selectedItem.idealId}
                    onBack={() => setSelectedItem(null)}
                    onItemChanged={() => { onItemsChanged(); setSelectedItem(null) }}
                />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            {/* フィルタ */}
            <div className="flex gap-1.5 px-4 py-2 overflow-x-auto border-b flex-shrink-0">
                <button
                    onClick={() => setFilter(null)}
                    className={cn(
                        "px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors",
                        !filter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                    )}
                >
                    全部
                </button>
                {activeIdeals.map(ideal => (
                    <button
                        key={ideal.id}
                        onClick={() => setFilter(ideal.id)}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors",
                            filter === ideal.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                        )}
                    >
                        {ideal.title}
                    </button>
                ))}
            </div>

            {/* ギャラリーグリッド */}
            <div className="flex-1 overflow-y-auto p-4">
                {allItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground/60 text-center py-12">
                        アイテムがありません
                    </p>
                ) : (
                    <div className="columns-2 md:columns-3 gap-3 space-y-3">
                        {allItems.map(({ item, ideal }) => (
                            <GalleryCard
                                key={item.id}
                                item={item}
                                idealTitle={ideal.title}
                                idealColor={ideal.color}
                                onClick={() => setSelectedItem({ item, idealId: ideal.id })}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* フッターサマリー */}
            <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                <span>月¥{totalMonthly.toLocaleString()}</span>
                <span>1日{totalDailyMin}分</span>
                <span>進捗 {totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0}%</span>
            </div>
        </div>
    )
}

function GalleryCard({ item, idealTitle, idealColor, onClick }: {
    item: IdealItemWithDetails
    idealTitle: string
    idealColor: string
    onClick: () => void
}) {
    const hasImage = item.ideal_item_images?.length > 0
    const candidateCount = item.ideal_candidates?.length ?? 0
    const selectedCandidate = item.ideal_candidates?.find(c => c.status === 'selected')

    return (
        <div
            className="break-inside-avoid rounded-xl border bg-card overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
            onClick={onClick}
        >
            {/* 画像 */}
            {hasImage ? (
                <div className="aspect-[4/3] overflow-hidden">
                    <img
                        src={item.ideal_item_images[0].image_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                </div>
            ) : item.thumbnail_url ? (
                <div className="aspect-[4/3] overflow-hidden">
                    <img
                        src={item.thumbnail_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                </div>
            ) : null}

            {/* テキスト情報 */}
            <div className="p-2.5">
                {/* 理想名バッジ */}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary mb-1 inline-block">
                    {idealTitle}
                </span>

                <p className={cn(
                    "text-sm font-medium mt-1",
                    item.is_done && "line-through text-muted-foreground"
                )}>
                    {item.title}
                </p>

                {/* メタ情報 */}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {item.scheduled_date && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Calendar className="w-2.5 h-2.5" />
                            {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                    {item.item_cost && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Wallet className="w-2.5 h-2.5" />
                            ¥{item.item_cost.toLocaleString()}
                            {item.cost_type === 'monthly' && '/月'}
                            {item.cost_type === 'annual' && '/年'}
                        </span>
                    )}
                    {item.session_minutes > 0 && item.item_type !== 'cost' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Clock className="w-2.5 h-2.5" />
                            {item.frequency_type === 'daily' ? `毎日${item.session_minutes}分` : `${item.session_minutes}分`}
                        </span>
                    )}
                </div>

                {/* 候補情報 */}
                {candidateCount > 0 && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                        {selectedCandidate ? (
                            <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                                <Check className="w-2.5 h-2.5" />
                                {selectedCandidate.title}
                                {selectedCandidate.price && ` ¥${selectedCandidate.price.toLocaleString()}`}
                            </span>
                        ) : (
                            <span>候補{candidateCount}件</span>
                        )}
                    </div>
                )}

                {/* メモ・画像インジケーター */}
                <div className="flex items-center gap-1.5 mt-1">
                    {item.description && (
                        <FileText className="w-3 h-3 text-muted-foreground/40" />
                    )}
                    {hasImage && item.ideal_item_images.length > 1 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/40">
                            <ImageIcon className="w-3 h-3" />
                            {item.ideal_item_images.length}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
