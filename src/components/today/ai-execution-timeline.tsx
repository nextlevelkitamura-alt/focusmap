"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Square,
  Terminal,
} from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { useAiTasks } from "@/hooks/useAiTasks"
import { useScheduledTasks } from "@/hooks/useScheduledTasks"
import type { AiTask, AiTaskProgressSummary, AiTaskStatus } from "@/types/ai-task"
import type { Space } from "@/types/database"

type AiExecutionTimelineProps = {
  selectedDate: Date
  compact?: boolean
  showDateControls?: boolean
  onDateChange?: (date: Date) => void
  selectedSpaceId?: string | null
  spaces?: Space[]
}

type AiStep = {
  key?: string
  label?: string
  message?: string
  status?: string
  at?: string
  created_at?: string
  ts?: string
}

const STATUS_STYLES: Record<AiTaskStatus, { label: string; icon: "idle" | "running" | "done" | "error"; className: string; dot: string }> = {
  pending: {
    label: "待機中",
    icon: "idle",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    dot: "bg-sky-400",
  },
  running: {
    label: "実行中",
    icon: "running",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    dot: "bg-violet-400",
  },
  awaiting_approval: {
    label: "確認待ち",
    icon: "idle",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
  },
  needs_input: {
    label: "入力待ち",
    icon: "idle",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    dot: "bg-orange-400",
  },
  completed: {
    label: "完了",
    icon: "done",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "失敗",
    icon: "error",
    className: "border-red-500/30 bg-red-500/10 text-red-300",
    dot: "bg-red-400",
  },
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date) {
  const d = startOfDay(date)
  d.setDate(d.getDate() + 1)
  return d
}

function isWithinDay(value: string | null | undefined, dayStart: Date, dayEnd: Date) {
  if (!value) return false
  const d = new Date(value)
  return !Number.isNaN(d.getTime()) && d >= dayStart && d < dayEnd
}

function cronMatchesDate(cron: string | null, date: Date) {
  if (!cron) return false
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const dow = parts[4]
  if (dow === "*") return true
  return dow.split(",").map(Number).includes(date.getDay())
}

function cronTime(cron: string | null) {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour] = parts
  const h = Number(hour)
  const m = Number(min)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function sortTime(task: AiTask, selectedDate: Date) {
  const time = task.recurrence_cron ? cronTime(task.recurrence_cron) : null
  if (time) {
    const [h, m] = time.split(":").map(Number)
    return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, m).getTime()
  }
  if (task.scheduled_at) return new Date(task.scheduled_at).getTime()
  if (task.started_at) return new Date(task.started_at).getTime()
  if (task.completed_at) return new Date(task.completed_at).getTime()
  return new Date(task.created_at).getTime()
}

function displayTime(task: AiTask) {
  const recurringTime = cronTime(task.recurrence_cron)
  if (recurringTime) return recurringTime
  const value = task.scheduled_at ?? task.started_at ?? task.completed_at ?? task.created_at
  return format(new Date(value), "HH:mm")
}

function recurringLabel(cron: string | null) {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, , , dow] = parts
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
  if (dow === "*") return `毎日 ${time}`
  const days = ["日", "月", "火", "水", "木", "金", "土"]
  const labels = dow
    .split(",")
    .map(v => days[Number(v)])
    .filter(Boolean)
    .join("・")
  return labels ? `毎週${labels} ${time}` : `${cron} (${time})`
}

function getResult(task: AiTask) {
  return task.result && typeof task.result === "object" && !Array.isArray(task.result)
    ? task.result as Record<string, unknown>
    : {}
}

function getProgressSummary(task: AiTask): AiTaskProgressSummary | null {
  const result = getResult(task)
  const value = result.progress_summary
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as AiTaskProgressSummary
}

function getLiveLog(task: AiTask) {
  const value = getResult(task).live_log
  return typeof value === "string" ? value.trim().slice(-1800) : ""
}

function getMessage(task: AiTask) {
  const value = getResult(task).message
  return typeof value === "string" ? value.trim().slice(0, 4000) : ""
}

function getSteps(task: AiTask) {
  const value = getResult(task).steps
  return Array.isArray(value) ? value.slice(-6) as AiStep[] : []
}

function StatusIcon({ status }: { status: AiTaskStatus }) {
  const style = STATUS_STYLES[status]
  if (style.icon === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (style.icon === "done") return <CheckCircle2 className="h-3.5 w-3.5" />
  if (style.icon === "error") return <AlertCircle className="h-3.5 w-3.5" />
  return <Clock className="h-3.5 w-3.5" />
}

function executorLabel(executor: AiTask["executor"] | null | undefined) {
  if (executor === "codex_app") return "Codex.app"
  if (executor === "codex") return "Codex"
  return "Claude"
}

function isVisibleOnDate(task: AiTask, selectedDate: Date) {
  const dayStart = startOfDay(selectedDate)
  const dayEnd = endOfDay(selectedDate)
  if (task.recurrence_cron) {
    const firstScheduledAt = task.scheduled_at ? new Date(task.scheduled_at) : null
    return (
      isWithinDay(task.scheduled_at, dayStart, dayEnd) ||
      (
        cronMatchesDate(task.recurrence_cron, selectedDate) &&
        (!firstScheduledAt || Number.isNaN(firstScheduledAt.getTime()) || dayEnd > firstScheduledAt)
      )
    )
  }
  return (
    isWithinDay(task.scheduled_at, dayStart, dayEnd) ||
    isWithinDay(task.started_at, dayStart, dayEnd) ||
    isWithinDay(task.completed_at, dayStart, dayEnd) ||
    (!task.scheduled_at && isWithinDay(task.created_at, dayStart, dayEnd))
  )
}

function CompletionMark({ task }: { task: AiTask }) {
  if (task.status === "running") return <Loader2 className="h-4 w-4 animate-spin text-violet-300" aria-hidden="true" />
  if (task.status === "completed") return <CheckSquare className="h-4 w-4 text-emerald-300" aria-hidden="true" />
  if (task.status === "failed") return <AlertCircle className="h-4 w-4 text-red-300" aria-hidden="true" />
  return <Square className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
}

function resultMetadata(task: AiTask) {
  const result = getResult(task)
  const rows: Array<[string, string]> = []
  if (task.scheduled_at) rows.push(["予定", format(new Date(task.scheduled_at), "yyyy/MM/dd HH:mm", { locale: ja })])
  if (task.cwd) rows.push(["cwd", task.cwd])
  if (typeof result.imported_from === "string") rows.push(["source", result.imported_from])
  if (typeof result.spreadsheet_row === "number" || typeof result.spreadsheet_row === "string") {
    rows.push(["sheet row", String(result.spreadsheet_row)])
  }
  if (typeof result.parent_task_id === "string") rows.push(["parent", result.parent_task_id])
  if (task.space_id) rows.push(["space", task.space_id])
  if (task.package_id) rows.push(["package", task.package_id])
  if (task.claimed_runner_id) rows.push(["runner", task.claimed_runner_id])
  return rows
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-normal text-muted-foreground/70">{label}</p>
      <pre className="max-h-52 overflow-auto rounded-md border border-border/40 bg-black/20 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  )
}

function packageTitle(task: AiTask) {
  const snapshot = task.package_snapshot
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const title = (snapshot as Record<string, unknown>).title
    if (typeof title === "string" && title.trim()) return title.trim()
  }
  return null
}

// Codex スレッドに「続けて送る」往復フォーム。
//   既存ターンの codex_thread_id を codex_resume_thread_id として渡し、
//   executor='codex' の新規 ai_task を作る → task-runner → bridge が thread/resume で会話継続。
function CodexFollowUpForm({ task }: { task: AiTask }) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = useCallback(async () => {
    const prompt = text.trim()
    if (!prompt || sending || !task.codex_thread_id) return
    setSending(true)
    setErr(null)
    try {
      const res = await fetch("/api/ai-tasks/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          cwd: task.cwd ?? undefined,
          executor: "codex",
          codex_resume_thread_id: task.codex_thread_id,
          approval_type: "auto",
          scheduled_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setErr(e?.error ?? `送信失敗 (${res.status})`)
        return
      }
      setText("")
      setSent(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [text, sending, task.cwd, task.codex_thread_id])

  return (
    <div className="space-y-1 pt-1">
      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="このCodexスレッドに続けて送る…"
          className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px]"
          disabled={sending}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {sending ? "送信中…" : "送信"}
        </button>
      </div>
      {sent && <p className="text-[10px] text-emerald-500">送信しました（次の更新でターンが追加されます）</p>}
      {err && <p className="text-[10px] text-rose-500">{err}</p>}
    </div>
  )
}

function AiExecutionCard({ task, spaceName }: { task: AiTask; spaceName?: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const style = STATUS_STYLES[task.status]
  const progress = getProgressSummary(task)
  const liveLog = getLiveLog(task)
  const message = getMessage(task)
  const steps = getSteps(task)
  const metadata = resultMetadata(task)
  const packageName = packageTitle(task)
  const hasDetails = !!(progress || liveLog || message || task.error || task.remote_session_url || task.codex_thread_id || steps.length || metadata.length)
  const cwdLabel = task.cwd ? task.cwd.split("/").filter(Boolean).at(-1) : null

  return (
    <div className="relative pl-5">
      <div className={cn("absolute left-0 top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background", style.dot)} />
      <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 shadow-sm">
        <div className="flex items-start gap-2">
          <div className="shrink-0 pt-0.5">
            <CompletionMark task={task} />
          </div>
          <div className="w-10 shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {displayTime(task)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", style.className)}>
                <StatusIcon status={task.status} />
                {style.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Terminal className="h-3 w-3" />
                {executorLabel(task.executor)}
              </span>
              {spaceName && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  {spaceName}
                </span>
              )}
              {packageName && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Package className="h-3 w-3" />
                  {packageName}
                </span>
              )}
              {task.recurrence_cron && (
                <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {recurringLabel(task.recurrence_cron)}
                </span>
              )}
            </div>
            <p className={cn(
              "mt-1.5 line-clamp-2 text-sm leading-snug text-foreground",
              task.status === "completed" && "text-muted-foreground line-through",
              task.status === "failed" && "text-red-200",
            )}>
              {task.skill_id && <span className="font-medium text-primary">/{task.skill_id} </span>}
              {task.prompt}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/70">
              {cwdLabel && <span>{cwdLabel}</span>}
              {task.claimed_runner_id && <span>runner {task.claimed_runner_id.slice(0, 8)}</span>}
              {task.started_at && <span>開始 {format(new Date(task.started_at), "M/d HH:mm", { locale: ja })}</span>}
              {task.completed_at && <span>終了 {format(new Date(task.completed_at), "M/d HH:mm", { locale: ja })}</span>}
            </div>
            {progress && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, progress.progress_percent))}%` }}
                  />
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {progress.summary || progress.current_step}
                </p>
              </div>
            )}
          </div>
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="AI実行詳細を開閉"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {expanded && hasDetails && (
          <div className="mt-3 space-y-2 border-t border-border/40 pt-2">
            {task.error && (
              <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                {task.error}
              </p>
            )}
            {metadata.length > 0 && (
              <div className="grid gap-1 rounded-md bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                {metadata.map(([label, value]) => (
                  <div key={`${label}-${value}`} className="min-w-0">
                    <span className="mr-1 text-muted-foreground/60">{label}:</span>
                    <span className="break-all text-foreground/75">{value}</span>
                  </div>
                ))}
              </div>
            )}
            {progress && (
              <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground">{progress.current_step}</p>
                <p className="mt-1 whitespace-pre-wrap">{progress.evidence}</p>
                <p className="mt-1 text-primary/80">{progress.recommended_action}</p>
              </div>
            )}
            {steps.length > 0 && (
              <div className="space-y-1">
                {steps.map((step, index) => (
                  <div key={`${step.key ?? step.label ?? index}-${index}`} className="flex gap-2 rounded-md bg-muted/30 px-2 py-1 text-[11px]">
                    <span className="shrink-0 text-muted-foreground">{step.status ?? "step"}</span>
                    <span className="min-w-0 flex-1 text-foreground/80">{step.label ?? step.message ?? step.key ?? "進捗"}</span>
                  </div>
                ))}
              </div>
            )}
            {message && <DetailBlock label="result" value={message} />}
            {liveLog && <DetailBlock label="live log" value={liveLog} />}
            {(task.remote_session_url || task.codex_thread_id) && (
              <div className="space-y-1 text-[11px] text-muted-foreground">
                {task.remote_session_url && (
                  <a className="block truncate text-primary hover:underline" href={task.remote_session_url} target="_blank" rel="noreferrer">
                    {task.remote_session_url}
                  </a>
                )}
                {task.codex_thread_id && <p className="truncate">thread: {task.codex_thread_id}</p>}
              </div>
            )}
            {task.executor === "codex" && task.codex_thread_id && task.status !== "running" && task.status !== "pending" && (
              <CodexFollowUpForm task={task} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function AiExecutionTimeline({
  selectedDate,
  compact = false,
  showDateControls = false,
  onDateChange,
  selectedSpaceId = null,
  spaces = [],
}: AiExecutionTimelineProps) {
  const { tasks: aiTasks, isLoading: aiLoading, error: aiError, refresh: refreshAiTasks } = useAiTasks({ limit: 200, spaceId: selectedSpaceId })
  const { tasks: scheduledTasks, isLoading: scheduledLoading, error: scheduledError, refresh: refreshScheduled } = useScheduledTasks(selectedSpaceId)
  const [rangeTasks, setRangeTasks] = useState<AiTask[]>([])
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeError, setRangeError] = useState<string | null>(null)

  const refreshRangeTasks = useCallback(async () => {
      const from = startOfDay(selectedDate).toISOString()
      const to = endOfDay(selectedDate).toISOString()
    setRangeLoading(true)
    setRangeError(null)
    try {
      const params = new URLSearchParams({ from, to, limit: "500" })
      if (selectedSpaceId) params.set("space_id", selectedSpaceId)
      const res = await fetch(`/api/ai-tasks?${params.toString()}`)
      if (!res.ok) throw new Error("AI実行履歴を取得できませんでした")
      const data = await res.json() as AiTask[]
      setRangeTasks(data)
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : "AI実行履歴を取得できませんでした")
    } finally {
      setRangeLoading(false)
    }
  }, [selectedDate, selectedSpaceId])

  useEffect(() => {
    void refreshRangeTasks()
  }, [refreshRangeTasks])

  const visibleTasks = useMemo(() => {
    const byId = new Map<string, AiTask>()
    for (const task of [...rangeTasks, ...aiTasks, ...scheduledTasks]) {
      if (isVisibleOnDate(task, selectedDate)) byId.set(task.id, task)
    }
    return [...byId.values()].sort((a, b) => sortTime(a, selectedDate) - sortTime(b, selectedDate))
  }, [aiTasks, rangeTasks, scheduledTasks, selectedDate])
  const spaceNameById = useMemo(() => new Map(spaces.map(space => [space.id, space.title])), [spaces])

  const isLoading = aiLoading || scheduledLoading || rangeLoading
  const error = aiError?.message ?? scheduledError ?? rangeError ?? null

  const runningCount = visibleTasks.filter(task => task.status === "running").length
  const reviewCount = visibleTasks.filter(task => task.status === "awaiting_approval" || task.status === "needs_input").length

  const shiftDate = (days: number) => {
    if (!onDateChange) return
    const next = new Date(selectedDate)
    next.setDate(next.getDate() + days)
    next.setHours(0, 0, 0, 0)
    onDateChange(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className={cn("shrink-0 border-b border-border/30 bg-background/70", compact ? "px-3 py-2" : "px-4 py-3")}>
        <div className="flex items-center justify-between gap-2">
          {showDateControls && (
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="前の日"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Bot className="h-4 w-4 text-primary" />
              AI実行タイムライン
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {format(selectedDate, "M月d日(E)", { locale: ja })} · {visibleTasks.length}件
              {runningCount > 0 && ` · 実行中${runningCount}`}
              {reviewCount > 0 && ` · 確認待ち${reviewCount}`}
            </p>
          </div>
          {showDateControls && (
            <button
              type="button"
              onClick={() => shiftDate(1)}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="次の日"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              refreshAiTasks()
              refreshScheduled()
              void refreshRangeTasks()
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="AI実行タイムラインを更新"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className={cn("flex-1 overflow-y-auto", compact ? "px-3 py-3" : "px-4 py-4")}>
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {isLoading && visibleTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            読み込み中...
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            この日のAI実行予定・履歴はありません
          </div>
        ) : (
          <div className="relative space-y-3 before:absolute before:left-[4px] before:top-4 before:h-[calc(100%-2rem)] before:w-px before:bg-border/60">
            {visibleTasks.map(task => (
              <AiExecutionCard key={task.id} task={task} spaceName={task.space_id ? spaceNameById.get(task.space_id) ?? null : null} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
