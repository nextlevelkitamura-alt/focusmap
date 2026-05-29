"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isFileUIPart,
  isToolUIPart,
  getToolName,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type FileUIPart,
  type UIMessage,
  type ToolUIPart,
  type DynamicToolUIPart,
} from "ai"
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  FileText,
  History,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  Terminal,
  Trash2,
  Workflow,
  Wrench,
  X,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useAgentChatSessions, type AgentChatSession } from "@/hooks/useAgentChatSessions"
import { cn } from "@/lib/utils"
import { AgentStatusChip, useAgentConnection } from "@/components/chat/agent-status-chip"
import { AutomationStatusPanel } from "@/components/chat/automation-status-panel"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { MAX_CURRENT_IMAGE_DATA_URL_CHARS, sanitizeUIMessagesForModel } from "@/lib/ai/ui-message-sanitize"

interface UnifiedChatProps {
  spaceId?: string | null
  projectId?: string | null
}

const PROMPTS = [
  "今日やることを整理して",
  "このプロジェクトの次の一手を考えて",
  "求人更新して",
  "この内容で求人立案して",
  "求人サイトを巡回して結果を記録して",
]

const AUTOMATION_SHORTCUTS = [
  {
    label: "予定を整理",
    description: "カレンダーの確認・調整案",
    prompt: "今日のカレンダーを確認して、不要な予定や調整したほうがいい予定を整理して",
    icon: CalendarDays,
  },
  {
    label: "タスク化",
    description: "会話やメモを実行項目へ",
    prompt: "この内容をタスクに分解して、次にやる順番まで整理して",
    icon: ListTodo,
  },
  {
    label: "調査する",
    description: "Web調査と要約",
    prompt: "この件を調査して、要点と次のアクションをまとめて",
    icon: Search,
  },
  {
    label: "メモ化",
    description: "内容をあとで使える形へ",
    prompt: "この内容をメモとして整理して、重要な判断と未決事項を分けて",
    icon: FileText,
  },
  {
    label: "求人更新",
    description: "仕事リポを見て求人を最新化",
    prompt: "仕事リポを確認して、求人更新に必要な差分を洗い出し、更新できるところまで実行して",
    icon: BriefcaseBusiness,
  },
  {
    label: "求人立案",
    description: "条件から求人案を作成",
    prompt: "この内容で求人立案して。仕事リポの求人作成ルールと既存求人を確認して、掲載できる案に整えて",
    icon: FileText,
  },
  {
    label: "仕事リポ巡回",
    description: "定期実行の予約",
    prompt: "仕事リポを毎朝9時に巡回して、求人更新・求人立案・採用対応が必要なものを報告する定期実行を設定して",
    icon: Workflow,
  },
]

type ChatTab = "chat" | "automation"

const MAX_CHAT_ATTACHMENTS = 4
const MAX_IMAGE_SIDE = 1600
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
const CHAT_SLOW_NOTICE_MS = 45_000
const CHAT_WATCHDOG_MS = 180_000

const TOOL_LABELS: Record<string, string> = {
  runTerminal: "ターミナル実行",
  listFiles: "フォルダ一覧",
  runOpenCode: "OpenCode実行",
  browserNavigate: "ブラウザで開く",
  browserClick: "クリック",
  browserFill: "入力",
  browserScreenshot: "スクリーンショット",
  readFile: "ファイル読み取り",
  writeFile: "ファイル書き込み",
  webResearch: "Web調査",
  addTask: "タスク追加",
  addCalendarEvent: "予定登録",
  addMindmapGroup: "グループ追加",
  addMindmapTask: "タスク追加",
  deleteMindmapNode: "ノード削除",
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("画像の解析に失敗しました"))
    image.src = src
  })
}

async function imageFileToPart(file: File): Promise<FileUIPart> {
  const rawDataUrl = await fileToDataUrl(file)
  const image = await loadImage(rawDataUrl)
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight)
  if (file.size <= MAX_IMAGE_BYTES && maxSide <= MAX_IMAGE_SIDE && rawDataUrl.length <= MAX_CURRENT_IMAGE_DATA_URL_CHARS) {
    return { type: "file", mediaType: file.type || "image/png", filename: file.name, url: rawDataUrl }
  }

  const scale = Math.min(1, MAX_IMAGE_SIDE / maxSide)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return { type: "file", mediaType: file.type || "image/png", filename: file.name, url: rawDataUrl }
  ctx.drawImage(image, 0, 0, width, height)
  const mediaType = "image/jpeg"
  return { type: "file", mediaType, filename: file.name, url: canvasToLimitedDataUrl(canvas) }
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || !Number.isFinite(bytes)) return ""
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function canvasToLimitedDataUrl(canvas: HTMLCanvasElement): string {
  const qualities = [0.86, 0.76, 0.66, 0.56, 0.46]
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality)
    if (dataUrl.length <= MAX_CURRENT_IMAGE_DATA_URL_CHARS) return dataUrl
  }
  return canvas.toDataURL("image/jpeg", 0.38)
}

function friendlyChatError(error: Error): string {
  const message = error.message || ""
  if (/maximum context length|reduce the length of the messages|context/i.test(message)) {
    return "履歴内の画像・スクリーンショットが大きすぎました。軽量化して再送します。もう一度送ってください。"
  }
  if (/timeout|aborted|network/i.test(message)) {
    return "応答がタイムアウトしました。入力欄は使えます。もう一度送れます。"
  }
  return message || "送信に失敗しました。もう一度送れます。"
}

type RuntimeNotice = {
  tone: "info" | "error"
  message: string
} | null

export function UnifiedChat({ spaceId = null, projectId: _projectId = null }: UnifiedChatProps) {
  void _projectId
  const { state: connectionState } = useAgentConnection()
  const [input, setInput] = useState("")
  const [activeTab, setActiveTab] = useState<ChatTab>("chat")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [attachments, setAttachments] = useState<FileUIPart[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [runtimeNotice, setRuntimeNotice] = useState<RuntimeNotice>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/ai/agent",
      body: { spaceId },
      prepareSendMessagesRequest: ({ messages, body, headers, credentials, api, messageId }) => ({
        api,
        headers,
        credentials,
        body: {
          ...(body ?? {}),
          messages: sanitizeUIMessagesForModel(messages, { currentUserMessageId: messageId }),
        },
      }),
    }),
    [spaceId],
  )

  const { messages, sendMessage, setMessages, status, stop, addToolApprovalResponse, error, clearError } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: error => {
      setRuntimeNotice({ tone: "error", message: friendlyChatError(error) })
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      if (isAbort) {
        setRuntimeNotice({ tone: "info", message: "応答を停止しました。入力欄は使えます。" })
        return
      }
      if (isDisconnect || isError) {
        setRuntimeNotice({ tone: "error", message: "応答が途中で止まりました。もう一度送れます。" })
        return
      }
      setRuntimeNotice(null)
    },
  })

  const sessions = useAgentChatSessions()
  const { hydrated, saveMessages } = sessions
  const restoredRef = useRef(false)

  // One-time: restore the last active session's messages after hydration.
  useEffect(() => {
    if (restoredRef.current || !hydrated) return
    restoredRef.current = true
    const restore = sessions.activeSession
    if (restore && restore.messages.length > 0) {
      setMessages(restore.messages)
    }
    // sessions.activeSession is read once at restore time; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, setMessages])

  // Persist messages into the active session once a turn settles.
  useEffect(() => {
    if (!hydrated) return
    if (status !== "ready" && status !== "error") return
    if (messages.length === 0) return
    saveMessages(messages)
  }, [messages, status, hydrated, saveMessages])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length, status])

  const isBusy = status === "submitted" || status === "streaming"
  const lastAssistantMessageId = useMemo(
    () => [...messages].reverse().find(message => message.role === "assistant")?.id ?? null,
    [messages],
  )

  const handleTranscribed = useCallback((text: string) => {
    setInput(prev => (prev ? `${prev} ${text}` : text))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])
  const { isRecording, isTranscribing, analyserRef, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (status !== "error" || !error) return
    setRuntimeNotice({ tone: "error", message: friendlyChatError(error) })
  }, [status, error])

  useEffect(() => {
    if (!isBusy) return
    const slowTimer = window.setTimeout(() => {
      setRuntimeNotice({ tone: "info", message: "応答待ちが続いています。停止しても入力欄は戻ります。" })
    }, CHAT_SLOW_NOTICE_MS)
    const watchdogTimer = window.setTimeout(() => {
      void stop()
      setRuntimeNotice({ tone: "error", message: "応答が3分以上止まったため自動停止しました。もう一度送れます。" })
    }, CHAT_WATCHDOG_MS)
    return () => {
      window.clearTimeout(slowTimer)
      window.clearTimeout(watchdogTimer)
    }
  }, [isBusy, stop])

  const addAttachmentFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      setAttachmentError("画像ファイルを選択してください")
      return
    }
    const room = MAX_CHAT_ATTACHMENTS - attachments.length
    if (room <= 0) {
      setAttachmentError(`画像は${MAX_CHAT_ATTACHMENTS}枚まで添付できます`)
      return
    }
    setAttachmentError(null)
    try {
      const parts = await Promise.all(imageFiles.slice(0, room).map(imageFileToPart))
      setAttachments(prev => [...prev, ...parts].slice(0, MAX_CHAT_ATTACHMENTS))
      if (imageFiles.length > room) {
        setAttachmentError(`画像は${MAX_CHAT_ATTACHMENTS}枚まで添付できます`)
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "画像の追加に失敗しました")
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [attachments.length])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    void addAttachmentFiles(Array.from(event.target.files ?? []))
  }, [addAttachmentFiles])

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
    setAttachmentError(null)
  }, [])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || isBusy) return
    const files = attachments
    if (status === "error") clearError()
    setRuntimeNotice(null)
    void sendMessage(trimmed ? { text: trimmed, files } : { files }).catch(error => {
      setRuntimeNotice({ tone: "error", message: error instanceof Error ? friendlyChatError(error) : "送信に失敗しました。もう一度送れます。" })
    })
    setInput("")
    setAttachments([])
    setAttachmentError(null)
    setActiveTab("chat")
  }

  const insertAutomationPrompt = useCallback((prompt: string) => {
    setActiveTab("chat")
    setInput(prev => (prev.trim() ? `${prev.trim()}\n${prompt}` : prompt))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleNewSession = () => {
    sessions.createSession()
    setMessages([])
    setInput("")
    setAttachments([])
    setAttachmentError(null)
    setRuntimeNotice(null)
    setMobileHistoryOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSelectSession = (session: AgentChatSession) => {
    sessions.selectSession(session.id)
    setMessages(session.messages)
    setMobileHistoryOpen(false)
  }

  const handleDeleteSession = (id: string) => {
    const wasActive = sessions.activeSessionId === id
    sessions.deleteSession(id)
    if (wasActive) setMessages([])
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    const native = event.nativeEvent as KeyboardEvent
    if (native.isComposing || native.keyCode === 229) return
    event.preventDefault()
    submit(input)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files ?? []).filter(file => file.type.startsWith("image/"))
    if (imageFiles.length === 0) return
    event.preventDefault()
    void addAttachmentFiles(imageFiles)
  }

  const sendLabel = connectionState === "offline" ? "予約して送信" : "送信"
  const canSend = input.trim().length > 0 || attachments.length > 0

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {sidebarOpen && (
        <HistorySidebar
          sessions={sessions.sessions}
          activeSessionId={sessions.activeSessionId}
          onNew={handleNewSession}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          className="hidden md:flex"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" className="hidden h-9 w-9 md:inline-flex" onClick={() => setSidebarOpen(v => !v)}>
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => setMobileHistoryOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <ChatTabs value={activeTab} onChange={setActiveTab} />
          </div>
          {activeTab === "chat" && (
            <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 text-xs sm:inline-flex" onClick={handleNewSession}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
              新規
            </Button>
          )}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {activeTab === "automation" ? (
            <AutomationDashboard spaceId={spaceId} onPrompt={insertAutomationPrompt} />
          ) : messages.length === 0 ? (
            <EmptyChat onPrompt={submit} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isActive={isBusy && message.id === lastAssistantMessageId}
                  onApproval={addToolApprovalResponse}
                />
              ))}
              {status === "submitted" && (
                <AssistantThinking />
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <AgentStatusChip state={connectionState} />
            {isRecording && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <VoiceWaveform analyserRef={analyserRef} barCount={28} barWidth={2} barGap={1} height={24} />
                <button type="button" onClick={stopRecording} className="ml-auto min-h-8 rounded px-2 font-medium">
                  停止
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex gap-2 overflow-x-auto rounded-md border bg-muted/20 p-2">
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.filename ?? "image"}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-background">
                    <img src={attachment.url} alt={attachment.filename ?? "添付画像"} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
                      onClick={() => removeAttachment(index)}
                      aria-label="添付画像を削除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachmentError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {attachmentError}
              </p>
            )}
            {runtimeNotice && (
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs",
                  runtimeNotice.tone === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                <span>{runtimeNotice.message}</span>
                <button type="button" className="shrink-0 rounded px-2 py-1 font-medium" onClick={() => setRuntimeNotice(null)}>
                  閉じる
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <AutomationPromptMenu onSelect={insertAutomationPrompt} />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
                title="画像を添付"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                variant={isRecording ? "destructive" : "outline"}
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                title={isRecording ? "録音停止" : "音声入力"}
              >
                {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
              </Button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={activeTab === "automation" ? "例: 毎朝予定を確認して、調整案を出して" : "例: 今日やることを整理して"}
                rows={1}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border bg-background px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              {isBusy ? (
                <Button size="icon" variant="destructive" className="h-11 w-11 shrink-0" onClick={() => void stop()} title="停止">
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="icon" className="h-11 w-11 shrink-0" disabled={!canSend} onClick={() => submit(input)} title={sendLabel}>
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[340px] p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" />
              チャット履歴
            </SheetTitle>
          </SheetHeader>
          <HistorySidebar
            sessions={sessions.sessions}
            activeSessionId={sessions.activeSessionId}
            onNew={handleNewSession}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            className="flex h-full border-r-0"
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ChatTabs({ value, onChange }: { value: ChatTab; onChange: (value: ChatTab) => void }) {
  const tabs: Array<{ value: ChatTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { value: "chat", label: "チャット", icon: MessageCircle },
    { value: "automation", label: "自動化", icon: Workflow },
  ]

  return (
    <div className="grid h-8 grid-cols-2 rounded-lg border bg-muted/30 p-0.5 text-xs">
      {tabs.map(tab => {
        const Icon = tab.icon
        const selected = value === tab.value
        return (
          <button
            key={tab.value}
            type="button"
            aria-label={tab.label}
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md px-3 font-medium transition-colors",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function AutomationPromptMenu({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-lg" title="自動化メニュー">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">自動化を選ぶ</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {AUTOMATION_SHORTCUTS.map(item => {
          const Icon = item.icon
          return (
            <DropdownMenuItem
              key={item.label}
              className="cursor-pointer items-start gap-2 py-2"
              onSelect={() => onSelect(item.prompt)}
            >
              <Icon className="mt-0.5 h-4 w-4" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HistorySidebar({
  sessions,
  activeSessionId,
  onNew,
  onSelect,
  onDelete,
  className,
}: {
  sessions: AgentChatSession[]
  activeSessionId: string | null
  onNew: () => void
  onSelect: (session: AgentChatSession) => void
  onDelete: (id: string) => void
  className?: string
}) {
  return (
    <aside className={cn("h-full w-[280px] shrink-0 flex-col border-r bg-muted/20", className)}>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" />
          履歴
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNew} title="新規チャット">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">履歴はまだありません</p>
        ) : (
          <div className="space-y-1">
            {sessions.map(session => (
              <div key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(session)}
                  className={cn(
                    "flex min-h-14 w-full flex-col rounded-md px-3 py-2 text-left transition",
                    activeSessionId === session.id ? "bg-background shadow-sm" : "hover:bg-background/70",
                  )}
                >
                  <span className="w-[200px] truncate text-sm font-medium">{session.title}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">{formatDate(session.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-2 hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                  onClick={() => onDelete(session.id)}
                  aria-label="履歴を削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function EmptyChat({ onPrompt }: { onPrompt: (text: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground ring-1 ring-border/60">
          <FocusmapLogo variant="mark" accentDot className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">何をしますか？</h2>
        <p className="mt-1 text-sm text-muted-foreground">相談や整理はそのまま答え、実行が必要なら自動で動きます。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {PROMPTS.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="min-h-16 rounded-md border bg-background px-3 py-2 text-left text-sm transition hover:bg-muted/60"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

function AutomationDashboard({ spaceId, onPrompt }: { spaceId: string | null; onPrompt: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <AutomationStatusPanel spaceId={spaceId} embedded />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {AUTOMATION_SHORTCUTS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onPrompt(item.prompt)}
              className="min-h-20 rounded-md border bg-background px-3 py-3 text-left transition hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FocusmapAssistantIcon({ active = false }: { active?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground ring-1 ring-border/60",
        active && "animate-pulse ring-primary/50",
      )}
    >
      <FocusmapLogo variant="mark" accentDot={active} className="h-5 w-5" />
    </div>
  )
}

function AssistantThinking() {
  return (
    <div className="flex gap-3">
      <FocusmapAssistantIcon active />
      <div className="rounded-lg bg-muted/70 px-3 py-2 text-sm text-muted-foreground">
        考え中…
      </div>
    </div>
  )
}

type ApprovalHandler = (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>

function MessageBubble({ message, isActive = false, onApproval }: { message: UIMessage; isActive?: boolean; onApproval: ApprovalHandler }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {!isUser && (
        <FocusmapAssistantIcon active={isActive} />
      )}
      <div className={cn("flex min-w-0 max-w-[86%] flex-col gap-2", isUser && "items-end")}>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            if (!part.text) return null
            return (
              <div
                key={index}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm leading-6 whitespace-pre-wrap",
                  isUser ? "bg-primary text-primary-foreground" : "bg-muted/70",
                )}
              >
                {part.text}
              </div>
            )
          }
          if (isToolUIPart(part)) {
            return <ToolPart key={index} part={part} name={getToolName(part)} onApproval={onApproval} />
          }
          if (isFileUIPart(part)) {
            return <FilePart key={index} part={part} isUser={isUser} />
          }
          return null
        })}
      </div>
    </div>
  )
}

function FilePart({ part, isUser }: { part: FileUIPart; isUser: boolean }) {
  const isImage = part.mediaType.toLowerCase().startsWith("image/")
  if (isImage) {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "block overflow-hidden rounded-lg border bg-background",
          isUser ? "max-w-[240px]" : "max-w-[360px]",
        )}
      >
        <img src={part.url} alt={part.filename ?? "添付画像"} className="max-h-[360px] w-full object-contain" />
        {part.filename && (
          <span className="block truncate border-t px-2 py-1 text-[11px] text-muted-foreground">{part.filename}</span>
        )}
      </a>
    )
  }
  return (
    <div className={cn("inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs", isUser ? "bg-primary text-primary-foreground" : "bg-muted/70")}>
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{part.filename ?? part.mediaType}</span>
    </div>
  )
}

type ToolOutput = {
  success?: boolean
  message?: string
  error?: string
  result?: unknown
  offline?: boolean
}

type ToolImagePreview = {
  url: string
  label: string
  bytes?: number
}

function collectToolImages(value: unknown, label = "画像", seen = new Set<string>(), depth = 0): ToolImagePreview[] {
  if (!value || depth > 5) return []
  if (typeof value === "string") {
    if (value.startsWith("data:image/") && !seen.has(value)) {
      seen.add(value)
      return [{ url: value, label }]
    }
    return []
  }
  if (typeof value !== "object") return []
  const obj = value as Record<string, unknown>
  const images: ToolImagePreview[] = []
  const dataUrl = obj.data_url
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && !seen.has(dataUrl)) {
    seen.add(dataUrl)
    images.push({
      url: dataUrl,
      label,
      bytes: typeof obj.bytes === "number" ? obj.bytes : undefined,
    })
  }
  for (const [key, child] of Object.entries(obj)) {
    if (images.length >= 6) break
    if (key === "data_url") continue
    images.push(...collectToolImages(child, key === "result" ? label : key, seen, depth + 1))
  }
  return images
}

function ToolPart({
  part,
  name,
  onApproval,
}: {
  part: ToolUIPart | DynamicToolUIPart
  name: string
  onApproval: ApprovalHandler
}) {
  const state = part.state
  const running = state === "input-streaming" || state === "input-available"
  const failed = state === "output-error"
  const done = state === "output-available"
  const awaitingApproval = state === "approval-requested"
  const denied = state === "output-denied"

  const output = done ? (part as { output?: unknown }).output as ToolOutput | undefined : undefined
  const offline = output?.success === false && output.offline === true
  const ok = done && output?.success !== false && !offline
  const toolImages = done ? collectToolImages(output?.result ?? output, toolLabel(name)) : []

  const approvalId = (awaitingApproval || state === "approval-responded")
    ? (part as { approval?: { id: string } }).approval?.id
    : undefined
  const commandPreview = (() => {
    const input = (part as { input?: unknown }).input
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>
      if (typeof obj.command === "string") return obj.command
      if (typeof obj.path === "string") return obj.path
      if (typeof obj.prompt === "string") return obj.prompt
    }
    return undefined
  })()

  if (awaitingApproval) {
    return (
      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span>{toolLabel(name)}の実行を確認してください</span>
        </div>
        {commandPreview && (
          <pre className="overflow-x-auto rounded bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all">{commandPreview}</pre>
        )}
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!approvalId}
            onClick={() => approvalId && void onApproval({ id: approvalId, approved: true })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            実行する
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!approvalId}
            onClick={() => approvalId && void onApproval({ id: approvalId, approved: false })}
          >
            <XCircle className="h-3.5 w-3.5" />
            やめる
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
          running && "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
          failed && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
          denied && "border-border bg-muted/40 text-muted-foreground",
          offline && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          ok && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          !running && !failed && !done && !denied && "border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : failed ? (
          <XCircle className="h-3.5 w-3.5 shrink-0" />
        ) : denied ? (
          <XCircle className="h-3.5 w-3.5 shrink-0" />
        ) : offline ? (
          <Terminal className="h-3.5 w-3.5 shrink-0" />
        ) : ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 truncate">
          {toolLabel(name)}
          {running && "…"}
          {denied && " — キャンセルしました"}
          {done && output?.message ? ` — ${output.message}` : ""}
          {failed && (part as { errorText?: string }).errorText ? ` — ${(part as { errorText?: string }).errorText}` : ""}
        </span>
      </div>
      {toolImages.map((image, index) => (
        <a
          key={`${image.url.slice(0, 48)}-${index}`}
          href={image.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border bg-background"
        >
          <div className="flex items-center gap-1.5 border-b px-2 py-1.5 text-[11px] text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="truncate">{image.label}</span>
            {image.bytes ? <span className="ml-auto shrink-0">{formatBytes(image.bytes)}</span> : null}
          </div>
          <img src={image.url} alt={image.label} className="max-h-[420px] w-full object-contain" />
        </a>
      ))}
    </div>
  )
}
