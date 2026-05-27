"use client"

import { useState, useEffect } from "react"
import { Loader2, FolderPlus } from "lucide-react"
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

interface CreateProjectDialogProps {
  open: boolean
  spaces: Space[]
  defaultSpaceId: string | null
  onClose: () => void
  onCreated: (project: Project) => void
}

const PROJECT_COLOR_PRESETS = [
  "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#94a3b8",
]

/**
 * プロジェクト新規作成ダイアログ。
 * - スペースを選択 (現在の spaceId が初期値)
 * - タイトル入力
 * - 任意で色選択
 * - POST /api/projects → onCreated(project)
 *
 * スマホ・PC 両対応 (DialogContent が自動で max-w + viewport対応)。
 */
export function CreateProjectDialog({
  open,
  spaces,
  defaultSpaceId,
  onClose,
  onCreated,
}: CreateProjectDialogProps) {
  const [title, setTitle] = useState("")
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || spaces[0]?.id || "")
  const [colorTheme, setColorTheme] = useState<string>(PROJECT_COLOR_PRESETS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle("")
    setSpaceId(defaultSpaceId || spaces[0]?.id || "")
    setColorTheme(PROJECT_COLOR_PRESETS[0])
    setError(null)
    setSubmitting(false)
  }, [open, defaultSpaceId, spaces])

  const canSubmit = title.trim().length > 0 && Boolean(spaceId) && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          title: title.trim(),
          status: "active",
          priority: 3,
          color_theme: colorTheme,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "作成に失敗しました")
      onCreated(data as Project)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderPlus className="h-4 w-4 text-primary" />
            新しいプロジェクト
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">プロジェクト名</label>
            <input
              autoFocus
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

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            作成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
