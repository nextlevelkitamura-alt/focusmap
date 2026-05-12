"use client"

import { useState } from "react"
import { Calendar, Check, Clock, GripVertical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IdealGoalWithItems } from "@/types/database"
import { cn } from "@/lib/utils"

type MemoItem = IdealGoalWithItems

interface WishlistCardProps {
  item: MemoItem
  onUpdate: (id: string, updates: Partial<MemoItem>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClick: () => void
  draggable?: boolean
  onDragStart?: () => void
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const day = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
  return `${date.getMonth() + 1}/${date.getDate()}(${day}) ${time}`
}

function extractFirstUrl(text: string | null): string | null {
  if (!text) return null
  return text.match(/https?:\/\/[^\s)）]+/)?.[0] ?? null
}

export function WishlistCard({
  item,
  onUpdate,
  onDelete,
  onClick,
  draggable,
  onDragStart,
}: WishlistCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const isScheduled = !!item.google_event_id || !!item.scheduled_at || item.memo_status === "scheduled"
  const isCompleted = item.is_completed || item.memo_status === "completed"
  const tags = item.tags ?? []
  const subCount = item.ideal_items?.length ?? 0
  const formattedDate = formatDateTime(item.scheduled_at)
  const firstUrl = extractFirstUrl(item.description)

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onUpdate(item.id, {
      is_completed: !item.is_completed,
      memo_status: !item.is_completed ? "completed" : "unsorted",
    } as Partial<MemoItem>)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return
    setIsDeleting(true)
    await onDelete(item.id)
  }

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        "group relative flex cursor-pointer flex-col rounded-lg border bg-card p-3 transition-colors hover:border-primary/40",
        isScheduled && "border-l-4 border-l-blue-500",
        isCompleted && "opacity-55",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-1">
            {isScheduled && (
              <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] text-blue-300">
                <Calendar className="h-3 w-3" /> 予定済み
              </span>
            )}
            {(item.category || tags[0]) && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {item.category || tags[0]}
              </span>
            )}
          </div>
          <p className={cn("line-clamp-2 text-sm font-semibold leading-snug", isCompleted && "line-through text-muted-foreground")}>
            {item.title}
          </p>
        </div>
      </div>

      {item.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {item.description}
        </p>
      )}

      {firstUrl && (
        <p className="mt-1 truncate text-xs text-blue-400 underline underline-offset-2">{firstUrl}</p>
      )}

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 4).map(tag => (
            <span key={tag} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {formattedDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> {formattedDate}
          </span>
        )}
        {item.duration_minutes && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {item.duration_minutes}分
          </span>
        )}
        {subCount > 0 && <span>候補 {subCount}</span>}
      </div>

      <div className="mt-2 flex items-center justify-between" onClick={e => e.stopPropagation()}>
        <button
          onClick={handleCheck}
          className={cn(
            "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
            isCompleted && "text-green-500",
          )}
          title={isCompleted ? "完了済み" : "完了にする"}
        >
          {isCompleted ? <Check className="h-5 w-5" /> : <span className="h-5 w-5 rounded border-2 border-current" />}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-[44px] min-w-[44px] text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
