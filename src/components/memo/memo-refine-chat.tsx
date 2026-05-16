"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Send, Sparkles, Check, Edit3, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MemoSource {
  title: string
  description?: string
  repo_path?: string
}

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** GLMが提案した選択肢（UIで表示） */
  options?: string[]
  /** 最終提案の場合のメモ案 */
  finalProposal?: { title: string; description: string }
}

interface MemoRefineChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: MemoSource
  model: string
  /** 「このメモに反映」が押されたとき呼ばれる。新しいtitle/descriptionを保存する責務 */
  onApply: (title: string, description: string) => Promise<void>
}

export function MemoRefineChat({ open, onOpenChange, source, model, onApply }: MemoRefineChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isWaiting, setIsWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingFinal, setEditingFinal] = useState(false)
  const [editedTitle, setEditedTitle] = useState("")
  const [editedDesc, setEditedDesc] = useState("")
  const [isApplying, setIsApplying] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  // シートを開いたときに最初のGLM質問を取得
  useEffect(() => {
    if (open && messages.length === 0) {
      void fetchNext([])
    }
    if (!open) {
      // 閉じたらリセット
      setMessages([])
      setInput("")
      setError(null)
      setEditingFinal(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 新メッセージが追加されたら下までスクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const fetchNext = async (history: ChatMessage[]) => {
    setIsWaiting(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/memo-refine-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          source,
          model,
          turn: history.filter(m => m.role === "user").length,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.type === "final") {
        const finalMsg: ChatMessage = {
          role: "assistant",
          content: `整理しました。以下の内容でメモを更新します:\n\n【タイトル】${data.title}\n\n【詳細】\n${data.description}`,
          finalProposal: { title: data.title, description: data.description },
        }
        setMessages([...history, finalMsg])
        setEditedTitle(data.title)
        setEditedDesc(data.description)
      } else {
        const qMsg: ChatMessage = {
          role: "assistant",
          content: data.message ?? "（質問の生成に失敗しました）",
          options: data.options,
        }
        setMessages([...history, qMsg])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー")
    } finally {
      setIsWaiting(false)
    }
  }

  const sendUserMessage = async (text: string) => {
    if (!text.trim() || isWaiting) return
    const userMsg: ChatMessage = { role: "user", content: text.trim() }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput("")
    await fetchNext(newHistory)
  }

  const handleApply = async () => {
    setIsApplying(true)
    try {
      await onApply(editedTitle.trim(), editedDesc.trim())
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました")
    } finally {
      setIsApplying(false)
    }
  }

  const lastMessage = messages[messages.length - 1]
  const hasFinalProposal = !!lastMessage?.finalProposal

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-3xl">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" />
              対話で詰める
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-base text-primary px-2 py-1 -mr-2 min-h-[44px]"
            >
              閉じる
            </button>
          </div>
        </SheetHeader>

        {/* 元メモ（折りたたみ） */}
        <details className="border-b shrink-0 bg-muted/30">
          <summary className="px-4 py-2.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            元メモを見る
          </summary>
          <div className="px-4 pb-3 space-y-1.5">
            <div className="text-sm font-medium">{source.title}</div>
            {source.description && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{source.description}</div>
            )}
            {source.repo_path && (
              <div className="text-[10px] text-muted-foreground font-mono">{source.repo_path}</div>
            )}
          </div>
        </details>

        {/* チャット履歴 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
          {messages.length === 0 && !isWaiting && (
            <div className="text-center text-sm text-muted-foreground py-12">
              GLM があなたのメモを読んで、質問を考えます...
            </div>
          )}
          {messages.map((msg, i) => (
            <Message
              key={i}
              msg={msg}
              isLast={i === messages.length - 1}
              onClickOption={(opt) => sendUserMessage(opt)}
            />
          ))}
          {isWaiting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              GLM が考えています...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 最終提案: 編集 + 保存 UI */}
        {hasFinalProposal && (
          <div className="border-t bg-background shrink-0">
            {editingFinal ? (
              <div className="px-4 py-3 space-y-2">
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="タイトル"
                  className="w-full min-h-[44px] rounded-xl border bg-background px-3 text-base outline-none focus:ring-1 focus:ring-primary"
                />
                <textarea
                  value={editedDesc}
                  onChange={(e) => setEditedDesc(e.target.value)}
                  placeholder="詳細"
                  rows={5}
                  className="w-full min-h-[120px] rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-y"
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setEditingFinal(false)}>
                    <X className="h-4 w-4 mr-1" />キャンセル
                  </Button>
                  <Button type="button" className="flex-1 min-h-[44px]" onClick={handleApply} disabled={isApplying || !editedTitle.trim()}>
                    {isApplying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    このメモに反映
                  </Button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 flex gap-2">
                <Button type="button" variant="outline" className="flex-1 min-h-[48px]" onClick={() => setEditingFinal(true)}>
                  <Edit3 className="h-4 w-4 mr-1" />編集
                </Button>
                <Button type="button" className="flex-1 min-h-[48px]" onClick={handleApply} disabled={isApplying}>
                  {isApplying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  このメモに反映
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 入力欄（最終提案中は隠す） */}
        {!hasFinalProposal && (
          <div className="border-t px-3 py-2 shrink-0 bg-background">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendUserMessage(input) } }}
                placeholder="自由記述で答える..."
                disabled={isWaiting}
                className="flex-1 min-h-[44px] rounded-xl bg-muted/60 px-3 text-base outline-none focus:bg-muted disabled:opacity-50"
              />
              <Button
                type="button"
                onClick={() => sendUserMessage(input)}
                disabled={!input.trim() || isWaiting}
                className="min-h-[44px] min-w-[56px]"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Message({
  msg,
  isLast,
  onClickOption,
}: {
  msg: ChatMessage
  isLast: boolean
  onClickOption: (opt: string) => void
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    )
  }
  // assistant
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1.5">
        <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">G</div>
        <div className={cn(
          "max-w-[85%] rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap",
          msg.finalProposal && "bg-amber-500/10 border border-amber-500/30",
        )}>
          {msg.content}
        </div>
      </div>
      {/* 選択肢チップ */}
      {isLast && msg.options && msg.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-7">
          {msg.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onClickOption(opt)}
              className="min-h-[36px] rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted active:bg-muted/80"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
