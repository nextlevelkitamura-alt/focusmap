"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { ExternalLink, Loader2, Mic, Sparkles, Square } from "lucide-react"

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
  const [isGeneratingHeading, setIsGeneratingHeading] = useState(false)

  useEffect(() => {
    if (!open) return
    setHeading(node.title)
    setDetail(node.memo)
    setError(null)
    setIsGeneratingHeading(false)
  }, [open, node.title, node.memo])

  const handleTranscribed = useCallback((text: string) => {
    setDetail(prev => prev.trim() ? `${prev.trim()}\n${text}` : text)
  }, [])

  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoiceRecorder(handleTranscribed)

  const toggleVoiceInput = useCallback(() => {
    if (isRecording) {
      stopRecording()
      return
    }
    void startRecording()
  }, [isRecording, startRecording, stopRecording])

  const generateHeading = useCallback(async () => {
    const detailText = detail.trim()
    if (!detailText) return

    setError(null)
    setIsGeneratingHeading(true)
    try {
      const res = await fetch("/api/ai/generate-memo-heading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detail: detailText, currentHeading: heading.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "見出し生成に失敗しました")
      }
      if (typeof data.heading === "string" && data.heading.trim()) {
        setHeading(data.heading.trim())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "見出し生成に失敗しました")
    } finally {
      setIsGeneratingHeading(false)
    }
  }, [detail, heading])

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
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-h-[92dvh] w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-border/70 p-0 xl:!max-w-[1200px]"
      >
        <DialogHeader className="border-b border-border/70 px-6 py-5 text-left">
          <DialogTitle className="text-xl font-semibold leading-tight">
            {node.title}
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            メモ見出しとメモ詳細を整えてからCodexで開始します
          </p>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">メモ見出し</span>
            <input
              value={heading}
              onChange={(event) => setHeading(event.target.value)}
              className="h-12 w-full rounded-lg border border-border/70 bg-background px-3 text-base outline-none focus:border-primary"
              placeholder="メモ見出し"
            />
          </label>

          <div className="mt-8 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">メモ詳細</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={isTranscribing}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                  aria-label={isRecording ? "録音を停止" : "音声入力"}
                  title={isRecording ? "録音を停止" : "音声入力"}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isRecording ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  {isTranscribing ? "文字起こし中" : isRecording ? "録音停止" : "音声入力"}
                </button>
                <button
                  type="button"
                  onClick={generateHeading}
                  disabled={!detail.trim() || isGeneratingHeading}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-100"
                  aria-label="見出し生成"
                  title="見出し生成"
                >
                  {isGeneratingHeading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  見出し生成
                </button>
              </div>
            </div>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              className="min-h-[44dvh] w-full resize-y rounded-lg border border-border/70 bg-background px-4 py-3 text-base leading-relaxed outline-none focus:border-primary"
              placeholder="Codexに渡したい背景、条件、成果物を書いてください"
            />
          </div>

          <button
            type="button"
            onClick={startCodex}
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-base font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            <ExternalLink className="h-5 w-5" />
            Codexで開始
          </button>

          {(error || voiceError) && (
            <p className="mt-3 text-sm text-rose-500">{error || voiceError}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
