"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Bot,
  CheckCircle2,
  History,
  Loader2,
  Menu,
  MessageSquarePlus,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Square,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { cn } from "@/lib/utils"
import {
  countRunningMessages,
  createChatSession,
  deleteChatSession,
  getChatState,
  selectChatSession,
  sendChatMessage,
  subscribeChatRuntime,
  type FocusmapChatMessage,
  type FocusmapChatMode,
  type FocusmapChatSession,
} from "@/lib/chat-runtime"
import { TaskResultCard } from "@/components/chat/task-result-card"

interface ChatWorkspaceProps {
  mode: FocusmapChatMode
  spaceId?: string | null
  projectId?: string | null
  title?: string
}

interface AutomationSetupStatus {
  loading: boolean
  hasRunner: boolean
  hasGoogle: boolean
  hasGws: boolean
  hasPlaywright: boolean
  checked: boolean
}

interface AutomationRunnerSummary {
  executors?: string[]
  available_secret_names?: string[]
  metadata?: Record<string, unknown> | null
}

const PROMPTS: Record<FocusmapChatMode, string[]> = {
  normal: [
    "今日やることを整理して",
    "このプロジェクトの次の一手を考えて",
    "予定を見ながら作業時間を提案して",
  ],
  automation: [
    "今日のカレンダーを整理して",
    "求人巡回してスプレッドシートに記録して",
    "指定サイトの更新を確認して要約して",
  ],
}

function useChatState(mode: FocusmapChatMode) {
  const [state, setState] = useState(() => getChatState(mode))

  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) setState(getChatState(mode))
    })
    const unsubscribe = subscribeChatRuntime(() => setState(getChatState(mode)))
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [mode])

  return state
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

function statusIcon(message: FocusmapChatMessage) {
  if (message.status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  if (message.status === "failed") return <XCircle className="h-3.5 w-3.5 text-red-400" />
  if (message.taskId) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  return null
}

function metadataFlag(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  return keys.some(key => metadata?.[key] === true || metadata?.[key] === "true")
}

function useAutomationSetupPrompt(enabled: boolean) {
  const [status, setStatus] = useState<AutomationSetupStatus>({
    loading: enabled,
    hasRunner: true,
    hasGoogle: true,
    hasGws: true,
    hasPlaywright: true,
    checked: false,
  })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let mounted = true

    void (async () => {
      const [runnerRes, calendarRes] = await Promise.allSettled([
        fetch("/api/ai-runners", { cache: "no-store" }),
        fetch("/api/calendar/status", { cache: "no-store" }),
      ])
      if (!mounted) return

      let hasRunner = false
      let hasGoogle = false
      let hasGws = false
      let hasPlaywright = false
      if (runnerRes.status === "fulfilled" && runnerRes.value.ok) {
        const data = await runnerRes.value.json()
        const runners: AutomationRunnerSummary[] = Array.isArray(data.runners) ? data.runners : []
        const secretNames = new Set(runners.flatMap(runner => runner.available_secret_names ?? []))
        hasRunner = runners.length > 0
        hasGws = runners.some(runner => (
          secretNames.has("GWS_AUTH") ||
          secretNames.has("GOOGLE_WORKSPACE_MCP") ||
          metadataFlag(runner.metadata, ["gws_installed", "google_workspace_mcp", "gws_authenticated"])
        ))
        hasPlaywright = runners.some(runner => (
          runner.executors?.includes("playwright") ||
          metadataFlag(runner.metadata, ["playwright_authenticated", "browser_authenticated", "browser_profile_ready"])
        ))
      }
      if (calendarRes.status === "fulfilled" && calendarRes.value.ok) {
        const data = await calendarRes.value.json()
        hasGoogle = Boolean(data.isConnected) && !data.needsReconnect
      }
      setStatus({ loading: false, hasRunner, hasGoogle, hasGws, hasPlaywright, checked: true })
    })()

    return () => {
      mounted = false
    }
  }, [enabled])

  return {
    shouldPrompt: enabled && status.checked && !dismissed && (
      !status.hasRunner || !status.hasGoogle || !status.hasGws || !status.hasPlaywright
    ),
    status,
    dismiss: () => setDismissed(true),
  }
}

export function ChatWorkspace({ mode, spaceId = null, projectId = null, title }: ChatWorkspaceProps) {
  const state = useChatState(mode)
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeSession = useMemo(
    () => state.sessions.find(session => session.id === state.activeSessionId) ?? state.sessions[0] ?? null,
    [state.activeSessionId, state.sessions],
  )
  const runningCount = countRunningMessages(mode)
  const setupPrompt = useAutomationSetupPrompt(mode === "automation")

  const handleTranscribed = useCallback((text: string) => {
    setInput(prev => prev ? `${prev} ${text}` : text)
  }, [])
  const { isRecording, isTranscribing, analyserRef, startRecording, stopRecording } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (!activeSession && state.sessions.length === 0) createChatSession(mode)
  }, [activeSession, mode, state.sessions.length])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [activeSession?.messages.length, activeSession?.updatedAt])

  const submitText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const result = sendChatMessage({
      mode,
      sessionId: activeSession?.id ?? null,
      text: trimmed,
      spaceId,
      projectId,
    })
    if (result) setInput("")
  }, [activeSession?.id, mode, projectId, spaceId])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    const nativeEvent = event.nativeEvent as KeyboardEvent
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return
    event.preventDefault()
    submitText(input)
  }

  const modelLabel = mode === "automation" ? "DeepSeek V4 Pro" : "Gemini 3.1 Flash Lite"
  const resolvedTitle = title ?? (mode === "automation" ? "自動化チャット" : "通常チャット")

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {sidebarOpen && (
        <ChatHistorySidebar
          mode={mode}
          sessions={state.sessions}
          activeSessionId={activeSession?.id ?? null}
          className="hidden md:flex"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" className="hidden h-9 w-9 md:inline-flex" onClick={() => setSidebarOpen(v => !v)}>
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => setMobileHistoryOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              {mode === "automation" ? <Workflow className="h-4 w-4 text-primary" /> : <Bot className="h-4 w-4 text-primary" />}
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold md:text-base">{resolvedTitle}</h1>
                <p className="truncate text-[10px] text-muted-foreground md:text-xs">
                  {modelLabel}{runningCount > 0 ? ` / 実行中 ${runningCount}` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="hidden h-9 gap-1.5 text-xs sm:inline-flex" onClick={() => createChatSession(mode)}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
              新規
            </Button>
            {mode === "automation" && (
              <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                <Link href="/dashboard/settings/automation" aria-label="自動化設定">
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {!activeSession || activeSession.messages.length === 0 ? (
            <EmptyChat mode={mode} onPrompt={submitText} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {activeSession.messages.map(message => (
                <ChatBubble key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-2">
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
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === "automation" ? "例: 求人巡回してスプレッドシートに記録して" : "例: 今日やることを整理して"}
                rows={1}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-md border bg-background px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <Button size="icon" className="h-11 w-11 shrink-0" disabled={!input.trim()} onClick={() => submitText(input)}>
                <Send className="h-4 w-4" />
              </Button>
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
          <ChatHistorySidebar
            mode={mode}
            sessions={state.sessions}
            activeSessionId={activeSession?.id ?? null}
            onSelect={() => setMobileHistoryOpen(false)}
            className="flex h-full border-r-0"
          />
        </SheetContent>
      </Sheet>

      <Dialog open={setupPrompt.shouldPrompt} onOpenChange={open => { if (!open) setupPrompt.dismiss() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自動化の接続設定が必要です</DialogTitle>
            <DialogDescription>
              PC実行、Google認証、GWS / Playwright の権限を設定すると、スプレッドシート書き込みやブラウザ自動化を安定して実行できます。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <SetupRow ok={setupPrompt.status.hasRunner} label="PC実行ランナー" />
            <SetupRow ok={setupPrompt.status.hasGoogle} label="Googleアカウント認証" />
            <SetupRow ok={setupPrompt.status.hasGws} label="GWS / Google Workspace MCP" />
            <SetupRow ok={setupPrompt.status.hasPlaywright} label="Playwright / ブラウザ権限" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={setupPrompt.dismiss}>あとで</Button>
            <Button asChild>
              <Link href="/dashboard/settings/automation">設定を開く</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SetupRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={cn("flex items-center justify-between rounded-md border px-3 py-2", ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10")}>
      <span>{label}</span>
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
    </div>
  )
}

function ChatHistorySidebar({
  mode,
  sessions,
  activeSessionId,
  onSelect,
  className,
}: {
  mode: FocusmapChatMode
  sessions: FocusmapChatSession[]
  activeSessionId: string | null
  onSelect?: () => void
  className?: string
}) {
  return (
    <aside className={cn("h-full w-[280px] shrink-0 flex-col border-r bg-muted/20", className)}>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" />
          履歴
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => createChatSession(mode)}>
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
                  onClick={() => {
                    selectChatSession(mode, session.id)
                    onSelect?.()
                  }}
                  className={cn(
                    "flex min-h-14 w-full flex-col rounded-md px-3 py-2 text-left transition",
                    activeSessionId === session.id ? "bg-background shadow-sm" : "hover:bg-background/70",
                  )}
                >
                  <span className="w-[200px] truncate text-sm font-medium">{session.title}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatDate(session.updatedAt)} / {session.messages.length}件
                  </span>
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-2 hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                  onClick={() => deleteChatSession(mode, session.id)}
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

function EmptyChat({ mode, onPrompt }: { mode: FocusmapChatMode; onPrompt: (text: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          {mode === "automation" ? <Workflow className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
        </div>
        <h2 className="text-lg font-semibold">{mode === "automation" ? "何を自動化しますか？" : "何を整理しますか？"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "automation" ? "送信するとバックグラウンド実行に投入されます。" : "通常チャットは低コストモデルで軽く相談できます。"}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {PROMPTS[mode].map(prompt => (
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

function ChatBubble({ message }: { message: FocusmapChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}>
        {isUser ? <span className="text-xs font-semibold">You</span> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("min-w-0 max-w-[86%] space-y-2", isUser && "items-end")}>
        <div className={cn(
          "rounded-lg px-3 py-2 text-sm leading-6",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}>
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.error && <p className="mt-2 text-xs text-red-400">{message.error}</p>}
        </div>
        <div className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground", isUser && "justify-end")}>
          {statusIcon(message)}
          {message.modelLabel && <span>{message.modelLabel}</span>}
          <span>{formatTime(message.createdAt)}</span>
        </div>
        {message.taskId && <TaskResultCard taskId={message.taskId} />}
      </div>
    </div>
  )
}
