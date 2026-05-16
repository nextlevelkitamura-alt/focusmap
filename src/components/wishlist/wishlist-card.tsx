"use client"

import { useState } from "react"
import { Calendar, Check, Clock, GripVertical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IdealGoalWithItems, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { colorToRgba, DEFAULT_PROJECT_COLOR, getTagColor, normalizeColor } from "@/lib/color-utils"
import type { AiTask } from "@/types/ai-task"
import { NoteClaudeRunnerButton, NoteClaudeRunnerPanel } from "@/components/memo/note-claude-runner"

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
  aiTask?: AiTask | null
  onLaunchClaude?: () => Promise<void>
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
  aiTask = null,
  onLaunchClaude,
}: WishlistCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const isScheduled = !!item.google_event_id || !!item.scheduled_at || item.memo_status === "scheduled"
  const isCompleted = item.is_completed || item.memo_status === "completed"
  const tags = item.tags ?? []
  const subCount = item.ideal_items?.length ?? 0
  const formattedDate = formatDateTime(item.scheduled_at)
  const firstUrl = extractFirstUrl(item.description)
  const projectColor = project ? normalizeColor(project.color_theme, DEFAULT_PROJECT_COLOR) : null
  const accentColor = projectColor ?? (isScheduled ? "#3b82f6" : undefined)
  const primaryTag = item.category || tags[0] || null

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onUpdate(item.id, {
      is_completed: !isCompleted,
      memo_status: !isCompleted ? "completed" : "unsorted",
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
        accentColor && "border-l-4",
        isCompleted && "opacity-55",
      )}
      style={accentColor ? {
        borderColor: colorToRgba(accentColor, 0.58),
        borderLeftColor: accentColor,
        boxShadow: `inset 0 0 0 9999px ${colorToRgba(accentColor, 0.035)}`,
      } : undefined}
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-1">
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
            {primaryTag && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px]"
                style={{
                  backgroundColor: colorToRgba(getTagColor(primaryTag, tagColors), 0.14),
                  color: getTagColor(primaryTag, tagColors),
                }}
              >
                {primaryTag}
              </span>
            )}
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
            <span
              key={tag}
              className="rounded border px-1.5 py-0.5 text-[11px]"
              style={{
                borderColor: colorToRgba(getTagColor(tag, tagColors), 0.55),
                backgroundColor: colorToRgba(getTagColor(tag, tagColors), 0.08),
                color: getTagColor(tag, tagColors),
              }}
            >
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
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onClick={handleCheck}
          className={cn(
            "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
            isCompleted && "text-foreground",
          )}
          style={accentColor ? { color: accentColor } : undefined}
          title={isCompleted ? "完了済み" : "完了にする"}
        >
          {isCompleted ? <Check className="h-5 w-5" /> : <span className="h-5 w-5 rounded border-2 border-current" />}
        </button>
        <div className="flex items-center gap-1">
          {onLaunchClaude && (
            <div className="flex items-center" onClick={e => e.stopPropagation()}>
              <NoteClaudeRunnerButton
                noteId={item.id}
                noteContent={item.description ?? item.title}
                projectId={item.project_id}
                repoPath={project?.repo_path ?? null}
                latestTask={aiTask}
                onStart={onLaunchClaude}
              />
            </div>
          )}
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

      {onLaunchClaude && aiTask && (
        <div onClick={e => e.stopPropagation()}>
          <NoteClaudeRunnerPanel
            latestTask={aiTask}
            isProjectAssigned={!!item.project_id}
            isRepoConfigured={!!project?.repo_path}
          />
        </div>
      )}
    </div>
  )
}
