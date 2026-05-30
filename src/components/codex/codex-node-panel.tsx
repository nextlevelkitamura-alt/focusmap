"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExternalLink } from "lucide-react"

const CHATGPT_CODEX_APP_URL = "https://chatgpt.com/app/codex"

type NodeInfo = {
  taskId: string
  title: string
  memo: string
  cwd: string | null
  status: string | null
  scheduledLabel?: string | null
  priority?: number | null
  estimatedLabel?: string | null
  isDone?: boolean
  hasMemo?: boolean
}

type CodexNodePanelProps = {
  open: boolean
  node: NodeInfo
  candidates: string[]
  onClose: () => void
  onPersistDir: (taskId: string, dir: string) => Promise<void> | void
  onOpenMemo?: (taskId: string) => void
  onToggleComplete?: (taskId: string, done: boolean) => void
  onAddChild?: (taskId: string) => void
  onDelete?: (taskId: string) => void
}

function buildCodexPrompt(heading: string, detail: string): string {
  return [heading.trim(), detail.trim()].filter(Boolean).join("\n\n")
}

export function CodexNodePanel({ open, node, onClose }: CodexNodePanelProps) {
  const [heading, setHeading] = useState(node.title)
  const [detail, setDetail] = useState(node.memo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setHeading(node.title)
    setDetail(node.memo)
    setError(null)
  }, [open, node.title, node.memo])

  const startCodex = useCallback(async () => {
    const prompt = buildCodexPrompt(heading, detail)
    if (!prompt) {
      setError("Codexに渡す内容を入力してください")
      return
    }

    setError(null)
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable")
      }
      await navigator.clipboard.writeText(prompt)
    } catch {
      setError("クリップボードへコピーできませんでした。内容をコピーしてからCodexを開いてください。")
      return
    }

    window.location.href = CHATGPT_CODEX_APP_URL
  }, [detail, heading])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-border/70 p-0 xl:!max-w-[1200px]">
        <DialogHeader className="border-b border-border/70 px-6 py-5 text-left">
          <DialogTitle className="text-xl font-semibold leading-tight">
            {node.title}
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            メモ見出しとメモ詳細を整えてからCodexで開始します
          </p>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <label className="space-y-2">
              <span className="text-sm text-muted-foreground">メモ見出し</span>
              <input
                value={heading}
                onChange={(event) => setHeading(event.target.value)}
                className="h-12 w-full rounded-lg border border-border/70 bg-background px-3 text-base outline-none focus:border-primary"
                placeholder="メモ見出し"
              />
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={startCodex}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-base font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                <ExternalLink className="h-5 w-5" />
                Codexで開始
              </button>
            </div>
          </div>

          <label className="mt-8 block space-y-2">
            <span className="text-sm text-muted-foreground">メモ詳細</span>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              className="min-h-[44dvh] w-full resize-y rounded-lg border border-border/70 bg-background px-4 py-3 text-base leading-relaxed outline-none focus:border-primary"
              placeholder="Codexに渡したい背景、条件、成果物を書いてください"
            />
          </label>

          {error && (
            <p className="mt-3 text-sm text-rose-500">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
