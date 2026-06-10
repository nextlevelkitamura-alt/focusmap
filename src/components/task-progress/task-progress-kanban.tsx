"use client"

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SpaceProjectSwitcher } from "@/components/dashboard/space-project-switcher"
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
import type { Project, Space, Task } from "@/types/database"
import type { TaskProgressSnapshotTask } from "@/types/task-progress"

const HEARTBEAT_ONLINE_WINDOW_MS = 90_000
const HEARTBEAT_POLL_INTERVAL_MS = 30_000
const HEARTBEAT_IMMEDIATE_REFRESH_DEDUPE_MS = 750
const MOBILE_LANE_SWIPE_MIN_DISTANCE = 48
const MOBILE_LANE_SWIPE_MAX_OFF_AXIS = 72
const DESKTOP_BOARD_HEIGHT_STORAGE_KEY = "focusmap:codex-kanban:desktop-height"
const DESKTOP_BOARD_DEFAULT_HEIGHT_PX = 260
const DESKTOP_BOARD_MIN_HEIGHT_PX = 180
const DESKTOP_BOARD_VIEWPORT_PADDING_PX = 160

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible"
}

type SourceTaskInfo = Pick<Task, "id" | "status" | "title" | "deleted_at"> & {
  updated_at?: string | null
}

type RunnerHeartbeat = {
  status?: string | null
  last_seen_at?: string | null
  updated_at?: string | null
  current_task_id?: string | null
  metadata_json?: Record<string, unknown> | null
}

type RunnerConnectionState = {
  loading: boolean
  online: boolean
  lastSeenAt: string | null
  activeTaskSeenAtById: ReadonlyMap<string, string>
}

type CodexKanbanLaneId = "unsent" | "running" | "review" | "connection_failed" | "done"

type TaskProgressKanbanProps = {
  tasks: TaskProgressSnapshotTask[]
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  spaces?: Space[]
  projects?: Project[]
  selectedSpaceId?: string | null
  selectedProjectId?: string | null
  onSelectSpace?: (id: string | null) => void
  onSelectProject?: (id: string | null) => void
  includeUnsentSourceTasks?: boolean
  closeSignal?: number
  isMobile?: boolean
  isLoading?: boolean
  isRefreshing?: boolean
  error?: string | null
  pollIntervalMs: number
  onRefresh: () => void | Promise<void>
  onOpenTask: (task: TaskProgressSnapshotTask) => void
  onRunSourceTask?: (taskId: string) => void
  onToggleSourceTaskComplete?: (taskId: string, done: boolean) => void | Promise<void>
  onDeleteSourceTask?: (taskId: string) => void | Promise<void>
}

const LANES: Array<{
  id: CodexKanbanLaneId
  label: string
  description: string
  icon: typeof Loader2
  className: string
}> = [
  {
    id: "unsent",
    label: "未送信",
    description: "Codex.appで開始待ち",
    icon: Clock,
    className: "border-sky-400/50 bg-sky-500/10",
  },
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
    description: "人間が確認",
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
    label: "完了済み",
    description: "チェック済み当日",
    icon: CheckCircle2,
    className: "border-emerald-400/50 bg-emerald-500/10",
  },
]

const LANE_IDS = LANES.map(lane => lane.id)

function clampDesktopBoardHeight(heightPx: number) {
  const minHeight = DESKTOP_BOARD_MIN_HEIGHT_PX
  if (typeof window === "undefined") return Math.max(minHeight, heightPx)
  const maxHeight = Math.max(minHeight, window.innerHeight - DESKTOP_BOARD_VIEWPORT_PADDING_PX)
  return Math.min(Math.max(heightPx, minHeight), maxHeight)
}

function readStoredDesktopBoardHeight() {
  if (typeof window === "undefined") return DESKTOP_BOARD_DEFAULT_HEIGHT_PX
  const stored = Number(window.localStorage.getItem(DESKTOP_BOARD_HEIGHT_STORAGE_KEY))
  return clampDesktopBoardHeight(Number.isFinite(stored) && stored > 0 ? stored : DESKTOP_BOARD_DEFAULT_HEIGHT_PX)
}

function useRunnerConnection(): RunnerConnectionState & { refresh: () => Promise<void> } {
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const lastRefreshRequestedAtRef = useRef(0)
  const [state, setState] = useState<RunnerConnectionState>({
    loading: true,
    online: false,
    lastSeenAt: null,
    activeTaskSeenAtById: new Map(),
  })

  const refresh = useCallback(async () => {
    if (!isPageVisible()) return
    if (refreshInFlightRef.current) return refreshInFlightRef.current
    const refreshStartedAt = Date.now()
    if (refreshStartedAt - lastRefreshRequestedAtRef.current < HEARTBEAT_IMMEDIATE_REFRESH_DEDUPE_MS) return
    lastRefreshRequestedAtRef.current = refreshStartedAt
    setState(previous => previous.loading ? previous : { ...previous, loading: true })

    const refreshPromise = (async () => {
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
        const activeTaskSeenAtById = new Map<string, string>()
        for (const heartbeat of heartbeats) {
          const seenAt = heartbeat.last_seen_at || heartbeat.updated_at || null
          const taskId = heartbeat.current_task_id?.trim()
          const seenMs = seenAt ? Date.parse(seenAt) : Number.NaN
          if (!taskId || !seenAt || !Number.isFinite(seenMs)) continue
          if (Date.now() - seenMs >= HEARTBEAT_ONLINE_WINDOW_MS) continue
          activeTaskSeenAtById.set(taskId, seenAt)
        }

        setState({
          loading: false,
          online,
          lastSeenAt: latest?.seenAt ?? null,
          activeTaskSeenAtById,
        })
      } catch {
        setState(previous => ({ ...previous, loading: false }))
      } finally {
        refreshInFlightRef.current = null
      }
    })()

    refreshInFlightRef.current = refreshPromise
    return refreshPromise
  }, [])

  useEffect(() => {
    void refresh()
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) void refresh()
    }, HEARTBEAT_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [refresh])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isPageVisible()) void refresh()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [refresh])

  useEffect(() => {
    const handleImmediateForeground = () => {
      if (isPageVisible()) void refresh()
    }
    window.addEventListener("focus", handleImmediateForeground)
    window.addEventListener("pageshow", handleImmediateForeground)
    window.addEventListener("focusmap:native-app-resume", handleImmediateForeground)
    return () => {
      window.removeEventListener("focus", handleImmediateForeground)
      window.removeEventListener("pageshow", handleImmediateForeground)
      window.removeEventListener("focusmap:native-app-resume", handleImmediateForeground)
    }
  }, [refresh])

  return { ...state, refresh }
}

function sourceTaskForProgressTask(task: TaskProgressSnapshotTask, sourceTasksById: ReadonlyMap<string, SourceTaskInfo>) {
  if (task.source_type === "mindmap" && task.source_id) {
    return sourceTasksById.get(task.source_id) ?? null
  }
  return null
}

function isProgressTaskVisibleInCurrentMap(
  task: TaskProgressSnapshotTask,
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>,
) {
  if (task.source_type !== "mindmap") return false
  const sourceId = task.source_id?.trim()
  if (!sourceId) return false
  const sourceTask = sourceTasksById.get(sourceId)
  return !!sourceTask && !sourceTask.deleted_at
}

function laneForTask(task: TaskProgressSnapshotTask, sourceTasksById: ReadonlyMap<string, SourceTaskInfo>): CodexKanbanLaneId | null {
  if (!isProgressTaskVisibleInCurrentMap(task, sourceTasksById)) return null
  const sourceTask = sourceTaskForProgressTask(task, sourceTasksById)
  if (sourceTask?.status === "done") {
    return isSameLocalDate(task.updated_at) ? "done" : null
  }

  const uiStatus = getCodexMonitorUiStatus(task.status)
  if (uiStatus === "unsent") return "unsent"
  if (uiStatus === "running") return "running"
  if (uiStatus === "connection_failed") return "connection_failed"
  if (uiStatus === "done") return "done"
  return "review"
}

function unsentProgressTaskForSourceTask(sourceTask: SourceTaskInfo): TaskProgressSnapshotTask {
  return {
    id: `source:${sourceTask.id}`,
    title: sourceTask.title,
    status: "pending",
    executor: "codex_app",
    codex_thread_id: null,
    current_step: "Codex.appで開始待ち",
    progress_percent: null,
    summary: "このマップノードからCodexを実行できます",
    updated_at: sourceTask.updated_at || new Date(0).toISOString(),
    source_type: "mindmap",
    source_id: sourceTask.id,
  }
}

function isSourceOnlyProgressTask(task: TaskProgressSnapshotTask) {
  return task.id.startsWith("source:")
}

function withUnsentSourceTasks(
  tasks: TaskProgressSnapshotTask[],
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>,
) {
  const coveredSourceIds = new Set<string>()
  const result = [...tasks]
  for (const task of tasks) {
    if (task.source_type !== "mindmap" || !task.source_id) continue
    coveredSourceIds.add(task.source_id)
  }
  for (const sourceTask of sourceTasksById.values()) {
    if (!sourceTask?.id || sourceTask.deleted_at || coveredSourceIds.has(sourceTask.id)) continue
    result.push(unsentProgressTaskForSourceTask(sourceTask))
  }
  return result
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

function RunnerCompactStatus({ state }: { state: RunnerConnectionState }) {
  if (state.loading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-muted bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        確認中
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
        state.online
          ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
      title={state.lastSeenAt ? `最終heartbeat: ${formatTaskProgressDateTime(state.lastSeenAt)}` : "heartbeat未取得"}
    >
      {state.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {state.online ? "online" : "offline"}
    </span>
  )
}

function KanbanCard({
  task,
  sourceTask,
  runnerState,
  isMobile,
  nowMs,
  forceDone = false,
  onOpen,
  onRunSourceTask,
  onToggleComplete,
  onDelete,
}: {
  task: TaskProgressSnapshotTask
  sourceTask: SourceTaskInfo | null
  runnerState: RunnerConnectionState
  isMobile: boolean
  nowMs: number
  forceDone?: boolean
  onOpen: (task: TaskProgressSnapshotTask) => void
  onRunSourceTask?: (taskId: string) => void
  onToggleComplete?: (taskId: string, done: boolean) => void | Promise<void>
  onDelete?: (taskId: string) => void | Promise<void>
}) {
  const statusLabel = forceDone ? "完了済み" : codexMonitorUiLabel(task.status)
  const uiStatus = forceDone ? "done" : getCodexMonitorUiStatus(task.status)
  const toneClass = forceDone
    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
    : codexMonitorToneClass(task.status)
  const primary = uiStatus === "unsent" ? "" : compactCodexMonitorText(task.current_step, isMobile ? 42 : 74)
  const secondary = uiStatus === "unsent" ? "" : compactCodexMonitorText(task.summary, isMobile ? 56 : 96)
  const updatedAt = formatTaskProgressDateTime(task.updated_at)
  const taskPulseSeenAt = runnerState.activeTaskSeenAtById.get(task.id) ?? null
  const taskPulseMs = taskPulseSeenAt ? Date.parse(taskPulseSeenAt) : Number.NaN
  const updatedMs = Date.parse(task.updated_at)
  const hasRecentTaskPulse = nowMs > 0 && Number.isFinite(taskPulseMs) && nowMs - taskPulseMs < HEARTBEAT_ONLINE_WINDOW_MS
  const hasFreshTaskUpdate = nowMs > 0 && Number.isFinite(updatedMs) && nowMs - updatedMs < HEARTBEAT_ONLINE_WINDOW_MS
  const pulseLabel = uiStatus === "running"
    ? hasRecentTaskPulse && hasFreshTaskUpdate
      ? "3秒更新"
      : hasRecentTaskPulse
        ? "Codex停止疑い"
        : runnerState.online
          ? "pulse待ち"
          : "Mac offline"
    : null
  const sourceTaskId = sourceTask?.id ?? null
  const sourceTaskDone = sourceTask?.status === "done"
  const shortTitle = task.title || "Codexタスク"
  const openPrimary = () => {
    if (sourceTaskId && isSourceOnlyProgressTask(task) && onRunSourceTask) {
      onRunSourceTask(sourceTaskId)
      return
    }
    onOpen(task)
  }

  return (
    <article
      className="group w-full rounded-lg border bg-background px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/30"
      title={task.title ?? "Codexタスク"}
    >
      <div className="flex min-w-0 items-start gap-2">
        {sourceTaskId && onToggleComplete && (
          <label
            className="flex min-h-11 w-7 shrink-0 cursor-pointer items-start justify-center pt-1.5"
            title={sourceTaskDone ? "完了を外す" : "完了にする"}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-emerald-500"
              checked={sourceTaskDone}
              aria-label={`「${shortTitle}」を${sourceTaskDone ? "未完了に戻す" : "完了にする"}`}
              onChange={(event) => {
                void onToggleComplete(sourceTaskId, event.currentTarget.checked)
              }}
            />
          </label>
        )}
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 rounded-md text-left focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`「${shortTitle}」の${isSourceOnlyProgressTask(task) ? "Codex実行を開く" : "詳細を開く"}`}
          onClick={openPrimary}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold leading-5">
                {shortTitle}
              </div>
              {primary && (
                <div className="mt-0.5 text-[11px] leading-4 text-foreground/80">
                  {primary}
                </div>
              )}
            </div>
            <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", toneClass)}>
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
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                  hasRecentTaskPulse && hasFreshTaskUpdate
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                    : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                )}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                {pulseLabel}
              </span>
            )}
          </div>
        </button>
        {sourceTaskId && onRunSourceTask && (
          <button
            type="button"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-ring dark:hover:text-emerald-200"
            aria-label={`「${shortTitle}」をCodexで実行`}
            title="Codexで実行"
            onClick={() => onRunSourceTask(sourceTaskId)}
          >
            <Bot className="h-4 w-4" />
          </button>
        )}
        {sourceTaskId && onDelete && (
          <button
            type="button"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-ring dark:hover:text-red-300"
            aria-label={`「${shortTitle}」を削除`}
            title="ノードから削除"
            onClick={() => {
              void onDelete(sourceTaskId)
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  )
}

function EmptyLane({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed bg-muted/10 px-3 text-center text-xs text-muted-foreground">
      {label}はありません
    </div>
  )
}

function KanbanLaneSection({
  lane,
  tasks,
  sourceTasksById,
  runnerState,
  isMobile,
  nowMs,
  onOpenTask,
  onRunSourceTask,
  onToggleSourceTaskComplete,
  onDeleteSourceTask,
}: {
  lane: (typeof LANES)[number]
  tasks: TaskProgressSnapshotTask[]
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  runnerState: RunnerConnectionState
  isMobile: boolean
  nowMs: number
  onOpenTask: (task: TaskProgressSnapshotTask) => void
  onRunSourceTask?: (taskId: string) => void
  onToggleSourceTaskComplete?: (taskId: string, done: boolean) => void | Promise<void>
  onDeleteSourceTask?: (taskId: string) => void | Promise<void>
}) {
  const Icon = lane.icon

  return (
    <section className={cn("min-w-0 rounded-lg border p-2", lane.className)}>
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
          ? tasks.slice(0, isMobile ? 24 : 12).map(task => (
            <KanbanCard
              key={task.id}
              task={task}
              sourceTask={sourceTaskForProgressTask(task, sourceTasksById)}
              runnerState={runnerState}
              isMobile={isMobile}
              nowMs={nowMs}
              forceDone={lane.id === "done"}
              onOpen={onOpenTask}
              onRunSourceTask={onRunSourceTask}
              onToggleComplete={onToggleSourceTaskComplete}
              onDelete={onDeleteSourceTask}
            />
          ))
          : <EmptyLane label={lane.label} />}
      </div>
    </section>
  )
}

function KanbanLanes({
  lanes,
  sourceTasksById,
  runnerState,
  isMobile,
  nowMs,
  onOpenTask,
  onRunSourceTask,
  onToggleSourceTaskComplete,
  onDeleteSourceTask,
}: {
  lanes: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]>
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  runnerState: RunnerConnectionState
  isMobile: boolean
  nowMs: number
  onOpenTask: (task: TaskProgressSnapshotTask) => void
  onRunSourceTask?: (taskId: string) => void
  onToggleSourceTaskComplete?: (taskId: string, done: boolean) => void | Promise<void>
  onDeleteSourceTask?: (taskId: string) => void | Promise<void>
}) {
  return (
    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-5")}>
      {LANES.map(lane => {
        const tasks = lanes[lane.id]
        return (
          <KanbanLaneSection
            key={lane.id}
            lane={lane}
            tasks={tasks}
            sourceTasksById={sourceTasksById}
            runnerState={runnerState}
            isMobile={isMobile}
            nowMs={nowMs}
            onOpenTask={onOpenTask}
            onRunSourceTask={onRunSourceTask}
            onToggleSourceTaskComplete={onToggleSourceTaskComplete}
            onDeleteSourceTask={onDeleteSourceTask}
          />
        )
      })}
    </div>
  )
}

function MobileKanbanLanePager({
  lanes,
  activeLaneId,
  sourceTasksById,
  runnerState,
  nowMs,
  onOpenTask,
  onRunSourceTask,
  onToggleSourceTaskComplete,
  onDeleteSourceTask,
}: {
  lanes: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]>
  activeLaneId: CodexKanbanLaneId
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  runnerState: RunnerConnectionState
  nowMs: number
  onOpenTask: (task: TaskProgressSnapshotTask) => void
  onRunSourceTask?: (taskId: string) => void
  onToggleSourceTaskComplete?: (taskId: string, done: boolean) => void | Promise<void>
  onDeleteSourceTask?: (taskId: string) => void | Promise<void>
}) {
  const lane = LANES.find(candidate => candidate.id === activeLaneId) ?? LANES[0]
  const tasks = lanes[lane.id]

  return (
    <div
      role="tabpanel"
      id={`codex-kanban-lane-panel-${lane.id}`}
      aria-labelledby={`codex-kanban-lane-tab-${lane.id}`}
    >
      <KanbanLaneSection
        lane={lane}
        tasks={tasks}
        sourceTasksById={sourceTasksById}
        runnerState={runnerState}
        isMobile
        nowMs={nowMs}
        onOpenTask={onOpenTask}
        onRunSourceTask={onRunSourceTask}
        onToggleSourceTaskComplete={onToggleSourceTaskComplete}
        onDeleteSourceTask={onDeleteSourceTask}
      />
    </div>
  )
}

function adjacentLaneId(current: CodexKanbanLaneId, direction: 1 | -1) {
  const currentIndex = LANE_IDS.indexOf(current)
  if (currentIndex < 0) return current
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), LANE_IDS.length - 1)
  return LANE_IDS[nextIndex] ?? current
}

function KanbanScopeSwitcher({
  spaces,
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectSpace,
  onSelectProject,
  compact = false,
}: {
  spaces?: Space[]
  projects?: Project[]
  selectedSpaceId?: string | null
  selectedProjectId?: string | null
  onSelectSpace?: (id: string | null) => void
  onSelectProject?: (id: string | null) => void
  compact?: boolean
}) {
  if (!spaces || !projects || !onSelectSpace || !onSelectProject) return null
  if (projects.length === 0) return null

  return (
    <div className={cn("min-w-0", compact ? "w-full" : "shrink-0")}>
      <SpaceProjectSwitcher
        spaces={spaces}
        projects={projects}
        selectedSpaceId={selectedSpaceId ?? null}
        selectedProjectId={selectedProjectId ?? null}
        onSelectSpace={onSelectSpace}
        onSelectProject={onSelectProject}
        showAllSpacesOption
        showAllProjectsOption={false}
        allowMutations={false}
        variant={compact ? "memoHeaderCompact" : "default"}
        className={cn(
          compact && "max-w-full justify-start px-0",
          !compact && "px-0",
        )}
      />
    </div>
  )
}

export function TaskProgressKanban({
  tasks,
  sourceTasksById,
  spaces,
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectSpace,
  onSelectProject,
  includeUnsentSourceTasks = false,
  closeSignal = 0,
  isMobile = false,
  isLoading = false,
  isRefreshing = false,
  error,
  onRefresh,
  onOpenTask,
  onRunSourceTask,
  onToggleSourceTaskComplete,
  onDeleteSourceTask,
}: TaskProgressKanbanProps) {
  const [desktopExpansion, setDesktopExpansion] = useState(() => ({ closeSignal, expanded: false }))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeMobileLaneId, setActiveMobileLaneId] = useState<CodexKanbanLaneId>("review")
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [desktopBodyHeightPx, setDesktopBodyHeightPx] = useState(readStoredDesktopBoardHeight)
  const [sourceTaskStatusOverrides, setSourceTaskStatusOverrides] = useState<Map<string, string>>(new Map())
  const [hiddenSourceTaskIds, setHiddenSourceTaskIds] = useState<Set<string>>(new Set())
  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const desktopResizeCleanupRef = useRef<(() => void) | null>(null)
  const runnerState = useRunnerConnection()

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), HEARTBEAT_POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(DESKTOP_BOARD_HEIGHT_STORAGE_KEY, String(Math.round(desktopBodyHeightPx)))
  }, [desktopBodyHeightPx])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleResize = () => {
      setDesktopBodyHeightPx(previous => clampDesktopBoardHeight(previous))
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    return () => {
      desktopResizeCleanupRef.current?.()
      desktopResizeCleanupRef.current = null
    }
  }, [])

  const expanded = desktopExpansion.closeSignal === closeSignal ? desktopExpansion.expanded : false
  const setDesktopExpanded = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setDesktopExpansion(previous => {
      const current = previous.closeSignal === closeSignal ? previous.expanded : false
      return {
        closeSignal,
        expanded: typeof next === "function" ? next(current) : next,
      }
    })
  }, [closeSignal])

  const effectiveSourceTasksById = useMemo(() => {
    if (sourceTaskStatusOverrides.size === 0 && hiddenSourceTaskIds.size === 0) return sourceTasksById
    const next = new Map(sourceTasksById)
    for (const [taskId, status] of sourceTaskStatusOverrides.entries()) {
      const sourceTask = next.get(taskId)
      if (!sourceTask) continue
      next.set(taskId, { ...sourceTask, status })
    }
    for (const taskId of hiddenSourceTaskIds) {
      next.delete(taskId)
    }
    return next
  }, [hiddenSourceTaskIds, sourceTaskStatusOverrides, sourceTasksById])

  const displayTasks = useMemo(() => (
    includeUnsentSourceTasks
      ? withUnsentSourceTasks(tasks, effectiveSourceTasksById)
      : tasks
  ), [effectiveSourceTasksById, includeUnsentSourceTasks, tasks])

  const lanes = useMemo(() => {
    const grouped: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]> = {
      unsent: [],
      running: [],
      review: [],
      connection_failed: [],
      done: [],
    }
    for (const task of displayTasks) {
      const laneId = laneForTask(task, effectiveSourceTasksById)
      if (!laneId) continue
      grouped[laneId].push(task)
    }
    for (const laneTasks of Object.values(grouped)) {
      laneTasks.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    }
    return grouped
  }, [displayTasks, effectiveSourceTasksById])

  const counts = useMemo(() => {
    return LANES.reduce<Record<CodexKanbanLaneId, number>>((acc, lane) => {
      acc[lane.id] = lanes[lane.id].length
      return acc
    }, { unsent: 0, running: 0, review: 0, connection_failed: 0, done: 0 })
  }, [lanes])
  const total = counts.unsent + counts.running + counts.review + counts.connection_failed + counts.done

  const refreshAll = useCallback(async () => {
    await Promise.all([
      Promise.resolve(onRefresh()),
      runnerState.refresh(),
    ])
  }, [onRefresh, runnerState])

  const handleToggleSourceTaskComplete = useCallback(async (taskId: string, done: boolean) => {
    if (!onToggleSourceTaskComplete) return
    setSourceTaskStatusOverrides(previous => {
      const next = new Map(previous)
      next.set(taskId, done ? "done" : "todo")
      return next
    })
    try {
      await onToggleSourceTaskComplete(taskId, done)
    } catch (error) {
      setSourceTaskStatusOverrides(previous => {
        const next = new Map(previous)
        next.delete(taskId)
        return next
      })
      console.error("[TaskProgressKanban] Failed to toggle source task completion:", error)
    }
  }, [onToggleSourceTaskComplete])

  const handleDeleteSourceTask = useCallback(async (taskId: string) => {
    if (!onDeleteSourceTask) return
    setHiddenSourceTaskIds(previous => {
      const next = new Set(previous)
      next.add(taskId)
      return next
    })
    try {
      await onDeleteSourceTask(taskId)
    } catch (error) {
      setHiddenSourceTaskIds(previous => {
        const next = new Set(previous)
        next.delete(taskId)
        return next
      })
      console.error("[TaskProgressKanban] Failed to delete source task:", error)
    }
  }, [onDeleteSourceTask])

  const openMobileKanban = useCallback(() => {
    setActiveMobileLaneId(current => {
      if (counts[current] > 0) return current
      return LANES.find(lane => counts[lane.id] > 0)?.id ?? current
    })
    setMobileOpen(true)
  }, [counts])

  const handleMobileLanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return
    event.currentTarget.setPointerCapture(event.pointerId)
    mobileSwipeStartRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const handleMobileLanePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = mobileSwipeStartRef.current
    mobileSwipeStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!start || event.pointerType === "mouse") return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < MOBILE_LANE_SWIPE_MIN_DISTANCE) return
    if (Math.abs(deltaY) > MOBILE_LANE_SWIPE_MAX_OFF_AXIS) return
    if (Math.abs(deltaY) > Math.abs(deltaX)) return

    setActiveMobileLaneId(current => adjacentLaneId(current, deltaX < 0 ? 1 : -1))
  }, [])

  const handleMobileLanePointerCancel = useCallback(() => {
    mobileSwipeStartRef.current = null
  }, [])

  const handleDesktopResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isMobile || typeof window === "undefined") return
    event.preventDefault()
    setDesktopExpanded(true)
    desktopResizeCleanupRef.current?.()

    const startY = event.clientY
    const startHeight = desktopBodyHeightPx
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight + startY - moveEvent.clientY
      setDesktopBodyHeightPx(clampDesktopBoardHeight(nextHeight))
    }
    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", cleanup)
      window.removeEventListener("pointercancel", cleanup)
      desktopResizeCleanupRef.current = null
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", cleanup)
    window.addEventListener("pointercancel", cleanup)
    desktopResizeCleanupRef.current = cleanup
  }, [desktopBodyHeightPx, isMobile, setDesktopExpanded])

  const handleDesktopResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    setDesktopExpanded(true)
    setDesktopBodyHeightPx(previous => {
      if (event.key === "Home") return DESKTOP_BOARD_MIN_HEIGHT_PX
      if (event.key === "End" && typeof window !== "undefined") {
        return clampDesktopBoardHeight(window.innerHeight - DESKTOP_BOARD_VIEWPORT_PADDING_PX)
      }
      return clampDesktopBoardHeight(previous + (event.key === "ArrowUp" ? 36 : -36))
    })
  }, [setDesktopExpanded])

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+76px)] right-3 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border bg-background/95 px-3 text-xs font-semibold shadow-lg backdrop-blur"
          onClick={openMobileKanban}
          aria-label={`Codex看板を開く。Mac状態は${runnerState.loading ? "確認中" : runnerState.online ? "オンライン" : "オフライン"}です`}
        >
          <Bot className="h-4 w-4 text-emerald-600" />
          Codex
          <RunnerCompactStatus state={runnerState} />
          {total > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{total}</span>}
        </button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="bottom" className="flex max-h-[86dvh] flex-col rounded-t-2xl p-0">
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
              </div>
              <div className="pt-2">
                <KanbanScopeSwitcher
                  spaces={spaces}
                  projects={projects}
                  selectedSpaceId={selectedSpaceId}
                  selectedProjectId={selectedProjectId}
                  onSelectSpace={onSelectSpace}
                  onSelectProject={onSelectProject}
                  compact
                />
              </div>
              <div className="-mx-1 overflow-x-auto pt-2">
                <div className="flex w-max gap-1.5 px-1" role="tablist" aria-label="Codexステータス">
                  {LANES.map(lane => {
                    const Icon = lane.icon
                    const active = lane.id === activeMobileLaneId
                    return (
                      <button
                        key={lane.id}
                        id={`codex-kanban-lane-tab-${lane.id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`codex-kanban-lane-panel-${lane.id}`}
                        aria-label={`${lane.label} ${counts[lane.id]}件`}
                        className={cn(
                          "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
                          active
                            ? cn("bg-background text-foreground shadow-sm", lane.className)
                            : "border-border bg-muted/40 text-muted-foreground",
                        )}
                        onClick={() => setActiveMobileLaneId(lane.id)}
                      >
                        <Icon className={cn("h-3.5 w-3.5", lane.id === "running" && counts[lane.id] > 0 && "animate-spin")} />
                        <span>{lane.label}</span>
                        <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {counts[lane.id]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </SheetHeader>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
              onPointerDown={handleMobileLanePointerDown}
              onPointerUp={handleMobileLanePointerEnd}
              onPointerCancel={handleMobileLanePointerCancel}
            >
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
                <MobileKanbanLanePager
                  lanes={lanes}
                  activeLaneId={activeMobileLaneId}
                  sourceTasksById={effectiveSourceTasksById}
                  runnerState={runnerState}
                  nowMs={nowMs}
                  onOpenTask={onOpenTask}
                  onRunSourceTask={onRunSourceTask}
                  onToggleSourceTaskComplete={handleToggleSourceTaskComplete}
                  onDeleteSourceTask={handleDeleteSourceTask}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <section className="relative shrink-0 border-t bg-background/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Codex看板の高さを変更"
        aria-valuemin={DESKTOP_BOARD_MIN_HEIGHT_PX}
        aria-valuenow={Math.round(desktopBodyHeightPx)}
        tabIndex={0}
        className="absolute -top-1 left-0 right-0 z-10 flex h-3 cursor-ns-resize items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring"
        onPointerDown={handleDesktopResizePointerDown}
        onKeyDown={handleDesktopResizeKeyDown}
      >
        <span className="h-1 w-14 rounded-full bg-border/80 transition-colors hover:bg-foreground/30" />
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => setDesktopExpanded(prev => !prev)}
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
              {error && <span className="text-red-600 dark:text-red-300">snapshot取得エラー</span>}
            </div>
          </div>
          {expanded ? <ChevronDown className="ml-auto h-4 w-4 shrink-0" /> : <ChevronUp className="ml-auto h-4 w-4 shrink-0" />}
        </button>
        {expanded && (
          <KanbanScopeSwitcher
            spaces={spaces}
            projects={projects}
            selectedSpaceId={selectedSpaceId}
            selectedProjectId={selectedProjectId}
            onSelectSpace={onSelectSpace}
            onSelectProject={onSelectProject}
          />
        )}
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
        <div
          className="overflow-y-auto border-t px-4 py-3"
          style={{ height: desktopBodyHeightPx }}
          data-testid="codex-kanban-desktop-body"
        >
          {isLoading && total === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
              最新状態を確認中...
            </div>
          ) : (
            <KanbanLanes
              lanes={lanes}
              sourceTasksById={effectiveSourceTasksById}
              runnerState={runnerState}
              isMobile={false}
              nowMs={nowMs}
              onOpenTask={onOpenTask}
              onRunSourceTask={onRunSourceTask}
              onToggleSourceTaskComplete={handleToggleSourceTaskComplete}
              onDeleteSourceTask={handleDeleteSourceTask}
            />
          )}
        </div>
      )}
    </section>
  )
}
