"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Sparkles, Send, X, RotateCcw, Loader2,
  Mic, Square, CheckCircle2, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: {
    type: string
    params: Record<string, unknown>
    description: string
  }
  actionStatus?: 'pending' | 'executing' | 'success' | 'error'
}

interface AiChatPanelProps {
  activeNoteId?: string | null
  activeProjectId?: string | null
}

const MAX_RALLIES = 7

export function AiChatPanel({ activeNoteId, activeProjectId }: AiChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 音声入力
  const handleTranscribed = useCallback((text: string) => {
    setInput(prev => prev ? `${prev} ${text}` : text)
  }, [])

  const { isRecording, isTranscribing, analyserRef, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  // ラリー数カウント
  const rallyCount = messages.filter(m => m.role === 'user').length

  // 自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // パネル開閉時にフォーカス
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // メッセージ送信
  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: {
            activeNoteId: activeNoteId || undefined,
            activeProjectId: activeProjectId || undefined,
          },
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Chat failed')
      }

      const { reply, action, shouldReset } = await res.json()

      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        action,
        actionStatus: action ? 'pending' : undefined,
      }
      setMessages(prev => [...prev, aiMessage])

      if (shouldReset) {
        // 7ラリー到達通知
      }
    } catch (error) {
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'エラーが発生しました。もう一度お試しください。',
      }
      setMessages(prev => [...prev, errMessage])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, activeNoteId, activeProjectId])

  // アクション実行
  const handleExecuteAction = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg?.action) return

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, actionStatus: 'executing' as const } : m
    ))

    try {
      const res = await fetch('/api/ai/chat/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: msg.action }),
      })

      const { success, message } = await res.json()

      setMessages(prev => [
        ...prev.map(m =>
          m.id === messageId ? { ...m, actionStatus: (success ? 'success' : 'error') as const } : m
        ),
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: message,
        },
      ])
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, actionStatus: 'error' as const } : m
      ))
    }
  }, [messages])

  // アクションキャンセル
  const handleCancelAction = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, action: undefined, actionStatus: undefined } : m
    ))
  }, [])

  // リセット
  const handleReset = useCallback(() => {
    setMessages([])
    setInput("")
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <>
      {/* フローティングアイコン */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform md:bottom-6"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}

      {/* チャットパネル */}
      {isOpen && (
        <>
          {/* バックドロップ (モバイル) */}
          <div
            className="fixed inset-0 bg-black/20 z-50 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className={cn(
            "fixed z-50 bg-background border rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden",
            // モバイル: 画面下半分
            "bottom-0 left-0 right-0 h-[55vh]",
            // PC: 右下固定
            "md:bottom-6 md:right-6 md:left-auto md:w-[400px] md:h-[500px]",
          )}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">AIアシスタント</span>
                <span className="text-xs text-muted-foreground">
                  ({rallyCount}/{MAX_RALLIES})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleReset} title="リセット">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsOpen(false)} title="閉じる">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* メッセージエリア */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-8">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>AIアシスタントに話しかけてみましょう</p>
                  <p className="text-xs mt-1">
                    「マップに追加して」「予定に入れて」など
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    {/* アクション確認ボタン */}
                    {msg.action && msg.actionStatus === 'pending' && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                        <p className="text-xs opacity-80">{msg.action.description}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleExecuteAction(msg.id)}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            実行
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleCancelAction(msg.id)}
                          >
                            <XCircle className="w-3 h-3" />
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 実行中 */}
                    {msg.actionStatus === 'executing' && (
                      <div className="mt-2 flex items-center gap-1 text-xs opacity-80">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        実行中...
                      </div>
                    )}

                    {/* 実行結果 */}
                    {msg.actionStatus === 'success' && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="w-3 h-3" />
                        完了
                      </div>
                    )}
                    {msg.actionStatus === 'error' && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-red-600">
                        <XCircle className="w-3 h-3" />
                        失敗
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* ローディング */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-3 py-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 7ラリー制限警告 */}
            {rallyCount >= 6 && rallyCount < MAX_RALLIES && (
              <div className="px-4 pb-1">
                <p className="text-xs text-amber-600 text-center">
                  残り{MAX_RALLIES - rallyCount}ラリーです
                </p>
              </div>
            )}

            {/* 入力エリア */}
            <div className="px-4 py-3 border-t shrink-0">
              {rallyCount >= MAX_RALLIES ? (
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    会話が上限に達しました
                  </p>
                  <Button size="sm" onClick={handleReset} className="gap-1">
                    <RotateCcw className="w-3.5 h-3.5" />
                    リセットして新しい会話
                  </Button>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  {/* 音声入力ボタン */}
                  <Button
                    variant={isRecording ? "destructive" : "ghost"}
                    size="sm"
                    className="h-9 w-9 p-0 shrink-0"
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isLoading || isTranscribing}
                    title={isRecording ? "録音停止" : "音声入力"}
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isRecording ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </Button>

                  {/* テキスト入力 */}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="メッセージを入力..."
                    className="flex-1 resize-none border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary max-h-24 min-h-[36px]"
                    rows={1}
                    disabled={isLoading}
                  />

                  {/* 送信ボタン */}
                  <Button
                    size="sm"
                    className="h-9 w-9 p-0 shrink-0"
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
