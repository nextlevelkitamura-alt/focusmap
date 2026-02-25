"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Sparkles, Send, X, RotateCcw, Loader2,
  Mic, Square, CheckCircle2, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { VoiceWaveform } from "@/components/ui/voice-waveform"

interface ChatOption {
  label: string
  value: string
}

interface UiControlOption {
  label: string
  value: string
}

type PlannerState =
  | 'capture_intent'
  | 'fill_required_slots'
  | 'propose_slots'
  | 'resolve_conflict'
  | 'confirm_and_execute'

interface UiControl {
  type: 'select' | 'text'
  key: 'scheduleWindow' | 'duration' | 'calendarId' | 'freeText'
  label: string
  required?: boolean
  options?: UiControlOption[]
  placeholder?: string
  allowCustom?: boolean
}

interface ProposalCard {
  id: string
  title: string
  startAt: string
  endAt: string
  calendarId: string
  reason: string
  impact?: string
  value?: string
}

interface PlannerDraft {
  scheduleWindow?: 'today' | 'within_3_days' | 'this_week' | 'this_month'
  durationMinutes?: number
  durationText?: string
  calendarId?: string
  freeText?: string
}

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
  options?: ChatOption[]
  optionsUsed?: boolean
  plannerState?: PlannerState
  uiControls?: UiControl[]
  uiControlsUsed?: boolean
  proposalCards?: ProposalCard[]
  proposalUsed?: boolean
}

interface CalendarEventData {
  id: string
  title: string
  scheduled_at: string
  estimated_time: number
  calendar_id?: string | null
}

interface AiChatPanelProps {
  activeNoteId?: string | null
  activeProjectId?: string | null
  hideFab?: boolean
  onCalendarEventCreated?: (eventData?: CalendarEventData) => void
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

const MAX_RALLIES = 7

export function AiChatPanel({ activeNoteId, activeProjectId, hideFab, onCalendarEventCreated, isOpen: controlledIsOpen, onOpenChange }: AiChatPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isControlled = controlledIsOpen !== undefined
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen
  const setIsOpen = useCallback((v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v)
    } else {
      setInternalIsOpen(v)
    }
  }, [isControlled, onOpenChange])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [plannerDraft, setPlannerDraft] = useState<PlannerDraft>({})
  const [freeInputByMessage, setFreeInputByMessage] = useState<Record<string, string>>({})
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

  const buildRequestContext = useCallback(() => ({
    activeNoteId: activeNoteId || undefined,
    activeProjectId: activeProjectId || undefined,
    planner: {
      mode: 'task_planner' as const,
      draftPlan: {
        scheduleWindow: plannerDraft.scheduleWindow,
        durationMinutes: plannerDraft.durationMinutes,
        durationText: plannerDraft.durationText,
        calendarId: plannerDraft.calendarId,
      },
    },
  }), [activeNoteId, activeProjectId, plannerDraft])

  // メッセージ送信（共通ロジック）
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput("")
    setIsLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: buildRequestContext(),
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Chat failed')
      }

      const { reply, action, options, plannerState, uiControls, proposalCards } = await res.json()

      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        action,
        actionStatus: action ? 'pending' : undefined,
        options: options?.length ? options : undefined,
        plannerState,
        uiControls: uiControls?.length ? uiControls : undefined,
        proposalCards: proposalCards?.length ? proposalCards : undefined,
      }
      setMessages(prev => [...prev, aiMessage])
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
  }, [isLoading, messages, buildRequestContext])

  // テキスト入力から送信
  const handleSend = useCallback(() => {
    sendMessage(input)
  }, [input, sendMessage])

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

      const { success, message, eventData } = await res.json()

      setMessages(prev => [
        ...prev.map(m =>
          m.id === messageId ? { ...m, actionStatus: success ? 'success' as const : 'error' as const } : m
        ),
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: message,
        },
      ])

      // カレンダーイベント作成成功時に楽観的更新
      if (success && msg.action?.type === 'add_calendar_event') {
        onCalendarEventCreated?.(eventData)
      }
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

  // 選択肢ボタンクリック
  const handleOptionSelect = useCallback((messageId: string, option: ChatOption) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, optionsUsed: true } : m
    ))

    if (option.value) {
      sendMessage(option.value)
    } else {
      inputRef.current?.focus()
    }
  }, [sendMessage])

  const handlePlannerControlChange = useCallback((key: UiControl['key'], value: string) => {
    setPlannerDraft(prev => {
      if (key === 'scheduleWindow') {
        return { ...prev, scheduleWindow: value as PlannerDraft['scheduleWindow'] }
      }
      if (key === 'calendarId') {
        return { ...prev, calendarId: value }
      }
      if (key === 'duration') {
        if (value === '__custom__') {
          return { ...prev, durationMinutes: undefined, durationText: prev.durationText || '' }
        }
        const parsed = Number(value)
        if (!Number.isNaN(parsed) && parsed > 0) {
          return { ...prev, durationMinutes: parsed, durationText: undefined }
        }
      }
      return { ...prev, freeText: value }
    })
  }, [])

  const handlePlannerCustomDurationChange = useCallback((value: string) => {
    setPlannerDraft(prev => ({
      ...prev,
      durationMinutes: undefined,
      durationText: value,
    }))
  }, [])

  const handleApplyUiControls = useCallback((messageId: string, controls: UiControl[]) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, uiControlsUsed: true } : m
    ))

    const windowLabels: Record<string, string> = {
      today: '今日',
      within_3_days: '3日以内',
      this_week: '今週',
      this_month: '今月',
    }
    const scheduleWindow = plannerDraft.scheduleWindow ? windowLabels[plannerDraft.scheduleWindow] : '未指定'
    const duration = plannerDraft.durationText?.trim()
      || (plannerDraft.durationMinutes ? `${plannerDraft.durationMinutes}分` : '未指定')
    const calendarName = controls
      .find(c => c.key === 'calendarId')
      ?.options?.find(o => o.value === plannerDraft.calendarId)?.label || '未指定'
    const freeText = plannerDraft.freeText?.trim() ? ` 補足: ${plannerDraft.freeText.trim()}` : ''

    sendMessage(`追加時期は${scheduleWindow}、所要時間は${duration}、カレンダーは${calendarName}で進めて。${freeText}`.trim())
  }, [plannerDraft, sendMessage])

  const handleProposalSelect = useCallback((messageId: string, proposal: ProposalCard) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, proposalUsed: true } : m
    ))

    sendMessage(proposal.value || `${proposal.title}を${proposal.startAt}開始で登録して`)
  }, [sendMessage])

  const handlePerTurnFreeInputSend = useCallback((messageId: string) => {
    const text = (freeInputByMessage[messageId] || '').trim()
    if (!text) return
    sendMessage(text)
    setFreeInputByMessage(prev => ({ ...prev, [messageId]: '' }))
  }, [freeInputByMessage, sendMessage])

  // リセット
  const handleReset = useCallback(() => {
    setMessages([])
    setInput("")
    setPlannerDraft({})
    setFreeInputByMessage({})
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
      {!isOpen && !hideFab && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform md:hidden"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}

      {/* チャットパネル */}
      {isOpen && (
        <>
          {/* バックドロップ (モバイル) */}
          <div
            className="fixed inset-0 bg-black/20 z-[80] md:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className={cn(
            "fixed z-[90] bg-background border rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden",
            "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-0 right-0 h-[60dvh]",
            "md:bottom-6 md:right-6 md:left-auto md:w-[400px] md:h-[520px]",
          )}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
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
                <div className="text-center text-muted-foreground text-sm py-6">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>AIに話しかけてみましょう</p>
                  <p className="text-xs mt-1 opacity-70">テキストでも音声でもOK</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {["マップに追加して", "予定に入れて", "メモを整理して"].map(suggestion => (
                      <button
                        key={suggestion}
                        onClick={() => sendMessage(suggestion)}
                        className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
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
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                        <p className="text-xs opacity-80">{msg.action.description}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleExecuteAction(msg.id)}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            実行する
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleCancelAction(msg.id)}
                          >
                            <XCircle className="w-3 h-3" />
                            やめる
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

                    {/* 選択肢ボタン */}
                    {msg.options && !msg.optionsUsed && (
                      <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-1.5">
                        {msg.options.map((opt, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handleOptionSelect(msg.id, opt)}
                            disabled={isLoading}
                          >
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    )}

                    {msg.optionsUsed && msg.options && (
                      <div className="mt-1 text-xs opacity-50">
                        選択済み
                      </div>
                    )}

                    {/* プランナーUIコントロール */}
                    {msg.uiControls && !msg.uiControlsUsed && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-2">
                        {msg.uiControls.map((control, i) => (
                          <div key={`${control.key}-${i}`} className="space-y-1">
                            <p className="text-xs opacity-80">{control.label}{control.required ? ' *' : ''}</p>

                            {control.type === 'select' ? (
                              <>
                                <select
                                  className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
                                  value={
                                    control.key === 'scheduleWindow' ? (plannerDraft.scheduleWindow || '') :
                                      control.key === 'calendarId' ? (plannerDraft.calendarId || '') :
                                        control.key === 'duration' ? (plannerDraft.durationMinutes ? String(plannerDraft.durationMinutes) : plannerDraft.durationText ? '__custom__' : '') :
                                          ''
                                  }
                                  onChange={(e) => handlePlannerControlChange(control.key, e.target.value)}
                                >
                                  <option value="">選択してください</option>
                                  {control.options?.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                  {control.allowCustom && (
                                    <option value="__custom__">自由入力</option>
                                  )}
                                </select>
                                {control.allowCustom && (
                                  <input
                                    type="text"
                                    value={plannerDraft.durationText || ''}
                                    placeholder="例: 45分 / 6時間"
                                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
                                    onChange={(e) => handlePlannerCustomDurationChange(e.target.value)}
                                  />
                                )}
                              </>
                            ) : (
                              <input
                                type="text"
                                value={plannerDraft.freeText || ''}
                                placeholder={control.placeholder || '補足を入力'}
                                className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
                                onChange={(e) => handlePlannerControlChange(control.key, e.target.value)}
                              />
                            )}
                          </div>
                        ))}

                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleApplyUiControls(msg.id, msg.uiControls || [])}
                          disabled={isLoading}
                        >
                          この条件で提案を作る
                        </Button>
                      </div>
                    )}

                    {msg.uiControlsUsed && msg.uiControls && (
                      <p className="mt-1 text-xs opacity-50">入力済み</p>
                    )}

                    {/* 候補時間カード */}
                    {msg.proposalCards && !msg.proposalUsed && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                        {msg.proposalCards.map((proposal) => (
                          <button
                            key={proposal.id}
                            className="w-full rounded-lg border border-border bg-background/60 px-2 py-1.5 text-left hover:bg-background"
                            onClick={() => handleProposalSelect(msg.id, proposal)}
                            disabled={isLoading}
                          >
                            <p className="text-xs font-medium">{proposal.title}</p>
                            <p className="text-[11px] opacity-80">
                              {new Date(proposal.startAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(proposal.endAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="text-[11px] opacity-70">{proposal.reason}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.proposalUsed && msg.proposalCards && (
                      <p className="mt-1 text-xs opacity-50">候補選択済み</p>
                    )}

                    {/* 毎ターン自由入力欄（選択式と併用） */}
                    {msg.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={freeInputByMessage[msg.id] || ''}
                            placeholder="自由に補足して送信"
                            className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs"
                            onChange={(e) => setFreeInputByMessage(prev => ({ ...prev, [msg.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handlePerTurnFreeInputSend(msg.id)
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => handlePerTurnFreeInputSend(msg.id)}
                            disabled={isLoading || !(freeInputByMessage[msg.id] || '').trim()}
                          >
                            送信
                          </Button>
                        </div>
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
            {rallyCount >= 5 && rallyCount < MAX_RALLIES && (
              <div className="px-4 pb-1">
                <p className="text-xs text-amber-600 text-center">
                  残り{MAX_RALLIES - rallyCount}ラリー
                </p>
              </div>
            )}

            {/* 入力エリア */}
            <div className="px-3 py-2.5 border-t shrink-0">
              {rallyCount >= MAX_RALLIES ? (
                <div className="text-center space-y-2 py-1">
                  <p className="text-sm text-muted-foreground">
                    会話が上限に達しました
                  </p>
                  <Button size="sm" onClick={handleReset} className="gap-1">
                    <RotateCcw className="w-3.5 h-3.5" />
                    リセット
                  </Button>
                </div>
              ) : (
                <>
                  {/* 録音中インジケーター */}
                  {isRecording && (
                    <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-red-500/10 rounded-lg">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
                      <VoiceWaveform
                        analyserRef={analyserRef}
                        barCount={32}
                        barWidth={2}
                        barGap={1}
                        height={24}
                      />
                      <button
                        onClick={stopRecording}
                        className="ml-auto text-xs text-red-600 font-medium hover:text-red-700 shrink-0"
                      >
                        停止
                      </button>
                    </div>
                  )}

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
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
