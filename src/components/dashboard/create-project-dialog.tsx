"use client"

import { useState, useEffect } from "react"
import { FolderKanban, FolderPlus, Loader2, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Project, Space } from "@/types/database"
import { cn } from "@/lib/utils"
import { DEFAULT_SPACE_COLOR, normalizeColor } from "@/lib/color-utils"

export type ProjectFormMode = "create" | "edit"

interface ProjectFormDialogProps {
  open: boolean
  mode?: ProjectFormMode
  spaces: Space[]
  defaultSpaceId: string | null
  project?: Project | null
  onClose: () => void
  onSaved: (project: Project) => void
  onDeleted?: (project: Project) => void | Promise<void>
}

const PROJECT_COLOR_PRESETS = [
  "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#94a3b8",
]

/**
 * プロジェクト作成・編集ダイアログ。
 * - スペースを選択 (現在の spaceId が初期値)
 * - タイトル入力
 * - 任意で色選択
 * - create: POST /api/projects
 * - edit:   PATCH /api/projects/[id]
 *
 * スマホ・PC 両対応 (DialogContent が自動で max-w + viewport対応)。
 */
export function ProjectFormDialog({
  open,
  mode = "create",
  spaces,
  defaultSpaceId,
  project,
  onClose,
  onSaved,
  onDeleted,
}: ProjectFormDialogProps) {
  const [title, setTitle] = useState("")
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || spaces[0]?.id || "")
  const [colorTheme, setColorTheme] = useState<string>(PROJECT_COLOR_PRESETS[0])
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && project) {
      setTitle(project.title)
      setSpaceId(project.space_id)
      setColorTheme(normalizeColor(project.color_theme, PROJECT_COLOR_PRESETS[0]))
    } else {
      setTitle("")
      setSpaceId(defaultSpaceId || spaces[0]?.id || "")
      setColorTheme(PROJECT_COLOR_PRESETS[0])
    }
    setError(null)
    setSubmitting(false)
    setDeleting(false)
  }, [open, mode, project, defaultSpaceId, spaces])

  const busy = submitting || deleting
  const canSubmit = title.trim().length > 0 && Boolean(spaceId) && !busy

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const url = mode === "edit" && project ? `/api/projects/${project.id}` : "/api/projects"
      const method = mode === "edit" ? "PATCH" : "POST"
      const payload =
        mode === "edit"
          ? {
              space_id: spaceId,
              title: title.trim(),
              color_theme: colorTheme,
            }
          : {
              space_id: spaceId,
              title: title.trim(),
              status: "active",
              priority: 3,
              color_theme: colorTheme,
            }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || (mode === "edit" ? "更新に失敗しました" : "作成に失敗しました"))
      onSaved(data as Project)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : mode === "edit" ? "更新に失敗しました" : "作成に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (mode !== "edit" || !project || deleting || submitting) return
    const confirmed = window.confirm(
      `プロジェクト「${project.title}」を削除しますか？\nグループとタスクも全て削除されます。`,
    )
    if (!confirmed) return

    setDeleting(true)
    setError(null)
    try {
      if (onDeleted) {
        await onDeleted(project)
      } else {
        const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "削除に失敗しました")
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました")
    } finally {
      setDeleting(false)
    }
  }

  const Icon = mode === "edit" ? FolderKanban : FolderPlus

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-primary" />
            {mode === "edit" ? "プロジェクト名を変更" : "新しいプロジェクト"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">プロジェクト名</label>
            <input
              autoFocus={mode === "edit"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  void handleSubmit()
                }
              }}
              placeholder="例: 新サービス LP / 候補者管理 / 求人立案"
              maxLength={80}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {spaces.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">スペース</label>
              <select
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">色 (任意)</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`色 ${c}`}
                  onClick={() => setColorTheme(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-all",
                    colorTheme === c
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105",
                  )}
                  style={{ backgroundColor: normalizeColor(c, DEFAULT_SPACE_COLOR) }}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {mode === "edit" ? (
          <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:justify-stretch">
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={busy}
              className="justify-center border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              削除
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              キャンセル
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              作成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CreateProjectDialog(props: Omit<ProjectFormDialogProps, "mode" | "onSaved"> & {
  onCreated: (project: Project) => void
}) {
  const { onCreated, ...rest } = props
  return <ProjectFormDialog {...rest} mode="create" onSaved={onCreated} />
}
