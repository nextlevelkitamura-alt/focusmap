"use client"

import { useState, useCallback } from "react"
import { StickyNote, Send, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Note } from "@/types/note"

interface MemoViewProps {
  className?: string
}

export function MemoView({ className }: MemoViewProps) {
  const [content, setContent] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const handleSave = useCallback(async () => {
    if (!content.trim()) return

    setIsLoading(true)
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      })

      if (!res.ok) {
        throw new Error("Failed to save note")
      }

      const { note } = await res.json()
      setNotes((prev) => [note, ...prev])
      setContent("")
      setToast({ type: "success", message: "メモを保存しました" })
      setTimeout(() => setToast(null), 2000)
    } catch (error) {
      console.error("Save error:", error)
      setToast({ type: "error", message: "保存に失敗しました" })
      setTimeout(() => setToast(null), 3000)
    } finally {
      setIsLoading(false)
    }
  }, [content])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <StickyNote className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">メモ</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "mx-4 mt-2 px-3 py-2 rounded-md text-sm",
            toast.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4">
        <Card className="p-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="アイディアを入力... (Cmd+Enterで保存)"
            className="min-h-[100px] w-full resize-none border-0 bg-transparent focus:outline-none text-base"
            disabled={isLoading}
          />

          {/* Expand/Collapse Options */}
          <div className="mt-2 pt-2 border-t">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  閉じる
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  オプション
                </>
              )}
            </button>

            {isExpanded && (
              <div className="mt-3 space-y-3">
                {/* Phase 2で追加: プロジェクト選択、AI分析ボタンなど */}
                <p className="text-xs text-muted-foreground">
                  AIによる分析・分類機能は Phase 2 で追加予定
                </p>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="mt-3 flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!content.trim() || isLoading}
              size="sm"
              className="gap-1"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              保存
            </Button>
          </div>
        </Card>
      </div>

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {notes.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <StickyNote className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">まだメモがありません</p>
            <p className="text-xs mt-1">アイディアを入力してみましょう</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              <Card key={note.id} className="p-3 hover:bg-muted/50 transition-colors">
                <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(note.created_at).toLocaleString("ja-JP")}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
