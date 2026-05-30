"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CodexDirPickerProps = {
  open: boolean
  nodeTitle: string
  /** よく使う候補（履歴・repo_path 等） */
  candidates: string[]
  onCancel: () => void
  onConfirm: (dir: string) => void
}

// Codex 作業ディレクトリの選択 UI。
//   1) よく使う/履歴からワンタップ
//   2) 📁 Finder で選ぶ（/api/codex/choose-folder = サーバ側 osascript、localhost時）
//   3) 手入力（絶対パス・フォールバック）
export function CodexDirPicker({ open, nodeTitle, candidates, onCancel, onConfirm }: CodexDirPickerProps) {
  const [value, setValue] = useState("")
  const [picking, setPicking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pickFinder = async () => {
    setPicking(true)
    setErr(null)
    try {
      const res = await fetch("/api/codex/choose-folder")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error && data.error !== "canceled") setErr(data.error)
        return
      }
      if (data?.path) setValue(String(data.path).replace(/\/+$/, ""))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Codex 作業ディレクトリを選択</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          「{nodeTitle}」をこのフォルダで Codex 実行します。
        </p>

        {candidates.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">よく使う / 履歴</div>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto">
              {candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onConfirm(c)}
                  className="truncate rounded-md border border-border/60 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  title={c}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={pickFinder}
          disabled={picking}
          className="w-full rounded-md border border-border/60 px-2 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {picking ? "選択中…" : "📁 Finder で選ぶ"}
        </button>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">または手入力（絶対パス）</div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                e.preventDefault()
                onConfirm(value.trim())
              }
            }}
            placeholder="/Users/you/project"
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm"
          />
        </div>

        {err && <p className="text-xs text-rose-500">{err}</p>}

        <DialogFooter>
          <button type="button" onClick={onCancel} className="rounded-md border border-border/60 px-3 py-1.5 text-sm">
            キャンセル
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            このフォルダで実行
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
