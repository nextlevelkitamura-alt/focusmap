"use client"

import { useState } from "react"
import { IdealGoalWithItems } from "@/types/database"
import { cn } from "@/lib/utils"
import { Calendar, Check, Trash2, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"

const CATEGORY_LABELS: Record<string, string> = {
  学習: '学習',
  調査: '調査',
  目標: '目標',
  アイデア: 'アイデア',
  travel: '旅行',
  learning: '学習',
  health: '健康',
  creativity: '創作',
  career: 'キャリア',
  hobby: '趣味',
  other: 'その他',
}

interface WishlistCardProps {
  item: IdealGoalWithItems
  onUpdate: (id: string, updates: Partial<IdealGoalWithItems>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClick: () => void
}

export function WishlistCard({ item, onUpdate, onDelete, onClick }: WishlistCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const isScheduled = !!item.google_event_id
  const isCompleted = item.is_completed

  const subItems = (item.ideal_items ?? []).slice(0, 3)
  const hiddenCount = (item.ideal_items ?? []).length - 3

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onUpdate(item.id, { is_completed: !item.is_completed } as Partial<IdealGoalWithItems>)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return
    setIsDeleting(true)
    await onDelete(item.id)
  }

  const formattedDate = item.scheduled_at
    ? new Date(item.scheduled_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex flex-col rounded-xl border bg-card cursor-pointer transition-all hover:shadow-md",
        isScheduled && "border-l-4 border-l-blue-500",
        isCompleted && "opacity-50",
      )}
    >
      {/* カバー画像 */}
      {item.cover_image_url && (
        <div className="relative h-32 overflow-hidden rounded-t-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.cover_image_url} alt="" className="w-full h-full object-cover" />
          {isScheduled && (
            <span className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
              <Calendar className="w-3 h-3" /> 予定済み
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 p-3">
        {/* カレンダーバッジ（画像なし時） */}
        {!item.cover_image_url && isScheduled && (
          <span className="self-start bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
            <Calendar className="w-3 h-3" /> 予定済み
          </span>
        )}

        {/* カテゴリタグ */}
        {item.category && (
          <span className="self-start text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
            {CATEGORY_LABELS[item.category] ?? item.category}
          </span>
        )}

        {/* タイトル */}
        <p className={cn("font-semibold text-sm leading-snug", isCompleted && "line-through text-muted-foreground")}>
          {item.title}
        </p>

        {/* メモ */}
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
        )}

        {/* 日時・所要時間 */}
        {(formattedDate || item.duration_minutes) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {formattedDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />{formattedDate}
              </span>
            )}
            {item.duration_minutes && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />{item.duration_minutes}分
              </span>
            )}
          </div>
        )}

        {/* サブアイテム */}
        {subItems.length > 0 && (
          <ul className="space-y-1">
            {subItems.map(sub => (
              <li key={sub.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("w-3 h-3 rounded border border-muted-foreground/40 flex-shrink-0", sub.is_done && "bg-primary border-primary")} />
                <span className={cn(sub.is_done && "line-through")}>{sub.title}</span>
              </li>
            ))}
            {hiddenCount > 0 && (
              <li className="text-xs text-muted-foreground pl-4">+{hiddenCount} 件</li>
            )}
          </ul>
        )}

        {/* アクションボタン */}
        <div className="flex items-center justify-between pt-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={handleCheck}
            className={cn(
              "min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors",
              isCompleted ? "text-green-600" : "text-muted-foreground hover:text-foreground"
            )}
            title={isCompleted ? "完了済み" : "完了にする"}
          >
            {isCompleted ? <Check className="w-5 h-5" /> : (
              <span className="w-5 h-5 rounded border-2 border-current" />
            )}
          </button>

          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            title="削除"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
