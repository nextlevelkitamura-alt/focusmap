"use client"

import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Clock, Copy, ExternalLink, Loader2, Smartphone, Terminal } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import {
  beginCopyPromptForCodexHandoff,
  buildCodexOpenTarget,
  canUseLocalCodexOpenApi,
  copyPromptForCodexHandoff,
  getCurrentMobilePlatform,
  isLikelyMobileDevice,
  openCodexMobileTargetViaFocusmapNativeApp,
} from "@/lib/codex-app-launch"
import {
  codexMonitorToneClass,
  codexMonitorUiLabel,
  formatTaskProgressDateTime,
  getCodexMonitorUiStatus,
} from "@/lib/task-progress-ui"
import { cn } from "@/lib/utils"
import type {
  TaskProgressDetailResponse,
  TaskProgressSnapshotTask,
} from "@/types/task-progress"
import type { AiTaskActivityMessage } from "@/types/ai-task"

const DETAIL_POLL_INTERVAL_MS = 3_000
const WATCH_PING_INTERVAL_MS = 10_000
const LOCAL_SYNC_STATUSES = new Set(["pending", "running", "awaiting_approval", "needs_input", "completed"])

function statusClass(status: string | null | undefined) {
  return codexMonitorToneClass(status)
}

function statusIcon(status: string | null | undefined) {
  switch (getCodexMonitorUiStatus(status)) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    case "review":
    case "unsent":
      return <Clock className="h-3.5 w-3.5" />
    case "connection_failed":
      return <AlertCircle className="h-3.5 w-3.5" />
    default:
      return <Terminal className="h-3.5 w-3.5" />
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  return formatTaskProgressDateTime(value)
}

function compactText(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of ["current_step", "summary", "message", "error_message", "error", "status", "codex_run_state"]) {
      const nested: string = compactText(record[key])
      if (nested) return nested
    }
  }
  return ""
}

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です/u.test(value.trim())
}

function activityMessageLabel(message: AiTaskActivityMessage) {
  if (message.role === "user" || message.kind === "user_answer" || message.kind === "sent") return "送信した内容"
  if (message.kind === "question") return "Codexから質問"
  if (message.kind === "approval") return "Codexの返答"
  if (message.kind === "completed") return "Codexの返答"
  if (message.kind === "failed") return "接続失敗"
  if (message.kind === "prompt_waiting") return "プロンプト待ち"
  return message.role === "codex" ? "Codexの返答" : "状態"
}

function activityMessageClass(message: AiTaskActivityMessage) {
  if (message.role === "user" || message.kind === "user_answer" || message.kind === "sent") return "ml-auto max-w-[86%] border-muted bg-muted"
  if (message.role === "status") return "mx-auto max-w-[92%] border-transparent bg-transparent px-1 py-1 text-center text-muted-foreground shadow-none"
  if (message.kind === "question" || message.kind === "approval") return "mr-auto max-w-[92%] border-amber-500/30 bg-amber-500/10"
  if (message.kind === "failed") return "mr-auto max-w-[92%] border-red-500/30 bg-red-500/10"
  if (message.kind === "completed") return "mr-auto max-w-[92%] border-emerald-500/30 bg-emerald-500/10"
  return "mr-auto max-w-[92%] bg-background"
}

type TaskProgressDetailPanelProps = {
  open: boolean
  task: TaskProgressSnapshotTask | null
  isMobile?: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskProgressDetailPanel({
  open,
  task,
  isMobile = false,
  onOpenChange,
}: TaskProgressDetailPanelProps) {
  const [detail, setDetail] = useState<TaskProgressDetailResponse | null>(null)
  const [activityMessages, setActivityMessages] = useState<AiTaskActivityMessage[]>([])
  const [activityError, setActivityError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCopyingPrompt, setIsCopyingPrompt] = useState(false)
  const [isOpeningCodex, setIsOpeningCodex] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const watchIdRef = useRef<string | null>(null)
  const taskId = task?.id ?? null
  const isFixtureTask = !!taskId?.startsWith("fixture:")
  const shouldSyncLocalCodex =
    !!taskId &&
    !isFixtureTask &&
    canUseLocalCodexOpenApi() &&
    (task?.executor === "codex" || task?.executor === "codex_app") &&
    LOCAL_SYNC_STATUSES.has(task?.status ?? "")

  if (!watchIdRef.current && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    watchIdRef.current = `detail:${crypto.randomUUID()}`
  }

  const fetchDetail = useCallback(async () => {
    if (!taskId) return
    if (isFixtureTask && task) {
      const now = new Date().toISOString()
      setDetail({
        source: "fixture",
        task: task,
        progress: [{
          id: `${taskId}:progress`,
          task_id: taskId,
          phase: "fixture",
          message: task?.current_step || task?.summary || "fixture progress",
          progress_json: null,
          created_at: now,
        }],
        events: [{
          id: `${taskId}:event`,
          task_id: taskId,
          event_type: task?.status ?? "fixture",
          payload_json: { status: task?.status },
          created_at: now,
        }],
      })
      setError(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      setError(null)
      const response = await fetchWithSupabaseAuth(`/api/task-progress?task_id=${encodeURIComponent(taskId)}&limit=50`)
      if (!response.ok) throw new Error(`detail fetch failed (${response.status})`)
      setDetail(await response.json() as TaskProgressDetailResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "detail fetch failed")
    } finally {
      setIsLoading(false)
    }
  }, [isFixtureTask, task, taskId])

  const fetchActivity = useCallback(async () => {
    if (!taskId) return
    if (isFixtureTask && task) {
      const now = new Date().toISOString()
      setActivityMessages([
        {
          id: `${taskId}:fixture-prompt`,
          task_id: taskId,
          user_id: "fixture",
          role: "user",
          kind: "sent",
          body: task.title || "このタスクを確認してください",
          importance: "normal",
          metadata: { source: "fixture" },
          created_at: now,
        },
        {
          id: `${taskId}:fixture-response`,
          task_id: taskId,
          user_id: "fixture",
          role: "codex",
          kind: task.status === "failed" ? "failed" : task.status === "awaiting_approval" ? "approval" : "progress",
          body: task.current_step || task.summary || "Codex側の状態を確認中です",
          importance: task.status === "running" ? "normal" : "important",
          metadata: { source: "fixture" },
          created_at: now,
        },
      ])
      setActivityError(null)
      return
    }
    try {
      const response = await fetchWithSupabaseAuth(`/api/ai-tasks/${encodeURIComponent(taskId)}/activity`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { messages?: AiTaskActivityMessage[]; error?: string }
      if (!response.ok) throw new Error(data.error || `activity fetch failed (${response.status})`)
      setActivityMessages(Array.isArray(data.messages)
        ? data.messages.filter(message => !isGenericCodexPulseText(message.body))
        : [])
      setActivityError(null)
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : "activity fetch failed")
    }
  }, [isFixtureTask, task, taskId])

  const syncLocalCodex = useCallback(async () => {
    if (!taskId || !shouldSyncLocalCodex) return
    await fetchWithSupabaseAuth("/api/codex/sync-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_task_id: taskId, include_visible_activity: true }),
    }).catch(() => undefined)
  }, [shouldSyncLocalCodex, taskId])

  const refreshPanel = useCallback(async () => {
    await syncLocalCodex()
    await Promise.all([
      fetchDetail(),
      fetchActivity(),
    ])
  }, [fetchActivity, fetchDetail, syncLocalCodex])

  useEffect(() => {
    if (!open || !taskId) {
      setDetail(null)
      setActivityMessages([])
      setActivityError(null)
      setError(null)
      setIsCopyingPrompt(false)
      setPromptCopied(false)
      return
    }
    void refreshPanel()
  }, [open, refreshPanel, taskId])

  useEffect(() => {
    if (!open || !taskId || isFixtureTask) return
    const intervalId = window.setInterval(() => void refreshPanel(), DETAIL_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [isFixtureTask, open, refreshPanel, taskId])

  useEffect(() => {
    if (!open || !taskId || isFixtureTask) return
    const watchId = watchIdRef.current ?? `detail:${taskId}`
    const sendWatch = (action: "open" | "close" | "ping") => {
      void fetchWithSupabaseAuth("/api/task-progress/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: action === "close",
        body: JSON.stringify({
          task_id: taskId,
          action,
          watch_id: watchId,
          ttl_seconds: 20,
        }),
      }).catch(() => undefined)
    }
    sendWatch("open")
    const intervalId = window.setInterval(() => sendWatch("ping"), WATCH_PING_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
      sendWatch("close")
    }
  }, [isFixtureTask, open, taskId])

  const taskForDisplay = detail?.task ?? task
  const status = taskForDisplay?.status
  const statusLabel = status ? codexMonitorUiLabel(status) : "不明"
  const latestStatusText = compactText(taskForDisplay?.current_step) || compactText(taskForDisplay?.summary)
  const promptToCopy = activityMessages.find(message =>
    (message.role === "user" || message.kind === "sent") &&
    !!message.body.trim()
  )?.body.trim() ?? ""
  const canCopyPrompt = !!promptToCopy && getCodexMonitorUiStatus(status) !== "running"
  const isMobileOpenTarget = isMobile || isLikelyMobileDevice()
  const codexThreadUrl = taskForDisplay?.codex_thread_id ? `codex://threads/${taskForDisplay.codex_thread_id}` : null
  const codexOpenTarget = buildCodexOpenTarget(
    { prompt: promptToCopy, repoPath: null, threadUrl: codexThreadUrl },
    { preferMobile: isMobileOpenTarget, mobilePlatform: getCurrentMobilePlatform() },
  )

  const openCodex = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    if (!promptToCopy || isOpeningCodex) {
      event?.preventDefault()
      return
    }

    const copyAttempt = beginCopyPromptForCodexHandoff(promptToCopy)
    setIsOpeningCodex(true)
    setPromptCopied(false)
    setError(null)

    if (isMobileOpenTarget) {
      if (openCodexMobileTargetViaFocusmapNativeApp(codexOpenTarget.url, promptToCopy)) {
        event?.preventDefault()
      }
      copyAttempt.finished
        .then(copied => {
          setPromptCopied(copied)
          if (!copied) setError("クリップボードコピー失敗。Focusmapに戻って再コピーしてください")
        })
        .catch(() => setError("クリップボードコピー失敗。Focusmapに戻って再コピーしてください"))
        .finally(() => setIsOpeningCodex(false))
      return
    }

    event?.preventDefault()
    try {
      const copied = await copyAttempt.finished
      if (!copied) throw new Error("クリップボードコピー失敗")
      if (typeof window !== "undefined") window.location.href = codexOpenTarget.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codexを開けませんでした")
    } finally {
      setIsOpeningCodex(false)
    }
  }, [codexOpenTarget.url, isMobileOpenTarget, isOpeningCodex, promptToCopy])

  const copyPrompt = useCallback(async () => {
    if (!promptToCopy || isCopyingPrompt) return
    setIsCopyingPrompt(true)
    setPromptCopied(false)
    setError(null)
    try {
      const copied = await copyPromptForCodexHandoff(promptToCopy)
      if (!copied) throw new Error("クリップボードコピー失敗")
      setPromptCopied(true)
      window.setTimeout(() => setPromptCopied(false), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : "クリップボードコピー失敗")
    } finally {
      setIsCopyingPrompt(false)
    }
  }, [isCopyingPrompt, promptToCopy])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[82dvh] rounded-t-2xl" : "h-dvh w-[420px] sm:max-w-[420px]",
        )}
      >
        <SheetHeader className="border-b px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0">
              <SheetTitle className="break-words pr-2 text-sm leading-snug">
                {taskForDisplay?.title || task?.title || "Codexタスク"}
              </SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", statusClass(status))}>
                  {statusIcon(status)}
                  {statusLabel}
                </span>
                {taskForDisplay?.executor && <span>{taskForDisplay.executor}</span>}
                {formatDateTime(taskForDisplay?.updated_at) && <span>{formatDateTime(taskForDisplay?.updated_at)}</span>}
                {isLoading && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    最新状態を確認中...
                  </span>
                )}
              </SheetDescription>
            </div>
            {canCopyPrompt && (
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <a
                  href={codexOpenTarget.url}
                  onClick={(event) => void openCodex(event)}
                  aria-disabled={isOpeningCodex}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-emerald-200"
                >
                  {isOpeningCodex ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isMobileOpenTarget ? (
                    <Smartphone className="h-3.5 w-3.5" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Codexを開く
                </a>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  disabled={isCopyingPrompt}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-200"
                >
                  {isCopyingPrompt ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : promptCopied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {promptCopied ? "コピー済み" : "再コピー"}
                </button>
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {latestStatusText && (
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{statusLabel}</span>
                <span className="mx-1.5">·</span>
                <span className="whitespace-pre-wrap break-words">{latestStatusText}</span>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                {error}
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">チャット</h3>
                <span className="text-[11px] text-muted-foreground">
                  {isLoading ? "確認中..." : "最新ログまで表示"}
                </span>
              </div>
              {activityMessages.length > 0 ? (
                <div className="space-y-3">
                  {activityMessages.slice(-20).map(message => {
                    const isStatus = message.role === "status"
                    return (
                      <article key={message.id} className={cn("rounded-lg border p-3 shadow-sm", activityMessageClass(message))}>
                        <div className={cn("mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground", isStatus && "mb-0 justify-center")}>
                          <span className={cn("truncate font-medium", isStatus ? "text-muted-foreground" : "text-foreground")}>
                            {activityMessageLabel(message)}
                          </span>
                          {!isStatus && <span className="shrink-0">{formatDateTime(message.created_at)}</span>}
                        </div>
                        <p className={cn("whitespace-pre-wrap break-words text-xs leading-relaxed", isStatus ? "text-muted-foreground" : "text-foreground/90")}>
                          {message.body}
                        </p>
                      </article>
                    )
                  })}
                  <div className="py-1 text-center text-[11px] text-muted-foreground">
                    最新ログまで表示済み
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
                  {activityError ? "チャットログを取得できません" : "Codex側の返答を待っています"}
                </div>
              )}
            </section>

          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
