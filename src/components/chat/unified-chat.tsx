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
  ChevronRight,
  CheckCircle2,
  FileText,
  Folder,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  MessageSquarePlus,
  Mic,
  Plus,
  Search,
  Send,
  Square,
  SquarePen,
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
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useAgentChatSessions, type AgentChatSession } from "@/hooks/useAgentChatSessions"
import { cn } from "@/lib/utils"
import { useAgentConnection } from "@/components/chat/agent-status-chip"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { MAX_CURRENT_IMAGE_DATA_URL_CHARS, sanitizeUIMessagesForModel } from "@/lib/ai/ui-message-sanitize"
import type { Project } from "@/types/database"

interface UnifiedChatProps {
  spaceId?: string | null
  projectId?: string | null
  projectTitle?: string | null
  projects?: Project[]
  onSelectProject?: (id: string) => void
}

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

const MAX_CHAT_ATTACHMENTS = 4
const MAX_IMAGE_SIDE = 1600
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
const CHAT_SLOW_NOTICE_MS = 45_000
const CHAT_WATCHDOG_MS = 180_000
const DEFAULT_VISIBLE_HISTORY_COUNT = 3

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
type ChatMode = "general" | "project"

export function UnifiedChat({
  spaceId = null,
  projectId: _projectId = null,
  projectTitle = null,
  projects = [],
  onSelectProject,
}: UnifiedChatProps) {
  void _projectId
  void projectTitle
  const { state: connectionState } = useAgentConnection()
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [activeProjectChatId, setActiveProjectChatId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<FileUIPart[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [runtimeNotice, setRuntimeNotice] = useState<RuntimeNotice>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ startX: number; startY: number; tracking: boolean } | null>(null)
  const activeProjectChat = useMemo(() => {
    if (!activeProjectChatId) return null
    return projects.find(project =>
      project.id === activeProjectChatId &&
      project.status !== "archived" &&
      project.status !== "completed" &&
      (!spaceId || project.space_id === spaceId),
    ) ?? null
  }, [activeProjectChatId, projects, spaceId])
  const activeProjectChatIdForRequest = activeProjectChat?.id ?? null
  const chatMode: ChatMode = activeProjectChatIdForRequest ? "project" : "general"
  const chatScopeKey = activeProjectChatIdForRequest ? `project:${activeProjectChatIdForRequest}` : "general"

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/ai/agent",
      body: { spaceId, projectId: activeProjectChatIdForRequest, chatMode },
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
    [activeProjectChatIdForRequest, chatMode, spaceId],
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

  const sessions = useAgentChatSessions(chatScopeKey)
  const { hydrated, loadedScopeKey, saveMessages } = sessions
  const restoredScopeRef = useRef<string | null>(null)

  // Restore the active session whenever the user switches between general and project chats.
  useEffect(() => {
    if (!hydrated || loadedScopeKey !== chatScopeKey || restoredScopeRef.current === chatScopeKey) return
    restoredScopeRef.current = chatScopeKey
    const restore = sessions.activeSession
    setMessages(restore?.messages ?? [])
    setInput("")
    setAttachments([])
    setAttachmentError(null)
    setRuntimeNotice(null)
  }, [chatScopeKey, hydrated, loadedScopeKey, sessions.activeSession, setMessages])

  // Persist messages into the active session once a turn settles.
  useEffect(() => {
    if (!hydrated) return
    if (loadedScopeKey !== chatScopeKey) return
    if (status !== "ready" && status !== "error") return
    if (messages.length === 0) return
    saveMessages(messages)
  }, [messages, status, hydrated, loadedScopeKey, chatScopeKey, saveMessages])

  useEffect(() => {
    if (!activeProjectChatId || activeProjectChat) return
    setActiveProjectChatId(null)
  }, [activeProjectChat, activeProjectChatId])

  const handleSelectGeneralChat = useCallback(() => {
    setActiveProjectChatId(null)
  }, [])

  const handleSelectProjectChat = useCallback((projectId: string) => {
    setActiveProjectChatId(projectId)
    onSelectProject?.(projectId)
  }, [onSelectProject])

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
  }

  const insertAutomationPrompt = useCallback((prompt: string) => {
    setInput(prev => (prev.trim() ? `${prev.trim()}\n${prompt}` : prompt))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleNewSession = useCallback(() => {
    sessions.createSession()
    setMessages([])
    setInput("")
    setAttachments([])
    setAttachmentError(null)
    setRuntimeNotice(null)
    setMobileHistoryOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [sessions, setMessages])

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

  const sendLabel = connectionState === "online" ? "送信" : "予約して送信"
  const canSend = input.trim().length > 0 || attachments.length > 0
  const inputPlaceholder = activeProjectChat
    ? `${activeProjectChat.title} について質問`
    : "質問してみましょう"
  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) return
    const touch = event.touches[0]
    if (!touch) return
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      tracking: touch.clientX <= 44,
    }
  }, [])

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const current = swipeRef.current
    if (!current?.tracking || mobileHistoryOpen) return
    const touch = event.touches[0]
    if (!touch) return
    const dx = touch.clientX - current.startX
    const dy = touch.clientY - current.startY
    if (dx > 72 && Math.abs(dy) < 64) {
      setMobileHistoryOpen(true)
      swipeRef.current = { ...current, tracking: false }
    }
  }, [mobileHistoryOpen])

  const handleTouchEnd = useCallback(() => {
    swipeRef.current = null
  }, [])

  useEffect(() => {
    const handleToggleSidebar = () => setSidebarOpen(value => !value)
    const handleNewChat = () => handleNewSession()
    window.addEventListener("focusmap:chat:toggle-sidebar", handleToggleSidebar)
    window.addEventListener("focusmap:chat:new", handleNewChat)
    return () => {
      window.removeEventListener("focusmap:chat:toggle-sidebar", handleToggleSidebar)
      window.removeEventListener("focusmap:chat:new", handleNewChat)
    }
  }, [handleNewSession])

  return (
    <div
      className="relative flex h-full min-h-0 bg-[#1f1f1f] text-zinc-100"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {sidebarOpen && (
        <HistorySidebar
          sessions={sessions.sessions}
          activeSessionId={sessions.activeSessionId}
          onNew={handleNewSession}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          projects={projects}
          selectedSpaceId={spaceId}
          activeProjectChatId={activeProjectChatIdForRequest}
          onSelectGeneralChat={handleSelectGeneralChat}
          onSelectProjectChat={handleSelectProjectChat}
          className="hidden md:flex"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-6">
          {activeProjectChat && (
            <ProjectChatHeader project={activeProjectChat} hasMessages={messages.length > 0} />
          )}
          {messages.length === 0 ? (
            <EmptyChat />
          ) : (
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 pb-6">
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

        <div className="shrink-0 bg-[#1f1f1f]/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur md:px-6">
          <div className="mx-auto w-full max-w-[760px] space-y-2">
            {isRecording && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <VoiceWaveform analyserRef={analyserRef} barCount={28} barWidth={2} barGap={1} height={24} />
                <button type="button" onClick={stopRecording} className="ml-auto min-h-8 rounded px-2 font-medium">
                  停止
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex gap-2 overflow-x-auto rounded-xl border border-[#303030] bg-[#171717] p-2">
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.filename ?? "image"}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[#303030] bg-[#111111]">
                    <img src={attachment.url} alt={attachment.filename ?? "添付画像"} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-white shadow-sm"
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
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {attachmentError}
              </p>
            )}
            {runtimeNotice && (
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs",
                  runtimeNotice.tone === "error"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300",
                )}
              >
                <span>{runtimeNotice.message}</span>
                <button type="button" className="shrink-0 rounded px-2 py-1 font-medium" onClick={() => setRuntimeNotice(null)}>
                  閉じる
                </button>
              </div>
            )}
            <div className="rounded-[1.15rem] border border-[#343434] bg-[#111111] p-2 shadow-[0_16px_48px_rgba(0,0,0,0.22)]">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={inputPlaceholder}
                rows={1}
                className="max-h-28 min-h-8 w-full resize-none border-0 bg-transparent px-1 py-0 text-[15px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <div className="mt-0 flex min-h-8 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AutomationPromptMenu
                    onSelect={insertAutomationPrompt}
                    onAttachImage={() => fileInputRef.current?.click()}
                    attachDisabled={isBusy}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-full text-zinc-300 hover:bg-white/10 hover:text-white",
                      isRecording && "bg-red-500/15 text-red-300 hover:bg-red-500/20 hover:text-red-200",
                    )}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isTranscribing}
                    title={isRecording ? "録音停止" : "音声入力"}
                  >
                    {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
                  </Button>
                  {isBusy ? (
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-white text-zinc-950 hover:bg-zinc-200" onClick={() => void stop()} title="停止">
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:opacity-100"
                      disabled={!canSend}
                      onClick={() => submit(input)}
                      title={sendLabel}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="absolute left-0 top-1/2 z-20 flex h-20 w-7 -translate-y-1/2 items-center justify-center rounded-r-2xl border border-l-0 border-white/10 bg-[#171717]/85 text-zinc-400 shadow-sm backdrop-blur transition active:bg-[#242424] md:hidden"
        onClick={() => setMobileHistoryOpen(true)}
        aria-label="チャット履歴を開く"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <Button
        type="button"
        size="icon"
        className="absolute bottom-[calc(7.25rem+env(safe-area-inset-bottom,0px))] right-4 z-20 h-12 w-12 rounded-full bg-white text-zinc-950 shadow-lg hover:bg-zinc-200 md:hidden"
        onClick={handleNewSession}
        aria-label="新規チャット"
      >
        <SquarePen className="h-4 w-4" />
      </Button>

      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-[390px] border-[#303030] bg-[#171717] p-0 text-zinc-100">
          <HistorySidebar
            sessions={sessions.sessions}
            activeSessionId={sessions.activeSessionId}
            onNew={handleNewSession}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            projects={projects}
            selectedSpaceId={spaceId}
            activeProjectChatId={activeProjectChatIdForRequest}
            onSelectGeneralChat={handleSelectGeneralChat}
            onSelectProjectChat={handleSelectProjectChat}
            className="flex h-full w-full border-r-0"
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function AutomationPromptMenu({
  onSelect,
  onAttachImage,
  attachDisabled = false,
}: {
  onSelect: (prompt: string) => void
  onAttachImage: () => void
  attachDisabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full text-zinc-300 hover:bg-white/10 hover:text-white" title="追加">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">追加</DropdownMenuLabel>
        <DropdownMenuItem
          className="cursor-pointer gap-2 py-2"
          disabled={attachDisabled}
          onSelect={onAttachImage}
        >
          <ImageIcon className="h-4 w-4" />
          <span className="text-sm font-medium">写真を添付</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">よく使う依頼</DropdownMenuLabel>
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
  projects,
  selectedSpaceId,
  activeProjectChatId,
  onSelectGeneralChat,
  onSelectProjectChat,
  className,
}: {
  sessions: AgentChatSession[]
  activeSessionId: string | null
  onNew: () => void
  onSelect: (session: AgentChatSession) => void
  onDelete: (id: string) => void
  projects: Project[]
  selectedSpaceId: string | null
  activeProjectChatId: string | null
  onSelectGeneralChat: () => void
  onSelectProjectChat: (id: string) => void
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [showAllRecent, setShowAllRecent] = useState(false)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleSessions = useMemo(() => {
    const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!normalizedQuery) return sortedSessions
    return sortedSessions.filter(session => session.title.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, sessions])
  const isHistoryCollapsed = !normalizedQuery && !showAllRecent && visibleSessions.length > DEFAULT_VISIBLE_HISTORY_COUNT
  const displayedSessions = isHistoryCollapsed
    ? visibleSessions.slice(0, DEFAULT_VISIBLE_HISTORY_COUNT)
    : visibleSessions
  const visibleProjects = useMemo(() => {
    return projects
      .filter(project => project.status !== "archived" && project.status !== "completed")
      .filter(project => !selectedSpaceId || project.space_id === selectedSpaceId)
  }, [projects, selectedSpaceId])

  return (
    <aside className={cn("relative h-full w-[260px] shrink-0 flex-col border-r border-[#303030] bg-[#171717] text-zinc-100", className)}>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="検索"
            className="h-11 w-full rounded-lg border border-[#2d2d2d] bg-[#111111] pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white md:hidden" onClick={onNew} title="新規チャット">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-20">
        <div className="space-y-1 border-b border-[#303030] pb-2">
          <button
            type="button"
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition",
              activeProjectChatId === null ? "bg-white/10 text-zinc-100" : "text-zinc-300 hover:bg-white/10 hover:text-white",
            )}
            onClick={onSelectGeneralChat}
          >
            <MessageSquarePlus className="h-4 w-4" />
            チャット
          </button>
        </div>

        <div className="border-b border-[#303030] py-3">
          <div className="mb-2 px-1 text-xs font-semibold text-zinc-400">プロジェクト</div>
          {visibleProjects.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">プロジェクトはありません</p>
          ) : (
            <div className="space-y-0.5">
              {visibleProjects.map(project => {
                const active = project.id === activeProjectChatId
                const content = (
                  <>
                    <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  </>
                )

                return (
                  <button
                    key={project.id}
                    type="button"
                    className={cn(
                      "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition",
                      active ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white",
                    )}
                    onClick={() => onSelectProjectChat(project.id)}
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="py-3">
          <div className="mb-2 px-1 text-xs font-semibold text-zinc-400">最近</div>
          {visibleSessions.length === 0 ? (
            <p className="px-3 py-3 text-xs text-zinc-500">{query ? "一致する履歴はありません" : "履歴はまだありません"}</p>
          ) : (
            <div className="space-y-1">
              {displayedSessions.map(session => (
              <div key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(session)}
                  className={cn(
                    "flex min-h-11 w-full flex-col rounded-lg px-3 py-1.5 text-left transition",
                    activeSessionId === session.id ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <span className="w-[184px] truncate text-sm font-medium">{session.title}</span>
                  <span className="mt-0.5 text-[10px] text-zinc-500">{formatDate(session.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-1.5 hidden h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-300 group-hover:flex"
                  onClick={() => onDelete(session.id)}
                  aria-label="履歴を削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {!normalizedQuery && visibleSessions.length > DEFAULT_VISIBLE_HISTORY_COUNT && (
                <button
                  type="button"
                  className="mt-1 flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                  onClick={() => setShowAllRecent(value => !value)}
                >
                  {showAllRecent ? "表示を減らす" : "もっと表示する"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-[#303030] bg-[#171717] p-3">
        <div className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-zinc-200">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-600 text-xs font-semibold text-white">N</span>
          <span className="min-w-0 flex-1 truncate">nao</span>
          <ChevronRight className="h-4 w-4 rotate-90 text-zinc-500" />
        </div>
      </div>
    </aside>
  )
}

function ProjectChatHeader({ project, hasMessages }: { project: Project; hasMessages: boolean }) {
  return (
    <div className={cn("mx-auto w-full max-w-[760px]", hasMessages ? "mb-6" : "pt-8 md:pt-14")}>
      <div className={cn(
        "flex items-start gap-3",
        hasMessages ? "rounded-xl border border-[#303030] bg-[#171717]/80 px-3 py-2.5" : "px-1",
      )}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-zinc-100 ring-1 ring-white/10">
          <Folder className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn("min-w-0 max-w-full truncate font-semibold text-zinc-100", hasMessages ? "text-sm" : "text-xl md:text-2xl")}>
              {project.title}
            </h2>
            <span className="inline-flex min-h-6 items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300">
              プロジェクトチャット
            </span>
          </div>
          <p className={cn("mt-1 text-zinc-400", hasMessages ? "text-xs" : "text-sm")}>
            このプロジェクトの情報を読み込んだ状態で会話します。
          </p>
        </div>
      </div>
    </div>
  )
}

function EmptyChat() {
  return (
    <div className="mx-auto min-h-full w-full max-w-[760px]" />
  )
}

function FocusmapAssistantIcon({ active = false }: { active?: boolean }) {
  return (
    <div
      className={cn(
        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a] text-zinc-100 ring-1 ring-white/10",
        active && "animate-pulse ring-emerald-400/50",
      )}
    >
      <FocusmapLogo variant="mark" accentDot={active} className="h-5 w-5" />
    </div>
  )
}

function AssistantThinking() {
  return (
    <div className="flex gap-3 text-zinc-300">
      <FocusmapAssistantIcon active />
      <div className="px-0 py-2 text-sm">
        考え中…
      </div>
    </div>
  )
}

type ApprovalHandler = (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>

function MessageBubble({ message, isActive = false, onApproval }: { message: UIMessage; isActive?: boolean; onApproval: ApprovalHandler }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <FocusmapAssistantIcon active={isActive} />
      )}
      <div className={cn("flex min-w-0 flex-col gap-2", isUser ? "max-w-[78%] items-end sm:max-w-[68%]" : "max-w-[calc(100%-44px)] flex-1")}>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            if (!part.text) return null
            return (
              <div
                key={index}
                className={cn(
                  "whitespace-pre-wrap text-[15px] leading-7",
                  isUser
                    ? "rounded-2xl bg-white px-4 py-2.5 font-medium text-zinc-950 shadow-sm"
                    : "px-0 py-0 text-zinc-100",
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
