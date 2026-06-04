"use client"

import { useState, useEffect } from "react"
import { Loader2, Layers, FolderPlus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Space } from "@/types/database"
import { cn } from "@/lib/utils"
import { DEFAULT_SPACE_COLOR, normalizeColor } from "@/lib/color-utils"

export type SpaceFormMode = "create" | "edit"

interface SpaceFormDialogProps {
  open: boolean
  mode: SpaceFormMode
  /** 編集モード時の対象 (createでは無視) */
  space?: Space | null
  onClose: () => void
  onSaved: (space: Space) => void
}

const SPACE_COLOR_PRESETS = [
  "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#94a3b8", "#22d3ee",
]

/**
 * スペース作成・編集ダイアログ。
 *
 * - create: POST /api/spaces { title, color, ... }
 * - edit:   PATCH /api/spaces/[id] { title, color, ... }
 *
 * スマホ・PC 両対応、 Enter で即保存 (IME 配慮)。
 */
export function SpaceFormDialog({ open, mode, space, onClose, onSaved }: SpaceFormDialogProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState<string>(SPACE_COLOR_PRESETS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && space) {
      setTitle(space.title)
      setDescription(space.description ?? "")
      setColor(normalizeColor(space.color, SPACE_COLOR_PRESETS[0]))
    } else {
      setTitle("")
      setDescription("")
      setColor(SPACE_COLOR_PRESETS[0])
    }
    setError(null)
    setSubmitting(false)
  }, [open, mode, space])

  const canSubmit = title.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const url = mode === "edit" && space ? `/api/spaces/${space.id}` : "/api/spaces"
      const method = mode === "edit" ? "PATCH" : "POST"
      const payload =
        mode === "edit"
          ? { title: title.trim(), description: description.trim() || null, color }
          : { title: title.trim(), description: description.trim() || undefined, color, status: "active" }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || (mode === "edit" ? "更新に失敗" : "作成に失敗"))
      onSaved(data as Space)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー")
    } finally {
      setSubmitting(false)
    }
  }

  const Icon = mode === "edit" ? Layers : FolderPlus

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent
        className="w-[calc(100vw-1rem)] max-w-md"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-primary" />
            {mode === "edit" ? "スペース名を変更" : "新しいスペース"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">スペース名</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  void handleSubmit()
                }
              }}
              placeholder="例: 仕事 / プライベート / 副業"
              maxLength={60}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">説明 (任意)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="このスペースの目的"
              maxLength={120}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">色</label>
            <div className="flex flex-wrap gap-2">
              {SPACE_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`色 ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-all",
                    color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
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
            {mode === "edit" ? "保存" : "作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
