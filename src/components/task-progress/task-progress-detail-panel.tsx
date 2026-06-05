"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Clock, Loader2, RefreshCw, Terminal } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
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

const DETAIL_POLL_INTERVAL_MS = 3_000
const WATCH_PING_INTERVAL_MS = 10_000

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

function activityLabel(value: string | null | undefined) {
  switch (value) {
    case "running":
    case "resumed":
      return "実行中"
    case "awaiting_approval":
    case "needs_input":
    case "completed":
      return "確認待ち"
    case "failed":
      return "接続失敗"
    case "thread_detected":
      return "thread検出"
    default:
      return value || "activity"
  }
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const watchIdRef = useRef<string | null>(null)
  const taskId = task?.id ?? null
  const isFixtureTask = !!taskId?.startsWith("fixture:")

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

  useEffect(() => {
    if (!open || !taskId) {
      setDetail(null)
      setError(null)
      return
    }
    void fetchDetail()
  }, [fetchDetail, open, taskId])

  useEffect(() => {
    if (!open || !taskId || isFixtureTask) return
    const intervalId = window.setInterval(() => void fetchDetail(), DETAIL_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [fetchDetail, isFixtureTask, open, taskId])

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
  const tailItems = useMemo(() => {
    const progress = detail?.progress ?? []
    const events = detail?.events ?? []
    return [
      ...progress.map(item => ({
        id: `progress:${item.id}`,
        createdAt: item.created_at ?? "",
        label: item.phase ?? "progress",
        body: item.message || compactText(item.progress_json),
      })),
      ...events.map(item => ({
        id: `event:${item.id}`,
        createdAt: item.created_at ?? "",
        label: item.event_type,
        body: compactText(item.payload_json),
      })),
    ]
      .filter(item => item.body)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, 50)
  }, [detail])

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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-6 h-9 w-9 shrink-0"
              onClick={() => void fetchDetail()}
              disabled={isLoading || !taskId}
              aria-label="Codex進捗を更新"
              title="更新"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {(taskForDisplay?.current_step || taskForDisplay?.summary) && (
              <section className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">Current</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {taskForDisplay.current_step || taskForDisplay.summary}
                </div>
                {typeof taskForDisplay.progress_percent === "number" && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, taskForDisplay.progress_percent))}%` }}
                      />
                    </div>
                    <div className="mt-1 text-right text-[11px] text-muted-foreground">
                      {taskForDisplay.progress_percent}%
                    </div>
                  </div>
                )}
              </section>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                {error}
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">進捗履歴</h3>
                <span className="text-[11px] text-muted-foreground">開いている間だけ更新</span>
              </div>
              {tailItems.length > 0 ? (
                <div className="space-y-2">
                  {tailItems.map(item => (
                    <article key={item.id} className="rounded-lg border bg-background p-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate font-medium">{activityLabel(item.label)}</span>
                        <span className="shrink-0">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                        {item.body}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                  {isLoading ? "読み込み中..." : "まだ詳細ログはありません"}
                </div>
              )}
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
