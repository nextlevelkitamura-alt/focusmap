"use client"

import { useState } from "react"
import { Calendar, Check, Clock, GripVertical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IdealGoalWithItems, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { colorToRgba, DEFAULT_PROJECT_COLOR, getTagColor, normalizeColor } from "@/lib/color-utils"
import { MEMO_DRAG_MIME, TODAY_DURATION_DEFAULT, TODAY_DURATION_PRESETS } from "@/lib/calendar-constants"

// グローバル: dragover ハンドラは dataTransfer の中身を読めないため、
// 直近のドラッグ中メモを window 経由で参照する（type-safe な declare 拡張）
declare global {
  interface Window {
    __focusmapMemoDrag?: {
      memoId: string
      durationMinutes: number
      title: string
    } | null
  }
}

type MemoItem = IdealGoalWithItems

interface WishlistCardProps {
  item: MemoItem
  onUpdate: (id: string, updates: Partial<MemoItem>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClick: () => void
  project?: Project | null
  tagColors?: Record<string, string>
  draggable?: boolean
  onDragStart?: () => void
  // Today タブで native HTML5 D&D を有効化（カレンダー上に配置するため）
  nativeMemoDrag?: boolean
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
  project,
  tagColors = {},
  draggable,
  onDragStart,
  nativeMemoDrag = false,
}: WishlistCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const isScheduled = !!item.google_event_id || !!item.scheduled_at || item.memo_status === "scheduled"
  const isCompleted = item.is_completed || item.memo_status === "completed"
  const isToday = !!item.is_today
  const tags = item.tags ?? []
  const subCount = item.ideal_items?.length ?? 0
  const formattedDate = formatDateTime(item.scheduled_at)
  const firstUrl = extractFirstUrl(item.description)
  const projectColor = project ? normalizeColor(project.color_theme, DEFAULT_PROJECT_COLOR) : null
  const accentColor = projectColor ?? (isScheduled ? "#3b82f6" : undefined)
  const displayTags = Array.from(new Set(
    [item.category, ...tags]
      .map(tag => tag?.trim())
      .filter((tag): tag is string => !!tag),
  ))
  const hasTopBadges = !!project || isScheduled

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !isCompleted
    await onUpdate(item.id, {
      is_completed: next,
      memo_status: next ? "completed" : "unsorted",
      // 完了化したら「今日する」も外す
      ...(next ? { is_today: false } : {}),
    } as Partial<MemoItem>)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleting(true)
    await onDelete(item.id)
  }

  const handleSetDuration = async (e: React.MouseEvent, minutes: number) => {
    e.stopPropagation()
    await onUpdate(item.id, { duration_minutes: minutes } as Partial<MemoItem>)
  }

  // scheduled_at が今日のものも「今日カラム」相当として扱う（duration チップ表示判定）
  const scheduledMs = item.scheduled_at ? new Date(item.scheduled_at).getTime() : null
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const isScheduledToday = scheduledMs != null && !Number.isNaN(scheduledMs)
    && scheduledMs >= todayStart.getTime() && scheduledMs < todayEnd.getTime()
  const isTodayColumn = isToday || isScheduledToday
  const effectiveDuration = item.duration_minutes ?? TODAY_DURATION_DEFAULT
  const canNativeMemoDrag = nativeMemoDrag && !isCompleted

  // Native HTML5 D&D（Today タブで使用）
  const handleNativeDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canNativeMemoDrag) return
    const payload = {
      memoId: item.id,
      durationMinutes: effectiveDuration,
      title: item.title,
    }
    const serialized = JSON.stringify(payload)
    try {
      e.dataTransfer.setData(MEMO_DRAG_MIME, serialized)
    } catch {
      // 一部ブラウザでカスタム MIME が拒否される場合のフォールバック
    }
    // text/plain にも prefix 付きで載せておく（カスタム MIME が読めない環境向け）
    e.dataTransfer.setData("text/plain", `__focusmap_memo__${serialized}`)
    e.dataTransfer.effectAllowed = "move"
    window.__focusmapMemoDrag = payload

    // コンパクトなドラッグゴースト（タイトル + 所要時間の pill）
    // 既存パターン: center-pane-task-item.tsx
    const ghost = document.createElement("div")
    ghost.style.cssText = "position:fixed;top:-9999px;left:0;pointer-events:none;"
    ghost.className = "px-3 py-1.5 rounded-md shadow-lg text-xs font-medium text-white bg-amber-500 flex items-center gap-1.5 whitespace-nowrap"
    const safeTitle = (item.title ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c))
    ghost.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>${safeTitle}</span>
      <span style="opacity:0.85">・${effectiveDuration}分</span>
    `
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 12, 16)
    // dragstart 完了後すぐ DOM から除去（ブラウザがゴースト画像を内部キャプチャ済み）
    setTimeout(() => ghost.remove(), 0)
  }
  const handleNativeDragEnd = () => {
    if (!canNativeMemoDrag) return
    window.__focusmapMemoDrag = null
  }

  return (
    <div
      draggable={canNativeMemoDrag || draggable}
      onDragStart={canNativeMemoDrag ? handleNativeDragStart : onDragStart}
      onDragEnd={canNativeMemoDrag ? handleNativeDragEnd : undefined}
      onClick={onClick}
      className={cn(
        "group relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card p-3 transition-colors hover:border-primary/40",
        canNativeMemoDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        accentColor && "border-l-4",
        isCompleted && "opacity-55",
      )}
      style={accentColor ? {
        borderColor: colorToRgba(accentColor, 0.58),
        borderLeftColor: accentColor,
        boxShadow: `inset 0 0 0 9999px ${colorToRgba(accentColor, 0.035)}`,
      } : undefined}
    >
      <button
        type="button"
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onClick={handleCheck}
        className={cn(
          "absolute right-2 top-2 z-10 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
          isCompleted && "text-foreground",
        )}
        style={accentColor ? { color: accentColor } : undefined}
        title={isCompleted ? "完了済み" : "完了にする"}
        aria-label={isCompleted ? "完了済み" : "完了にする"}
        aria-pressed={isCompleted}
      >
        {isCompleted ? <Check className="h-5 w-5" /> : <span className="h-5 w-5 rounded border-2 border-current" />}
      </button>

      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
        )}
        <div className="min-w-0 flex-1 pr-11">
          {hasTopBadges && (
            <div className="mb-2 flex flex-wrap gap-1">
              {project && (
                <span
                  className="rounded px-1.5 py-0.5 text-[11px]"
                  style={{
                    backgroundColor: colorToRgba(projectColor ?? DEFAULT_PROJECT_COLOR, 0.14),
                    color: projectColor ?? DEFAULT_PROJECT_COLOR,
                  }}
                >
                  {project.title}
                </span>
              )}
              {isScheduled && (
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                  style={{
                    backgroundColor: colorToRgba(accentColor ?? "#3b82f6", 0.14),
                    color: accentColor ?? "#60a5fa",
                  }}
                >
                  <Calendar className="h-3 w-3" /> 予定済み
                </span>
              )}
            </div>
          )}
          <p className={cn("line-clamp-2 break-words text-sm font-semibold leading-snug", isCompleted && "line-through text-muted-foreground")}>
            {item.title}
          </p>
          {displayTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {displayTags.slice(0, 4).map(tag => {
                const tagColor = getTagColor(tag, tagColors)
                return (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-[11px]"
                    style={{
                      backgroundColor: colorToRgba(tagColor, 0.14),
                      color: tagColor,
                    }}
                  >
                    {tag}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {item.description && (
        <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
          {item.description}
        </p>
      )}

      {firstUrl && (
        <p className="mt-1 truncate text-xs text-blue-400 underline underline-offset-2">{firstUrl}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {formattedDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> {formattedDate}
          </span>
        )}
        {item.duration_minutes && !isTodayColumn && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {item.duration_minutes}分
          </span>
        )}
        {subCount > 0 && <span>候補 {subCount}</span>}
      </div>

      {isTodayColumn && !isCompleted && (
        <div className="mt-2 flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {TODAY_DURATION_PRESETS.map(min => {
            const selected = (item.duration_minutes ?? TODAY_DURATION_DEFAULT) === min
            const isDefault = item.duration_minutes == null && min === TODAY_DURATION_DEFAULT
            return (
              <button
                key={min}
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => handleSetDuration(e, min)}
                className={cn(
                  "min-h-7 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  selected
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : isDefault
                      ? "border-primary/30 bg-primary/5 text-primary/80"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={selected}
                title={`所要時間 ${min}分`}
              >
                {min}分
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-2 flex justify-end" onClick={e => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-[44px] min-w-[44px] text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          disabled={isDeleting}
          title="削除"
          aria-label="削除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
