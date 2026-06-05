"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import {
  codexMonitorToneClass,
  codexMonitorUiLabel,
  compactCodexMonitorText,
  formatTaskProgressDateTime,
  getCodexMonitorUiStatus,
  isSameLocalDate,
} from "@/lib/task-progress-ui"
import { cn } from "@/lib/utils"
import type { Task } from "@/types/database"
import type { TaskProgressSnapshotTask } from "@/types/task-progress"

const HEARTBEAT_ONLINE_WINDOW_MS = 5 * 60 * 1000
const HEARTBEAT_POLL_INTERVAL_MS = 30_000

type SourceTaskInfo = Pick<Task, "id" | "status" | "title">

type RunnerHeartbeat = {
  status?: string | null
  last_seen_at?: string | null
  updated_at?: string | null
}

type RunnerConnectionState = {
  loading: boolean
  online: boolean
  lastSeenAt: string | null
}

type CodexKanbanLaneId = "running" | "review" | "connection_failed" | "done"

type TaskProgressKanbanProps = {
  tasks: TaskProgressSnapshotTask[]
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  isMobile?: boolean
  isLoading?: boolean
  isRefreshing?: boolean
  error?: string | null
  pollIntervalMs: number
  onRefresh: () => void | Promise<void>
  onOpenTask: (task: TaskProgressSnapshotTask) => void
}

const LANES: Array<{
  id: CodexKanbanLaneId
  label: string
  description: string
  icon: typeof Loader2
  className: string
}> = [
  {
    id: "running",
    label: "実行中",
    description: "Codexが作業中",
    icon: Loader2,
    className: "border-emerald-400/60 bg-emerald-500/10",
  },
  {
    id: "review",
    label: "確認待ち",
    description: "人間が見る",
    icon: Clock,
    className: "border-amber-400/60 bg-amber-500/10",
  },
  {
    id: "connection_failed",
    label: "接続失敗",
    description: "再接続が必要",
    icon: AlertTriangle,
    className: "border-red-400/60 bg-red-500/10",
  },
  {
    id: "done",
    label: "完了",
    description: "今日だけ残す",
    icon: CheckCircle2,
    className: "border-sky-400/50 bg-sky-500/10",
  },
]

function useRunnerConnection(): RunnerConnectionState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<RunnerConnectionState>({
    loading: true,
    online: false,
    lastSeenAt: null,
  })

  const refresh = useCallback(async () => {
    try {
      const response = await fetchWithSupabaseAuth("/api/task-progress/runner-heartbeats?limit=5", { cache: "no-store" })
      if (!response.ok) throw new Error(`heartbeat fetch failed (${response.status})`)
      const data = await response.json().catch(() => ({})) as { heartbeats?: RunnerHeartbeat[] }
      const heartbeats = Array.isArray(data.heartbeats) ? data.heartbeats : []
      const latest = heartbeats
        .map(heartbeat => ({
          ...heartbeat,
          seenAt: heartbeat.last_seen_at || heartbeat.updated_at || null,
        }))
        .filter((heartbeat): heartbeat is RunnerHeartbeat & { seenAt: string } => !!heartbeat.seenAt)
        .sort((a, b) => (Date.parse(b.seenAt) || 0) - (Date.parse(a.seenAt) || 0))[0] ?? null
      const lastSeenMs = latest ? Date.parse(latest.seenAt) : 0
      const online = !!latest &&
        Number.isFinite(lastSeenMs) &&
        lastSeenMs > 0 &&
        Date.now() - lastSeenMs < HEARTBEAT_ONLINE_WINDOW_MS &&
        latest.status !== "offline"

      setState({
        loading: false,
        online,
        lastSeenAt: latest?.seenAt ?? null,
      })
    } catch {
      setState(previous => ({ ...previous, loading: false }))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const intervalId = window.setInterval(() => void refresh(), HEARTBEAT_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [refresh])

  return { ...state, refresh }
}

function sourceTaskForProgressTask(task: TaskProgressSnapshotTask, sourceTasksById: ReadonlyMap<string, SourceTaskInfo>) {
  if (task.source_type === "mindmap" && task.source_id) {
    return sourceTasksById.get(task.source_id) ?? null
  }
  return null
}

function laneForTask(task: TaskProgressSnapshotTask, sourceTasksById: ReadonlyMap<string, SourceTaskInfo>): CodexKanbanLaneId | null {
  const sourceTask = sourceTaskForProgressTask(task, sourceTasksById)
  if (sourceTask?.status === "done") {
    return isSameLocalDate(task.updated_at) ? "done" : null
  }

  const uiStatus = getCodexMonitorUiStatus(task.status)
  if (uiStatus === "running") return "running"
  if (uiStatus === "connection_failed") return "connection_failed"
  return "review"
}

function relativePollLabel(pollIntervalMs: number, isDetailOpen: boolean) {
  const seconds = Math.round(pollIntervalMs / 1000)
  if (isDetailOpen || seconds <= 3) return "詳細を高頻度更新中"
  if (seconds <= 5) return "5秒ごとに更新"
  return `${seconds}秒ごとに更新`
}

function RunnerChip({ state }: { state: RunnerConnectionState }) {
  if (state.loading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Mac確認中
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        state.online
          ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
      title={state.lastSeenAt ? `最終heartbeat: ${formatTaskProgressDateTime(state.lastSeenAt)}` : "heartbeat未取得"}
    >
      {state.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {state.online ? "Mac online" : "Mac offline"}
    </span>
  )
}

function KanbanCard({
  task,
  runnerState,
  isMobile,
  onOpen,
}: {
  task: TaskProgressSnapshotTask
  runnerState: RunnerConnectionState
  isMobile: boolean
  onOpen: (task: TaskProgressSnapshotTask) => void
}) {
  const statusLabel = codexMonitorUiLabel(task.status)
  const primary = compactCodexMonitorText(task.current_step, isMobile ? 42 : 74)
  const secondary = compactCodexMonitorText(task.summary, isMobile ? 56 : 96)
  const updatedAt = formatTaskProgressDateTime(task.updated_at)
  const uiStatus = getCodexMonitorUiStatus(task.status)

  return (
    <button
      type="button"
      className="group min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => onOpen(task)}
      title={task.title ?? "Codexタスク"}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold leading-5">
            {task.title || "Codexタスク"}
          </div>
          {primary && (
            <div className="mt-0.5 text-[11px] leading-4 text-foreground/80">
              {primary}
            </div>
          )}
        </div>
        <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", codexMonitorToneClass(task.status))}>
          {statusLabel}
        </span>
      </div>
      {!isMobile && secondary && secondary !== primary && (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {secondary}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <RunnerChip state={runnerState} />
        {updatedAt && <span className="rounded-full bg-muted px-2 py-0.5">最終 {updatedAt}</span>}
        {uiStatus === "running" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-200">
            <Loader2 className="h-3 w-3 animate-spin" />
            更新中
          </span>
        )}
      </div>
    </button>
  )
}

function EmptyLane({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed bg-muted/10 px-3 text-center text-xs text-muted-foreground">
      {label}はありません
    </div>
  )
}

function KanbanLanes({
  lanes,
  runnerState,
  isMobile,
  onOpenTask,
}: {
  lanes: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]>
  runnerState: RunnerConnectionState
  isMobile: boolean
  onOpenTask: (task: TaskProgressSnapshotTask) => void
}) {
  return (
    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-4")}>
      {LANES.map(lane => {
        const Icon = lane.icon
        const tasks = lanes[lane.id]
        return (
          <section key={lane.id} className={cn("min-w-0 rounded-lg border p-2", lane.className)}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Icon className={cn("h-3.5 w-3.5", lane.id === "running" && tasks.length > 0 && "animate-spin")} />
                  <span>{lane.label}</span>
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {tasks.length}
                  </span>
                </div>
                {!isMobile && <p className="mt-0.5 text-[10px] text-muted-foreground">{lane.description}</p>}
              </div>
            </div>
            <div className="space-y-2">
              {tasks.length > 0
                ? tasks.slice(0, isMobile ? 8 : 12).map(task => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    runnerState={runnerState}
                    isMobile={isMobile}
                    onOpen={onOpenTask}
                  />
                ))
                : <EmptyLane label={lane.label} />}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function TaskProgressKanban({
  tasks,
  sourceTasksById,
  isMobile = false,
  isLoading = false,
  isRefreshing = false,
  error,
  pollIntervalMs,
  onRefresh,
  onOpenTask,
}: TaskProgressKanbanProps) {
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const runnerState = useRunnerConnection()

  const lanes = useMemo(() => {
    const grouped: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]> = {
      running: [],
      review: [],
      connection_failed: [],
      done: [],
    }
    for (const task of tasks) {
      const laneId = laneForTask(task, sourceTasksById)
      if (!laneId) continue
      grouped[laneId].push(task)
    }
    for (const laneTasks of Object.values(grouped)) {
      laneTasks.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    }
    return grouped
  }, [sourceTasksById, tasks])

  const counts = useMemo(() => {
    return LANES.reduce<Record<CodexKanbanLaneId, number>>((acc, lane) => {
      acc[lane.id] = lanes[lane.id].length
      return acc
    }, { running: 0, review: 0, connection_failed: 0, done: 0 })
  }, [lanes])
  const total = counts.running + counts.review + counts.connection_failed + counts.done
  const pollLabel = relativePollLabel(pollIntervalMs, pollIntervalMs <= 3_000)

  const refreshAll = useCallback(async () => {
    await Promise.all([
      Promise.resolve(onRefresh()),
      runnerState.refresh(),
    ])
  }, [onRefresh, runnerState])

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+76px)] right-3 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border bg-background/95 px-3 text-xs font-semibold shadow-lg backdrop-blur"
          onClick={() => setMobileOpen(true)}
          aria-label="Codex看板を開く"
        >
          <Bot className="h-4 w-4 text-emerald-600" />
          Codex
          {total > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{total}</span>}
        </button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="bottom" className="max-h-[86dvh] overflow-y-auto rounded-t-2xl p-0">
            <SheetHeader className="border-b px-4 py-3 text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SheetTitle className="text-base">Codex看板</SheetTitle>
                  <SheetDescription className="mt-1 text-xs">
                    確認が必要なCodex実行だけを見る
                  </SheetDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  onClick={() => void refreshAll()}
                  disabled={isRefreshing}
                  aria-label="Codex看板を更新"
                >
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-2">
                <RunnerChip state={runnerState} />
                <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{pollLabel}</span>
              </div>
            </SheetHeader>
            <div className="px-3 py-3">
              {error && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                  {error}
                </div>
              )}
              {isLoading && total === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
                  最新状態を確認中...
                </div>
              ) : (
                <KanbanLanes lanes={lanes} runnerState={runnerState} isMobile onOpenTask={onOpenTask} />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <section className="shrink-0 border-t bg-background/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
        >
          <Bot className="h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>Codex看板</span>
              {LANES.map(lane => (
                <span key={lane.id} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {lane.label} {counts[lane.id]}
                </span>
              ))}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <RunnerChip state={runnerState} />
              <span>{pollLabel}</span>
              {error && <span className="text-red-600 dark:text-red-300">snapshot取得エラー</span>}
            </div>
          </div>
          {expanded ? <ChevronDown className="ml-auto h-4 w-4 shrink-0" /> : <ChevronUp className="ml-auto h-4 w-4 shrink-0" />}
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => void refreshAll()}
          disabled={isRefreshing}
          aria-label="Codex看板を更新"
          title="更新"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>

      {expanded && (
        <div className="max-h-[34dvh] overflow-y-auto border-t px-4 py-3">
          {isLoading && total === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
              最新状態を確認中...
            </div>
          ) : (
            <KanbanLanes lanes={lanes} runnerState={runnerState} isMobile={false} onOpenTask={onOpenTask} />
          )}
        </div>
      )}
    </section>
  )
}
