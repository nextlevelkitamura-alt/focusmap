"use client"

import { useState, useCallback } from "react"
import { Loader2, Send, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ProjectContextChatDialogProps {
  open: boolean
  projectId: string
  projectTitle: string
  initialDescription: string
  onClose: () => void
  onUpdated: (description: string) => void
}

/**
 * プロジェクトの説明（projects.description）をチャットで育てるダイアログ。
 * 発言を送るとAIが現在の説明文に統合する。説明文は直接手編集も可能。
 */
export function ProjectContextChatDialog({
  open,
  projectId,
  projectTitle,
  initialDescription,
  onClose,
  onUpdated,
}: ProjectContextChatDialogProps) {
  const [description, setDescription] = useState(initialDescription)
  const [saved, setSaved] = useState(initialDescription)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const dirty = description !== saved

  const handleSend = useCallback(async () => {
    const message = input.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/context-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "更新に失敗しました")
      setDescription(data.description)
      setSaved(data.description)
      setLog(prev => [...prev, message])
      setInput("")
      onUpdated(data.description)
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました")
    } finally {
      setSending(false)
    }
  }, [input, sending, projectId, onUpdated])

  const handleSaveEdit = useCallback(async () => {
    setSavingEdit(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "保存に失敗しました")
      }
      setSaved(description)
      onUpdated(description)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setSavingEdit(false)
    }
  }, [description, projectId, onUpdated])

  return (
    <Dialog open={open} onOpenChange={v => !v && !sending && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 text-primary" />
            {projectTitle} の説明
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3 py-1">
          {/* 説明文（手編集可） */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                プロジェクトの説明
              </span>
              {dirty && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                >
                  {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : "編集を保存"}
                </Button>
              )}
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="このプロジェクトが何か、まだ説明がありません。下のチャットで伝えると、AIがここにまとめます。"
              className="w-full min-h-[140px] max-h-[280px] resize-y rounded-md border border-input bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* 取り込みログ */}
          {log.length > 0 && (
            <div className="space-y-1">
              {log.map((m, i) => (
                <div key={i} className="text-xs text-muted-foreground flex gap-1.5">
                  <span className="text-primary shrink-0">取り込み済</span>
                  <span className="truncate">{m}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* チャット入力 */}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="プロジェクトについて伝える（例: 個人開発のメモ整理アプリ。対象は非エンジニア）"
              className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-md border border-input bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={sending}
            />
            <Button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="h-11 w-11 p-0 shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
