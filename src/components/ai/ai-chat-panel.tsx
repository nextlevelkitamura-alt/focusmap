"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Sparkles, Send, X, RotateCcw, Loader2,
  Mic, Square, CheckCircle2, XCircle,
  CalendarPlus, ListTodo, StickyNote, MessageCircleHeart, BrainCircuit, Lightbulb,
} from "lucide-react"
import { SKILLS } from "@/lib/ai/skills"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { VoiceWaveform } from "@/components/ui/voice-waveform"

interface ChatOption {
  label: string
  value: string
  silent?: boolean  // trueなら返信バブルを出さずにAPIに直接送信
}

interface ChatAction {
  type: string
  params: Record<string, unknown>
  description: string
}

interface CalendarChoice {
  id: string
  name: string
  isDefault: boolean
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

interface BestProposal {
  title: string
  startAt: string
  endAt: string
  calendarId: string
  duration: number
  reason: string
}

type PlannerState =
  | 'capture_intent'
  | 'propose'
  | 'resolve_conflict'
  | 'confirm_and_execute'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: ChatAction
  pendingAction?: ChatAction
  calendarChoices?: CalendarChoice[]
  calendarChoiceUsed?: boolean
  actionStatus?: 'pending' | 'executing' | 'success' | 'error'
  options?: ChatOption[]
  optionsUsed?: boolean
  selectedOption?: string  // 選択されたオプションのラベル
  plannerState?: PlannerState
  bestProposal?: BestProposal
  bestProposalStatus?: 'pending' | 'accepted' | 'editing'
  proposalCards?: ProposalCard[]
  proposalUsed?: boolean
  toolResults?: ToolResult[]
  isSummaryDivider?: boolean
}

interface CalendarEventData {
  id: string
  title: string
  scheduled_at: string
  estimated_time: number
  calendar_id?: string | null
}

interface TaskData {
  id: string
  title: string
  project_id?: string | null
  parent_task_id?: string | null
}

interface ToolResult {
  toolName: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}

interface AiChatPanelProps {
  mode?: 'floating' | 'fullscreen'
  activeNoteId?: string | null
  activeProjectId?: string | null
  hideFab?: boolean
  onCalendarEventCreated?: (eventData?: CalendarEventData) => void
  onTaskCreated?: (taskData?: TaskData) => void
  onMindmapUpdated?: () => void
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

// スキルアイコンのマッピング
const SKILL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CalendarPlus,
  ListTodo,
  StickyNote,
  MessageCircleHeart,
  BrainCircuit,
  Lightbulb,
}

const MAX_RALLIES = 15

function formatDateTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const month = start.getMonth() + 1
  const day = start.getDate()
  const dow = days[start.getDay()]
  const startTime = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const endTime = end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  return `${month}/${day}(${dow}) ${startTime}〜${endTime}`
}

export function AiChatPanel({ mode = 'floating', activeNoteId, activeProjectId, hideFab, onCalendarEventCreated, onTaskCreated, onMindmapUpdated, isOpen: controlledIsOpen, onOpenChange }: AiChatPanelProps) {
  const isFullscreen = mode === 'fullscreen'
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
  const [executionNotice, setExecutionNotice] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null)
  const [projectSummaryNotice, setProjectSummaryNotice] = useState(false)
  const [summaryBoundaryIndex, setSummaryBoundaryIndex] = useState<number>(0)
  const [currentSummaryText, setCurrentSummaryText] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 音声入力
  const handleTranscribed = useCallback((text: string) => {
    setInput(prev => prev ? `${prev} ${text}` : text)
  }, [])

  const { isRecording, isTranscribing, analyserRef, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  // ラリー数カウント（要約境界以降のメッセージのみ）
  const rallyCount = messages.slice(summaryBoundaryIndex).filter(m => m.role === 'user').length

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
  }), [activeNoteId, activeProjectId])

  // ツール自動実行結果を処理（エージェントループ完了後）
  const handleToolResults = useCallback((results: ToolResult[]) => {
    let mindmapChanged = false
    for (const result of results) {
      const out = result.output as { success?: boolean; taskId?: string; title?: string; scheduledAt?: string; message?: string }
      if (!out?.success) continue

      switch (result.toolName) {
        case 'addTask':
          onTaskCreated?.({
            id: out.taskId || '',
            title: out.title || '',
            project_id: (result.input.projectId as string) || null,
            parent_task_id: (result.input.parentTaskId as string) || null,
          })
          mindmapChanged = true
          break
        case 'addMindmapGroup':
        case 'addMindmapTask':
        case 'deleteMindmapNode':
          mindmapChanged = true
          break
        case 'addCalendarEvent':
          onCalendarEventCreated?.({
            id: out.taskId || '',
            title: out.title || '',
            scheduled_at: out.scheduledAt || '',
            estimated_time: (result.input.estimatedTime as number) || 60,
            calendar_id: (result.input.calendarId as string) || null,
          })
          break
      }
    }
    if (mindmapChanged) {
      onMindmapUpdated?.()
    }
  }, [onCalendarEventCreated, onTaskCreated, onMindmapUpdated])

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
          history: updatedMessages.slice(summaryBoundaryIndex).filter(m => !m.isSummaryDivider).map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: buildRequestContext(),
          skillId: activeSkillId || undefined,
          summaryContext: currentSummaryText || undefined,
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Chat failed')
      }

      const {
        reply,
        action,
        pendingAction,
        calendarChoices,
        options,
        plannerState,
        bestProposal,
        proposalCards,
        shouldSummarize,
        skillId: responseSkillId,
        skillSelector,
        contextUpdate,
        projectContextUpdated,
        toolResults,
      } = await res.json()

      // サーバーからSkillIdが返ってきたら保持
      if (responseSkillId && !activeSkillId) {
        setActiveSkillId(responseSkillId)
      }

      // skillSelector が返ってきた場合 → Skill選択UIを表示
      if (skillSelector) {
        const aiMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply || '何をしましょうか？',
          options: skillSelector.map((s: { id: string; label: string }) => ({
            label: s.label,
            value: `${s.label}をしたい`,
          })),
        }
        setMessages(prev => [...prev, aiMessage])
        return
      }

      // サーバーから要約指示が来た場合、自動要約を実行
      if (shouldSummarize) {
        const aiMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
        }
        setMessages(prev => [...prev, aiMessage])
        // 自動要約をトリガー
        await summarizeAndContinue([...updatedMessages, aiMessage])
        return
      }

      // context_update がある場合、バックグラウンドで保存
      if (contextUpdate?.category && contextUpdate?.content) {
        fetch('/api/ai/chat/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contextUpdate),
        }).catch(() => {})  // fire-and-forget
      }

      // プロジェクト要約が更新された場合、一時的にインジケーターを表示
      if (projectContextUpdated) {
        setProjectSummaryNotice(true)
        setTimeout(() => setProjectSummaryNotice(false), 3000)
      }

      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        action,
        pendingAction,
        calendarChoices: calendarChoices?.length ? calendarChoices : undefined,
        actionStatus: action || pendingAction ? 'pending' : undefined,
        options: options?.length ? options : undefined,
        plannerState,
        bestProposal,
        bestProposalStatus: bestProposal ? 'pending' : undefined,
        proposalCards: proposalCards?.length ? proposalCards : undefined,
        toolResults: toolResults?.length ? toolResults : undefined,
      }
      setMessages(prev => [...prev, aiMessage])

      // ツール自動実行結果を処理（マインドマップ・カレンダー等の更新通知）
      if (toolResults?.length) {
        handleToolResults(toolResults)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'エラーが発生しました'
      const isApiKeyError = errorMsg.includes('APIキーエラー') || errorMsg.includes('API設定')
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: isApiKeyError
          ? 'AI設定にエラーがあります。管理者にお問い合わせください。'
          : errorMsg,
        options: isApiKeyError ? undefined : [
          { label: 'リトライ', value: trimmed },
        ],
      }
      setMessages(prev => [...prev, errMessage])
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, messages, buildRequestContext, activeSkillId, summaryBoundaryIndex, currentSummaryText, handleToolResults])

  // サイレント送信（ユーザーバブルを表示せずにAPIに送信）
  const sendMessageSilent = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    // UIにユーザーバブルを表示しないが、AIの文脈として履歴に含める
    const silentUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }

    setIsLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: [...messages, silentUserMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: buildRequestContext(),
          skillId: activeSkillId || undefined,
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Chat failed')
      }

      const {
        reply,
        action,
        pendingAction,
        calendarChoices,
        options,
        plannerState,
        bestProposal,
        proposalCards,
        shouldSummarize,
        skillId: responseSkillId,
        contextUpdate,
        toolResults,
      } = await res.json()

      if (responseSkillId && !activeSkillId) {
        setActiveSkillId(responseSkillId)
      }

      if (contextUpdate?.category && contextUpdate?.content) {
        fetch('/api/ai/chat/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contextUpdate),
        }).catch(() => {})
      }

      // silentUserMessage を内部的にmessagesに追加（UIには非表示だが文脈として保持）
      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        action,
        pendingAction,
        calendarChoices: calendarChoices?.length ? calendarChoices : undefined,
        actionStatus: action || pendingAction ? 'pending' : undefined,
        options: options?.length ? options : undefined,
        plannerState,
        bestProposal,
        bestProposalStatus: bestProposal ? 'pending' : undefined,
        proposalCards: proposalCards?.length ? proposalCards : undefined,
        toolResults: toolResults?.length ? toolResults : undefined,
      }

      setMessages(prev => [...prev, aiMessage])

      if (toolResults?.length) {
        handleToolResults(toolResults)
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
  }, [isLoading, messages, buildRequestContext, activeSkillId, handleToolResults])

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

      const { success, message, eventData, taskData, continueOptions, actionType } = await res.json()

      setMessages(prev => [
        ...prev.map(m =>
          m.id === messageId ? { ...m, actionStatus: success ? 'success' as const : 'error' as const } : m
        ),
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: message,
          options: continueOptions?.length ? continueOptions : undefined,
        },
      ])

      // カレンダーイベント作成成功時に楽観的更新
      if (success && msg.action?.type === 'add_calendar_event') {
        onCalendarEventCreated?.(eventData)
        const registeredAt = eventData?.scheduled_at
          ? new Date(eventData.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : null
        setExecutionNotice(registeredAt ? `予定を登録しました（${registeredAt}）` : '予定を登録しました')
        setTimeout(() => setExecutionNotice(null), 4500)
      }

      // タスク作成成功時にマインドマップ更新
      if (success && msg.action?.type === 'add_task') {
        onTaskCreated?.(taskData)
        onMindmapUpdated?.()
        setExecutionNotice(`タスクをマップに追加しました`)
        setTimeout(() => setExecutionNotice(null), 4500)
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, actionStatus: 'error' as const } : m
      ))
    }
  }, [messages, onCalendarEventCreated, onTaskCreated, onMindmapUpdated])

  // アクションキャンセル
  const handleCancelAction = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, action: undefined, pendingAction: undefined, calendarChoices: undefined, actionStatus: undefined } : m
    ))
  }, [])

  const handleCalendarChoiceSelect = useCallback(async (messageId: string, choice: CalendarChoice) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg?.pendingAction) return

    const action: ChatAction = {
      ...msg.pendingAction,
      params: {
        ...(msg.pendingAction.params || {}),
        calendar_id: choice.id,
      },
    }

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, actionStatus: 'executing' as const, calendarChoiceUsed: true }
        : m
    ))

    try {
      const res = await fetch('/api/ai/chat/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const { success, message, eventData } = await res.json()

      setMessages(prev => [
        ...prev.map(m =>
          m.id === messageId
            ? { ...m, actionStatus: success ? 'success' as const : 'error' as const }
            : m
        ),
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: message,
        },
      ])

      if (success && action.type === 'add_calendar_event') {
        onCalendarEventCreated?.(eventData)
        const registeredAt = eventData?.scheduled_at
          ? new Date(eventData.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : null
        setExecutionNotice(registeredAt ? `予定を登録しました（${registeredAt}）` : '予定を登録しました')
        setTimeout(() => setExecutionNotice(null), 4500)
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, actionStatus: 'error' as const } : m
      ))
    }
  }, [messages, onCalendarEventCreated])

  // 選択肢ボタンクリック
  const handleOptionSelect = useCallback((messageId: string, option: ChatOption) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, optionsUsed: true, selectedOption: option.label } : m
    ))

    if (!option.value) {
      // 空のvalue（「完了」ボタン等）は何もしない
      inputRef.current?.focus()
      return
    }

    if (option.silent) {
      // サイレント: ユーザーバブルなしでAPIに直接送信
      sendMessageSilent(option.value)
    } else {
      sendMessage(option.value)
    }
  }, [sendMessage, sendMessageSilent])

  // ベスト提案を承認
  const handleAcceptProposal = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg?.bestProposal) return

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, bestProposalStatus: 'accepted' as const } : m
    ))

    const p = msg.bestProposal
    sendMessage(`${p.title}を${formatDateTimeRange(p.startAt, p.endAt)}で登録して`)
  }, [messages, sendMessage])

  // ベスト提案の編集モードに切り替え
  const handleEditProposal = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, bestProposalStatus: 'editing' as const } : m
    ))
  }, [])

  // 他の候補を要求
  const handleRequestAlternatives = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, bestProposalStatus: 'accepted' as const } : m
    ))
    sendMessage('他の候補を見せて')
  }, [sendMessage])

  // 候補カード選択
  const handleProposalSelect = useCallback((messageId: string, proposal: ProposalCard) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, proposalUsed: true } : m
    ))

    sendMessage(proposal.value || `${proposal.title}を${proposal.startAt}開始で登録して`)
  }, [sendMessage])

  // 会話を要約して継続
  const summarizeAndContinue = useCallback(async (messagesToSummarize: ChatMessage[]) => {
    setIsSummarizing(true)
    try {
      const res = await fetch('/api/ai/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSummarize }),
      })
      if (res.ok) {
        const { summary } = await res.json()
        const dividerMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: summary,
          isSummaryDivider: true,
        }
        setMessages(prev => [...prev, dividerMessage])
        setSummaryBoundaryIndex(messagesToSummarize.length + 1)
        setCurrentSummaryText(summary)
      }
      // 要約失敗時もメッセージを維持（クリアしない）
    } catch {
      // エラー時もメッセージを維持
    } finally {
      setIsSummarizing(false)
    }
  }, [])

  // リセット
  const handleReset = useCallback(async () => {
    // メッセージが2件以上ある場合は要約を保存
    if (messages.length >= 2) {
      try {
        await fetch('/api/ai/chat/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        })
      } catch {
        // 要約失敗しても会話リセットは続行
      }
    }
    setMessages([])
    setSummaryBoundaryIndex(0)
    setCurrentSummaryText(null)
    setInput("")
    setExecutionNotice(null)
    setActiveSkillId(null)
  }, [messages])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return

    const nativeEvent = e.nativeEvent as KeyboardEvent
    const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229
    if (isComposing) return
    if (e.shiftKey) return

    e.preventDefault()
    handleSend()
  }, [handleSend])

  // fullscreen モードでは常に表示
  const shouldRender = isFullscreen || isOpen

  return (
    <>
      {/* フローティングアイコン (floating モードのみ) */}
      {!isFullscreen && !isOpen && !hideFab && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform md:hidden"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}

      {/* チャットパネル */}
      {shouldRender && (
        <>
          {/* バックドロップ (floating モード + モバイルのみ) */}
          {!isFullscreen && (
            <div
              className="fixed inset-0 bg-black/20 z-[80] md:hidden"
              onClick={() => setIsOpen(false)}
            />
          )}

          <div className={cn(
            isFullscreen
              ? "flex flex-col h-full w-full bg-background overflow-hidden"
              : cn(
                "fixed z-[90] bg-background border rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden",
                "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-0 right-0 h-[60dvh]",
                "md:bottom-6 md:right-6 md:left-auto md:w-[400px] md:h-[520px]",
              )
          )}>
            {/* ヘッダー */}
            <div className={cn(
              "flex items-center justify-between border-b shrink-0",
              isFullscreen ? "px-5 py-3" : "px-4 py-2.5"
            )}>
              <div className="flex items-center gap-2">
                <Sparkles className={cn("text-primary", isFullscreen ? "w-5 h-5" : "w-4 h-4")} />
                <span className={cn("font-semibold", isFullscreen ? "text-base" : "text-sm")}>AIアシスタント</span>
                {activeSkillId && (
                  <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                    {SKILLS.find(s => s.id === activeSkillId)?.label || activeSkillId}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  ({rallyCount}/{MAX_RALLIES})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleReset} title="リセット">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
                {!isFullscreen && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsOpen(false)} title="閉じる">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {executionNotice && (
              <div className="mx-3 mt-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                {executionNotice}
              </div>
            )}

            {projectSummaryNotice && (
              <div className="mx-3 mt-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
                会話を要約しています
              </div>
            )}

            {/* メッセージエリア */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className={cn(
                  "text-center text-muted-foreground text-sm",
                  isFullscreen ? "py-12 flex flex-col items-center justify-center flex-1" : "py-4"
                )}>
                  <Sparkles className={cn("mx-auto mb-3 opacity-30", isFullscreen ? "w-12 h-12" : "w-8 h-8")} />
                  <p className={cn("font-medium mb-4", isFullscreen ? "text-lg" : "")}>何をしましょうか？</p>
                  <div className={cn(
                    "grid gap-2",
                    isFullscreen ? "grid-cols-3 max-w-md px-4" : "grid-cols-2 px-2"
                  )}>
                    {SKILLS.map(skill => {
                      const Icon = SKILL_ICON_MAP[skill.icon] || Sparkles
                      return (
                        <button
                          key={skill.id}
                          onClick={() => {
                            setActiveSkillId(skill.id)
                            sendMessage(`${skill.label}をしたい`)
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border border-border hover:bg-muted hover:border-primary/30 transition-colors",
                            isFullscreen ? "p-4 gap-2" : "p-3"
                          )}
                        >
                          <Icon className={cn("text-primary", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                          <span className={cn(isFullscreen ? "text-sm font-medium" : "text-xs")}>{skill.label}</span>
                          {isFullscreen && (
                            <span className="text-[11px] text-muted-foreground leading-tight">{skill.description}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs mt-3 opacity-60">または自由に入力してもOK</p>
                </div>
              )}

              {messages.map((msg) => (
                msg.isSummaryDivider ? (
                  <div key={msg.id} className="py-2 my-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap px-1">
                        会話を要約しました
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-1.5 px-2 leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                ) : <div
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

                    {/* ツール自動実行結果（エージェントループ） */}
                    {msg.toolResults && msg.toolResults.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                        {msg.toolResults.map((tr, i) => {
                          const out = tr.output as { success?: boolean; message?: string }
                          return (
                            <div key={i} className={cn(
                              "flex items-center gap-1.5 text-xs",
                              out?.success ? "text-green-600 dark:text-green-400" : "text-red-500"
                            )}>
                              {out?.success ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                              <span>{out?.message || tr.toolName}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {msg.pendingAction && msg.calendarChoices && msg.actionStatus === 'pending' && !msg.calendarChoiceUsed && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                        <p className="text-xs opacity-80">保存先カレンダーを選んでください</p>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.calendarChoices.map((choice) => (
                            <Button
                              key={choice.id}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleCalendarChoiceSelect(msg.id, choice)}
                              disabled={isLoading}
                            >
                              {choice.name}{choice.isDefault ? ' (デフォルト)' : ''}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

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

                    {msg.calendarChoiceUsed && msg.pendingAction && msg.actionStatus === 'pending' && (
                      <div className="mt-1 text-xs opacity-50">
                        カレンダー選択済み
                      </div>
                    )}

                    {/* ベスト提案カード (推論結果の1案) */}
                    {msg.bestProposal && msg.bestProposalStatus === 'pending' && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-1.5">
                          <p className="text-xs font-semibold text-primary">{msg.bestProposal.title}</p>
                          <p className="text-sm font-bold">
                            {formatDateTimeRange(msg.bestProposal.startAt, msg.bestProposal.endAt)}
                          </p>
                          <p className="text-[11px] opacity-70">{msg.bestProposal.reason}</p>
                          <div className="flex gap-1.5 mt-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => handleAcceptProposal(msg.id)}
                              disabled={isLoading}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              この予定で登録
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleEditProposal(msg.id)}
                              disabled={isLoading}
                            >
                              変更する
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => handleRequestAlternatives(msg.id)}
                              disabled={isLoading}
                            >
                              他の候補
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ベスト提案: 承認済み */}
                    {msg.bestProposal && msg.bestProposalStatus === 'accepted' && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="rounded-xl border border-border/50 bg-muted/50 p-2.5 opacity-70">
                          <p className="text-xs font-medium">{msg.bestProposal.title}</p>
                          <p className="text-[11px]">
                            {formatDateTimeRange(msg.bestProposal.startAt, msg.bestProposal.endAt)}
                          </p>
                          <p className="text-[11px] opacity-50 mt-0.5">選択済み</p>
                        </div>
                      </div>
                    )}

                    {/* ベスト提案: 編集モード */}
                    {msg.bestProposal && msg.bestProposalStatus === 'editing' && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="rounded-xl border border-border p-3 space-y-2">
                          <p className="text-xs font-medium opacity-70">変更したい内容を入力してください</p>
                          <p className="text-[11px] opacity-50">
                            例: 「午前中にして」「30分で」「来週にして」
                          </p>
                        </div>
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
                        {msg.selectedOption ? `✓ ${msg.selectedOption}` : '選択済み'}
                      </div>
                    )}

                    {/* 候補時間カード（「他の候補」要求時） */}
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

            {/* ラリー制限警告 */}
            {rallyCount >= 12 && rallyCount < MAX_RALLIES && (
              <div className="px-4 pb-1">
                <p className="text-xs text-amber-600 text-center">
                  残り{MAX_RALLIES - rallyCount}ラリー（自動要約で続行します）
                </p>
              </div>
            )}

            {/* 入力エリア */}
            <div className="px-3 py-2.5 border-t shrink-0">
              {isSummarizing ? (
                <div className="text-center space-y-2 py-1">
                  <p className="text-sm text-muted-foreground">
                    会話を要約して続けます...
                  </p>
                  <div className="flex justify-center">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                </div>
              ) : rallyCount >= MAX_RALLIES ? (
                <div className="text-center space-y-2 py-1">
                  <p className="text-sm text-muted-foreground">
                    会話を要約して続けます...
                  </p>
                  <div className="flex justify-center">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
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
                      placeholder="メッセージを入力...（Enter送信 / Shift+Enter改行）"
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
