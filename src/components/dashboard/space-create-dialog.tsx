"use client"

import { useState, useCallback } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { COLOR_PRESETS, DEFAULT_SPACE_COLOR } from "@/lib/color-utils"

interface SpaceCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (title: string, color: string) => Promise<unknown>
}

/** 新しいスペースを作る軽量モーダル（名前 + 色）。 */
export function SpaceCreateDialog({ open, onClose, onCreate }: SpaceCreateDialogProps) {
  const [title, setTitle] = useState("")
  const [color, setColor] = useState(DEFAULT_SPACE_COLOR)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setTitle("")
    setColor(DEFAULT_SPACE_COLOR)
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    if (creating) return
    reset()
    onClose()
  }, [creating, reset, onClose])

  const handleCreate = useCallback(async () => {
    if (!title.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      await onCreate(title.trim(), color)
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました")
    } finally {
      setCreating(false)
    }
  }, [title, color, creating, onCreate, reset, onClose])

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新しいスペース</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">名前</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleCreate()
                }
              }}
              placeholder="仕事 / プライベート など"
              className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">色</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setColor(preset.value)}
                  className={cn(
                    "w-7 h-7 rounded-full border-2 transition-transform",
                    color === preset.value ? "border-foreground scale-110" : "border-transparent",
                  )}
                  style={{ backgroundColor: preset.value }}
                  aria-label={`色 ${preset.label}`}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={creating}>
            キャンセル
          </Button>
          <Button onClick={handleCreate} disabled={creating || !title.trim()}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
