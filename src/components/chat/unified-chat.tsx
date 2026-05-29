"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isToolUIPart,
  getToolName,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
  type ToolUIPart,
  type DynamicToolUIPart,
} from "ai"
import {
  CalendarDays,
  CheckCircle2,
  FileText,
  History,
  ListTodo,
  Loader2,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Square,
  Terminal,
  Trash2,
  Workflow,
  Wrench,
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

interface UnifiedChatProps {
  spaceId?: string | null
  projectId?: string | null
}

const PROMPTS = [
  "今日やることを整理して",
  "このプロジェクトの次の一手を考えて",
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
]

type ChatTab = "chat" | "automation"

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

export function UnifiedChat({ spaceId = null, projectId: _projectId = null }: UnifiedChatProps) {
  void _projectId
  const { state: connectionState } = useAgentConnection()
  const [input, setInput] = useState("")
  const [activeTab, setActiveTab] = useState<ChatTab>("chat")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/ai/agent", body: { spaceId } }),
    [spaceId],
  )

  const { messages, sendMessage, setMessages, status, stop, addToolApprovalResponse } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy) return
    void sendMessage({ text: trimmed })
    setInput("")
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

  const sendLabel = connectionState === "offline" ? "予約して送信" : "送信"

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
            <div className="flex items-end gap-2">
              <AutomationPromptMenu onSelect={insertAutomationPrompt} />
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
                placeholder={activeTab === "automation" ? "例: 毎朝予定を確認して、調整案を出して" : "例: 今日やることを整理して"}
                rows={1}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border bg-background px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              {isBusy ? (
                <Button size="icon" variant="destructive" className="h-11 w-11 shrink-0" onClick={() => void stop()} title="停止">
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="icon" className="h-11 w-11 shrink-0" disabled={!input.trim()} onClick={() => submit(input)} title={sendLabel}>
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
          return null
        })}
      </div>
    </div>
  )
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

  const output = done ? (part as { output?: unknown }).output as { success?: boolean; message?: string; error?: string } | undefined : undefined
  const offline = output?.success === false && (output as { offline?: boolean })?.offline === true
  const ok = done && output?.success !== false && !offline

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
  )
}
