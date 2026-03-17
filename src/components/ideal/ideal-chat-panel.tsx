"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { MessageCircle, Send, X, Loader2 } from "lucide-react"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  options?: ChatOption[]
  optionsUsed?: boolean
}

interface ChatOption {
  label: string
  value: string
  silent?: boolean
}

interface IdealChatPanelProps {
  onClose: () => void
}

export function IdealChatPanel({ onClose }: IdealChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const sendMessage = async (text: string, silent = false) => {
    if (!text.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    }

    const newMessages = silent ? messages : [...messages, userMsg]
    if (!silent) setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    try {
      const history = newMessages
        .filter(m => !silent || m.id !== userMsg.id)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history,
          skillId: "ideal-coach",
        }),
      })

      if (!res.ok) throw new Error("API error")

      const data = await res.json()

      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply || "応答を取得できませんでした",
        options: data.options,
      }

      setMessages(prev => [...prev, ...(silent ? [] : []), aiMsg])

      // context_update がある場合は自動保存
      if (data.contextUpdate) {
        fetch("/api/ai/chat/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.contextUpdate),
        }).catch(() => {})
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "エラーが発生しました。もう一度お試しください。",
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
    }
  }

  const handleOptionSelect = (messageId: string, option: ChatOption) => {
    // 選択済みにする
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId ? { ...m, optionsUsed: true } : m
      )
    )
    if (option.silent) {
      sendMessage(option.value, true)
    } else {
      sendMessage(option.value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">理想コーチ</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <p>理想像について壁打ちしましょう。</p>
            <p className="mt-1 text-xs">「この目標は現実的？」「時間配分を見直したい」など</p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {[
                { label: "理想を深掘りしたい", value: "自分の理想像について深掘りしたい" },
                { label: "時間配分を相談", value: "理想の実現に向けた時間配分を相談したい" },
                { label: "現実とのギャップ", value: "理想と現実のギャップを整理したい" },
              ].map(opt => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => sendMessage(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {/* 選択肢ボタン */}
              {msg.options && !msg.optionsUsed && (
                <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-1.5">
                  {msg.options.map((opt, i) => (
                    <Button
                      key={i}
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 bg-background/50"
                      onClick={() => handleOptionSelect(msg.id, opt)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-3.5 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="border-t p-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="理想について聞いてみる..."
            className="flex-1 resize-none rounded-xl border bg-muted/50 px-3 py-2 text-sm min-h-[40px] max-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/20"
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 rounded-xl shrink-0"
            disabled={!input.trim() || isLoading}
            onClick={() => sendMessage(input)}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
