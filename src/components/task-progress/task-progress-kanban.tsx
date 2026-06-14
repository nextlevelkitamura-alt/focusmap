"use client"

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowUp,
  ArrowLeft,
  Brain,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  FolderGit2,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  X,
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
import { Switch } from "@/components/ui/switch"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import {
  codexMonitorAccentClass,
  codexMonitorCardClass,
  codexMonitorToneClass,
  codexMonitorUiLabel,
  compactCodexMonitorText,
  codexThreadUrl,
  formatTaskProgressDateTime,
  getCodexMonitorUiStatus,
  isSameLocalDate,
} from "@/lib/task-progress-ui"
import { cn } from "@/lib/utils"
import type { AiTaskActivityMessage } from "@/types/ai-task"
import type { Project, Space, Task } from "@/types/database"
import type { TaskProgressSnapshotTask, TaskProgressStatus } from "@/types/task-progress"

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

type CodexKanbanLaneId = "running" | "review" | "connection_failed" | "done"
type MobileCodexSheetTab = "import" | "board"
type MobileImportHistoryFilterId = "all" | "review" | "running" | "done" | "connection_failed"

export type TaskProgressImportItem = {
  id: string
  aiTaskId?: string | null
  title: string
  snippet: string | null
  repoPath: string | null
  threadId?: string | null
  status?: TaskProgressStatus | string | null
  statusLabel: string | null
  updatedLabel: string
  updatedAtIso?: string | null
}

export type TaskProgressImportRepoOption = {
  id: string
  label: string
  path: string
  sourceLabel?: string | null
}

export type TaskProgressMobileImportRepoControl = {
  selectedRepoPath: string | null
  selectedRepoLabel?: string | null
  importEnabled: boolean
  importOwnerLabel?: string | null
  importPending?: boolean
  repoOptions: TaskProgressImportRepoOption[]
  repoOptionsLoading?: boolean
  repoError?: string | null
  onSelectRepoPath?: (repoPath: string | null) => void | Promise<void>
  onToggleImport?: () => void | Promise<void>
  onRefreshRepos?: () => void | Promise<void>
}

type MobileImportDetailState = {
  loading: boolean
  messages: AiTaskActivityMessage[]
  error: string | null
}

type TaskProgressKanbanProps = {
  tasks: TaskProgressSnapshotTask[]
  sourceTasksById: ReadonlyMap<string, SourceTaskInfo>
  spaces?: Space[]
  projects?: Project[]
  selectedSpaceId?: string | null
  selectedProjectId?: string | null
  onSelectSpace?: (id: string | null) => void
  onSelectProject?: (id: string | null) => void
  closeSignal?: number
  isMobile?: boolean
  mobileOpenSignal?: number
  mobileTriggerVisible?: boolean
  mobileImportItems?: TaskProgressImportItem[]
  mobileImportRepoControl?: TaskProgressMobileImportRepoControl | null
  isLoading?: boolean
  isRefreshing?: boolean
  error?: string | null
  pollIntervalMs: number
  onRefresh: () => void | Promise<void>
  onOpenTask: (task: TaskProgressSnapshotTask) => void
  onPlaceImportItem?: (taskId: string) => void
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

const MOBILE_IMPORT_HISTORY_FILTERS: Array<{
  id: MobileImportHistoryFilterId
  label: string
}> = [
  { id: "all", label: "すべて" },
  { id: "review", label: "確認待ち" },
  { id: "running", label: "実行中" },
  { id: "done", label: "完了" },
  { id: "connection_failed", label: "接続失敗" },
]

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

function repoNameFromPath(value: string | null | undefined) {
  if (!value) return null
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

function normalizeRepoPath(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "")
}

function CodexMonitorRunningOutline() {
  return (
    <span className="codex-monitor-running-orbit" aria-label="Codex 実行中">
      <svg
        className="codex-monitor-running-orbit__svg"
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="none"
      >
        <rect
          className="codex-monitor-running-orbit__rail"
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="7"
          pathLength={100}
        />
        <rect
          className="codex-monitor-running-orbit__runner"
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="7"
          pathLength={100}
        />
      </svg>
    </span>
  )
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
  if (uiStatus === "unsent") return null
  if (uiStatus === "running") return "running"
  if (uiStatus === "connection_failed") return "connection_failed"
  if (uiStatus === "done") return "done"
  return "review"
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
  const visualStatus = forceDone ? "done" : task.status
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
  const threadHref = codexThreadUrl(task.codex_thread_id)
  const openPrimary = () => {
    onOpen(task)
  }

  return (
    <article
      className={cn(
        "group relative w-full overflow-visible rounded-lg border px-2.5 py-2 pl-3.5 text-left transition-all duration-150 hover:brightness-105",
        codexMonitorCardClass(visualStatus),
      )}
      title={task.title ?? "Codexタスク"}
    >
      {uiStatus === "running" && <CodexMonitorRunningOutline />}
      <span className={cn("absolute bottom-2 left-0 top-2 w-1 rounded-r-full", codexMonitorAccentClass(visualStatus))} aria-hidden="true" />
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
          aria-label={`「${shortTitle}」の詳細を開く`}
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
      {threadHref && (
        <a
          href={threadHref}
          className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md border border-emerald-400/35 bg-background/70 px-2 text-[11px] font-semibold text-foreground/80 transition-colors hover:bg-background"
          aria-label={`「${shortTitle}」のCodexチャットを開く`}
          title="Codexチャットを開く"
        >
          <ExternalLink className="h-3 w-3" />
          Codexチャット
        </a>
      )}
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
    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-4")}>
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

function MobileImportRepoControls({
  control,
  runnerState,
}: {
  control: TaskProgressMobileImportRepoControl
  runnerState: RunnerConnectionState
}) {
  const [localError, setLocalError] = useState<string | null>(null)
  const selectedRepoPath = normalizeRepoPath(control.selectedRepoPath)
  const hasRepoPath = selectedRepoPath.length > 0
  const isBusy = Boolean(control.importPending)
  const runnerUnavailable = runnerState.loading || !runnerState.online
  const runnerUnavailableMessage = runnerState.loading
    ? "Macの通信状態を確認中です。確認後にリポ監視を切り替えられます"
    : "Macがオンラインではありません。Focusmap Macを起動するとリポ監視を切り替えられます"
  const selectedRepoLabel = control.selectedRepoLabel || repoNameFromPath(selectedRepoPath) || "リポ未選択"
  const options = useMemo(() => {
    const map = new Map<string, TaskProgressImportRepoOption>()
    for (const option of control.repoOptions) {
      const path = normalizeRepoPath(option.path)
      if (!path) continue
      map.set(path, { ...option, path })
    }
    if (selectedRepoPath && !map.has(selectedRepoPath)) {
      map.set(selectedRepoPath, {
        id: selectedRepoPath,
        path: selectedRepoPath,
        label: repoNameFromPath(selectedRepoPath) || selectedRepoPath,
      })
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ja"))
  }, [control.repoOptions, selectedRepoPath])
  const visibleError = localError || control.repoError || null

  const runAction = useCallback(async (action: () => void | Promise<void>, fallbackMessage: string) => {
    setLocalError(null)
    try {
      await action()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : fallbackMessage)
    }
  }, [])

  const handleSelectRepoPath = useCallback((nextRepoPath: string | null) => {
    if (!control.onSelectRepoPath || isBusy) return
    void runAction(
      () => control.onSelectRepoPath?.(nextRepoPath && normalizeRepoPath(nextRepoPath) ? normalizeRepoPath(nextRepoPath) : null),
      "取り込みリポを選択できませんでした",
    )
  }, [control, isBusy, runAction])

  const handleToggleImport = useCallback(() => {
    if (!control.onToggleImport || isBusy) return
    if (!hasRepoPath) {
      setLocalError("対象リポを選択してからONにできます")
      return
    }
    if (runnerUnavailable) {
      setLocalError(runnerUnavailableMessage)
      return
    }
    void runAction(() => control.onToggleImport?.(), "リポ監視を更新できませんでした")
  }, [control, hasRepoPath, isBusy, runAction, runnerUnavailable, runnerUnavailableMessage])

  const handleRefreshRepos = useCallback(() => {
    if (!control.onRefreshRepos || isBusy) return
    void runAction(() => control.onRefreshRepos?.(), "リポ候補を更新できませんでした")
  }, [control, isBusy, runAction])

  return (
    <section className="rounded-lg border bg-card px-2.5 py-2 shadow-sm" aria-label="Codex取り込みリポ">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <span className="text-sm font-semibold">リポ監視</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              control.importEnabled && hasRepoPath
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}>
              {control.importEnabled && hasRepoPath ? "ON" : "OFF"}
            </span>
            <RunnerCompactStatus state={runnerState} />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate" title={hasRepoPath ? selectedRepoPath : undefined}>
              {selectedRepoLabel}
            </span>
            {hasRepoPath && control.importOwnerLabel && (
              <span className="max-w-[38%] shrink-0 truncate rounded-full bg-muted px-1.5 py-0.5" title={control.importOwnerLabel}>
                {control.importOwnerLabel}
              </span>
            )}
          </div>
        </div>
        <Switch
          checked={control.importEnabled && hasRepoPath}
          onCheckedChange={handleToggleImport}
          disabled={!hasRepoPath || isBusy || runnerUnavailable || !control.onToggleImport}
          aria-label="リポ監視"
          title={runnerUnavailable ? runnerUnavailableMessage : undefined}
          className="h-6 w-10 shrink-0 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-700 [&>span]:h-5 [&>span]:w-5 [&>span[data-state=checked]]:translate-x-4"
        />
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_40px_40px] gap-1.5">
        <label htmlFor="mobile-codex-import-repo" className="sr-only">取り込みリポを選択</label>
        <select
          id="mobile-codex-import-repo"
          value={selectedRepoPath}
          onChange={(event) => handleSelectRepoPath(event.target.value || null)}
          disabled={isBusy || !control.onSelectRepoPath}
          className="min-h-10 min-w-0 rounded-md border bg-background px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="取り込みリポを選択"
        >
          <option value="">
            {control.repoOptionsLoading ? "リポ候補を確認中" : "リポを選択"}
          </option>
          {options.map(option => (
            <option key={option.path} value={option.path}>
              {option.sourceLabel ? `${option.label} / ${option.sourceLabel}` : option.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10"
          onClick={handleRefreshRepos}
          disabled={isBusy || !control.onRefreshRepos}
          aria-label="リポ候補を更新"
          title="リポ候補を更新"
        >
          <RefreshCw className={cn("h-4 w-4", control.repoOptionsLoading && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10"
          onClick={() => handleSelectRepoPath(null)}
          disabled={!hasRepoPath || isBusy || !control.onSelectRepoPath}
          aria-label="リポ選択を解除"
          title="リポ選択を解除"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {visibleError && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-200">
          {visibleError}
        </div>
      )}
    </section>
  )
}

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です|Codex セッションは確認待ちです/u.test(value.trim())
}

function normalizeActivityMessages(value: unknown): AiTaskActivityMessage[] {
  const messages = (value as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message, index): AiTaskActivityMessage[] => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return []
    const record = message as Partial<AiTaskActivityMessage> & Record<string, unknown>
    const body = typeof record.body === "string" ? record.body.trim() : ""
    if (!body || isGenericCodexPulseText(body)) return []
    return [{
      id: typeof record.id === "string" ? record.id : `mobile-import-activity-${index}`,
      task_id: typeof record.task_id === "string" ? record.task_id : "",
      user_id: typeof record.user_id === "string" ? record.user_id : "",
      role: record.role === "user" || record.role === "codex" || record.role === "system" || record.role === "status"
        ? record.role
        : "codex",
      kind: typeof record.kind === "string" ? record.kind as AiTaskActivityMessage["kind"] : "progress",
      body,
      importance: record.importance === "important" ? "important" : "normal",
      metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {},
      created_at: typeof record.created_at === "string" ? record.created_at : "",
    }]
  })
}

function isMobileImportUserMessage(message: AiTaskActivityMessage) {
  return message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
}

function isMobileImportStatusMessage(message: AiTaskActivityMessage) {
  return message.role === "status" || message.role === "system"
}

function mobileImportActivityLabel(message: AiTaskActivityMessage) {
  if (isMobileImportUserMessage(message)) return "送信した内容"
  if (message.kind === "question") return "Codexから質問"
  if (message.kind === "approval") return "確認依頼"
  if (message.kind === "failed") return "接続失敗"
  if (isMobileImportStatusMessage(message)) return "進行状況"
  return "Codexの返答"
}

function MobileImportActivityBubble({ message }: { message: AiTaskActivityMessage }) {
  const isUserMessage = isMobileImportUserMessage(message)
  const isStatusMessage = isMobileImportStatusMessage(message)
  const timeLabel = formatTaskProgressDateTime(message.created_at)
  const showLabel = !isUserMessage && (isStatusMessage || message.kind === "question" || message.kind === "approval" || message.kind === "failed")

  return (
    <article className={cn("flex", isUserMessage && "justify-end")}>
      <div className={cn(
        "flex min-w-0 flex-col gap-1.5",
        isUserMessage ? "max-w-[82%] items-end" : "w-full",
      )}>
        {(showLabel || timeLabel) && (
          <div className={cn(
            "flex max-w-full items-center gap-2 text-[11px] text-zinc-500",
            isUserMessage && "justify-end",
          )}>
            {showLabel && <span className="shrink-0 font-medium text-zinc-400">{mobileImportActivityLabel(message)}</span>}
            {timeLabel && <span className="truncate">{timeLabel}</span>}
          </div>
        )}
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-[15px] leading-7",
            isUserMessage
              ? "rounded-2xl bg-white px-4 py-2.5 font-medium text-zinc-950 shadow-sm"
              : "px-0 py-0 text-zinc-100",
            isStatusMessage && "w-fit rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm font-medium leading-5 text-emerald-200",
            message.kind === "question" && "rounded-xl border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-sm leading-6 text-sky-100",
            message.kind === "approval" && "rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm leading-6 text-amber-100",
            message.kind === "failed" && "rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm leading-6 text-red-100",
            message.importance === "important" && !isUserMessage && !isStatusMessage && "rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm leading-6 text-amber-100",
          )}
        >
          {message.body}
        </div>
      </div>
    </article>
  )
}

function MobileImportComposerMock() {
  return (
    <div className="rounded-[1.35rem] border border-[#3a3b40] bg-[#17181b] p-2.5 shadow-[0_16px_48px_rgba(0,0,0,0.24)]">
      <div className="min-h-16 px-1 py-1.5 text-[16px] leading-6 text-zinc-500">
        質問してみましょう
      </div>
      <div className="mt-1 flex min-h-10 items-center justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300" aria-hidden="true">
          <Plus className="h-5 w-5" />
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-zinc-100" aria-hidden="true">
            <Brain className="h-4 w-4" />
            考える
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300" aria-hidden="true">
            <Mic className="h-4 w-4" />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-zinc-500" aria-hidden="true">
            <ArrowUp className="h-5 w-5 stroke-[2.75]" />
          </span>
        </div>
      </div>
    </div>
  )
}

function MobileImportChatDetail({
  item,
  detail,
}: {
  item: TaskProgressImportItem
  detail: MobileImportDetailState | null | undefined
}) {
  const visualStatus = item.status ?? "awaiting_approval"
  const statusLabel = item.statusLabel ?? codexMonitorUiLabel(visualStatus)
  const messages = detail?.messages ?? []
  const fallbackBody = item.snippet?.trim() || statusLabel

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1f1f1f] text-zinc-100">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", codexMonitorToneClass(visualStatus))}>
              {getCodexMonitorUiStatus(visualStatus) === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {statusLabel}
            </span>
            {item.repoPath && (
              <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 text-[11px] font-medium text-zinc-400">
                <span className="truncate">{repoNameFromPath(item.repoPath)}</span>
              </span>
            )}
          </div>

          {detail?.loading && messages.length === 0 && (
            <div className="flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              チャット内容を取得中
            </div>
          )}

          {detail?.error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {detail.error}
            </div>
          )}

          {messages.length > 0 ? (
            <div className="space-y-5">
              {messages.map(message => <MobileImportActivityBubble key={message.id} message={message} />)}
            </div>
          ) : !detail?.loading && !detail?.error ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100">
              {fallbackBody}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 bg-[#1f1f1f]/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur">
        <MobileImportComposerMock />
      </div>
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
  closeSignal = 0,
  isMobile = false,
  mobileOpenSignal,
  mobileTriggerVisible = true,
  mobileImportItems = [],
  mobileImportRepoControl = null,
  isLoading = false,
  isRefreshing = false,
  error,
  onRefresh,
  onOpenTask,
  onPlaceImportItem,
  onRunSourceTask,
  onToggleSourceTaskComplete,
  onDeleteSourceTask,
}: TaskProgressKanbanProps) {
  const [desktopExpansion, setDesktopExpansion] = useState(() => ({ closeSignal, expanded: false }))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeMobileTab, setActiveMobileTab] = useState<MobileCodexSheetTab>("board")
  const [activeMobileLaneId, setActiveMobileLaneId] = useState<CodexKanbanLaneId>("review")
  const [activeMobileImportFilter, setActiveMobileImportFilter] = useState<MobileImportHistoryFilterId>("review")
  const [activeMobileImportDetailId, setActiveMobileImportDetailId] = useState<string | null>(null)
  const [mobileImportDetailsById, setMobileImportDetailsById] = useState<Record<string, MobileImportDetailState>>({})
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [desktopBodyHeightPx, setDesktopBodyHeightPx] = useState(readStoredDesktopBoardHeight)
  const [sourceTaskStatusOverrides, setSourceTaskStatusOverrides] = useState<Map<string, string>>(new Map())
  const [hiddenSourceTaskIds, setHiddenSourceTaskIds] = useState<Set<string>>(new Set())
  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastMobileOpenSignalRef = useRef<number | undefined>(mobileOpenSignal)
  const desktopResizeCleanupRef = useRef<(() => void) | null>(null)
  const runnerState = useRunnerConnection()
  const hasMobileImportRepoControl = Boolean(mobileImportRepoControl)

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

  const lanes = useMemo(() => {
    const grouped: Record<CodexKanbanLaneId, TaskProgressSnapshotTask[]> = {
      running: [],
      review: [],
      connection_failed: [],
      done: [],
    }
    for (const task of tasks) {
      const laneId = laneForTask(task, effectiveSourceTasksById)
      if (!laneId) continue
      grouped[laneId].push(task)
    }
    for (const laneTasks of Object.values(grouped)) {
      laneTasks.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    }
    return grouped
  }, [effectiveSourceTasksById, tasks])

  const counts = useMemo(() => {
    return LANES.reduce<Record<CodexKanbanLaneId, number>>((acc, lane) => {
      acc[lane.id] = lanes[lane.id].length
      return acc
    }, { running: 0, review: 0, connection_failed: 0, done: 0 })
  }, [lanes])
  const total = counts.running + counts.review + counts.connection_failed + counts.done

  const mobileImportFilterCounts = useMemo(() => {
    const next: Record<MobileImportHistoryFilterId, number> = {
      all: mobileImportItems.length,
      review: 0,
      running: 0,
      done: 0,
      connection_failed: 0,
    }
    for (const item of mobileImportItems) {
      const uiStatus = getCodexMonitorUiStatus(item.status ?? "awaiting_approval")
      if (uiStatus === "unsent") continue
      next[uiStatus] += 1
    }
    return next
  }, [mobileImportItems])

  const filteredMobileImportItems = useMemo(() => {
    if (activeMobileImportFilter === "all") return mobileImportItems
    return mobileImportItems.filter(item => getCodexMonitorUiStatus(item.status ?? "awaiting_approval") === activeMobileImportFilter)
  }, [activeMobileImportFilter, mobileImportItems])
  const activeMobileImportDetailItem = useMemo(() => {
    if (!activeMobileImportDetailId) return null
    return mobileImportItems.find(item => item.id === activeMobileImportDetailId) ?? null
  }, [activeMobileImportDetailId, mobileImportItems])
  const activeMobileImportDetail = activeMobileImportDetailItem
    ? mobileImportDetailsById[activeMobileImportDetailItem.id] ?? null
    : null

  const refreshAll = useCallback(async () => {
    await Promise.all([
      Promise.resolve(onRefresh()),
      runnerState.refresh(),
    ])
  }, [onRefresh, runnerState])

  useEffect(() => {
    if (!activeMobileImportDetailId) return
    if (mobileImportItems.some(item => item.id === activeMobileImportDetailId)) return
    setActiveMobileImportDetailId(null)
  }, [activeMobileImportDetailId, mobileImportItems])

  useEffect(() => {
    if (!activeMobileImportDetailItem) return
    let cancelled = false
    const item = activeMobileImportDetailItem
    const aiTaskId = item.aiTaskId?.trim()
    setMobileImportDetailsById(previous => ({
      ...previous,
      [item.id]: {
        loading: true,
        messages: previous[item.id]?.messages ?? [],
        error: null,
      },
    }))

    void (async () => {
      try {
        if (aiTaskId) {
          await fetchWithSupabaseAuth("/api/codex/sync-node", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ai_task_id: aiTaskId, include_visible_activity: true }),
          }).catch(() => undefined)
        }

        if (!aiTaskId) {
          if (cancelled) return
          setMobileImportDetailsById(previous => ({
            ...previous,
            [item.id]: { loading: false, messages: [], error: null },
          }))
          return
        }

        const response = await fetchWithSupabaseAuth(`/api/ai-tasks/${encodeURIComponent(aiTaskId)}/activity`, { cache: "no-store" })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message = typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "チャット内容を取得できません"
          throw new Error(message)
        }
        const messages = normalizeActivityMessages(data)
        if (cancelled) return
        setMobileImportDetailsById(previous => ({
          ...previous,
          [item.id]: { loading: false, messages, error: null },
        }))
      } catch (error) {
        if (cancelled) return
        setMobileImportDetailsById(previous => ({
          ...previous,
          [item.id]: {
            loading: false,
            messages: previous[item.id]?.messages ?? [],
            error: error instanceof Error ? error.message : "チャット内容を取得できません",
          },
        }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeMobileImportDetailItem])

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

  const openMobileKanban = useCallback((tab?: MobileCodexSheetTab) => {
    const nextTab = tab ?? (mobileImportItems.length > 0 || hasMobileImportRepoControl ? "import" : "board")
    setActiveMobileTab(nextTab)
    setActiveMobileImportDetailId(null)
    if (nextTab === "import") {
      setActiveMobileImportFilter(
        mobileImportFilterCounts.review > 0
          ? "review"
          : mobileImportFilterCounts.running > 0
            ? "running"
            : mobileImportFilterCounts.done > 0
              ? "done"
              : "all",
      )
    }
    setActiveMobileLaneId(current => {
      if (counts[current] > 0) return current
      return LANES.find(lane => counts[lane.id] > 0)?.id ?? current
    })
    setMobileOpen(true)
  }, [counts, hasMobileImportRepoControl, mobileImportFilterCounts.done, mobileImportFilterCounts.review, mobileImportFilterCounts.running, mobileImportItems.length])

  useEffect(() => {
    if (!isMobile) return
    if (mobileOpenSignal == null) return
    if (lastMobileOpenSignalRef.current === mobileOpenSignal) return
    lastMobileOpenSignalRef.current = mobileOpenSignal
    const timeoutId = window.setTimeout(() => {
      openMobileKanban(mobileImportItems.length > 0 || hasMobileImportRepoControl ? "import" : "board")
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [hasMobileImportRepoControl, isMobile, mobileImportItems.length, mobileOpenSignal, openMobileKanban])

  const handlePlaceImportItem = useCallback((taskId: string) => {
    onPlaceImportItem?.(taskId)
    setActiveMobileImportDetailId(null)
    setMobileOpen(false)
  }, [onPlaceImportItem])

  const handleOpenImportItem = useCallback((item: TaskProgressImportItem) => {
    const aiTaskId = item.aiTaskId?.trim()
    if (!aiTaskId) return
    setActiveMobileTab("import")
    setActiveMobileImportDetailId(item.id)
  }, [])

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
        {mobileTriggerVisible && (
          <button
            type="button"
            className="absolute bottom-[calc(env(safe-area-inset-bottom)+76px)] right-3 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border bg-background/95 px-3 text-xs font-semibold shadow-lg backdrop-blur"
            onClick={() => openMobileKanban()}
            aria-label={`Codexを開く。Mac状態は${runnerState.loading ? "確認中" : runnerState.online ? "オンライン" : "オフライン"}です`}
          >
            <Bot className="h-4 w-4 text-emerald-600" />
            Codex
            <RunnerCompactStatus state={runnerState} />
            {total > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{total}</span>}
          </button>
        )}
        <Sheet
          open={mobileOpen}
          onOpenChange={(nextOpen) => {
            setMobileOpen(nextOpen)
            if (!nextOpen) setActiveMobileImportDetailId(null)
          }}
        >
          <SheetContent
            side="bottom"
            className={cn(
              "flex flex-col gap-0 p-0 [&>button:last-child]:hidden",
              activeMobileImportDetailItem
                ? "h-dvh max-h-dvh rounded-none border-[#303030] bg-[#1f1f1f] text-zinc-100"
                : activeMobileTab === "import"
                  ? "max-h-[84dvh] rounded-t-xl border-[#303030] bg-[#1f1f1f] text-zinc-100"
                  : "max-h-[84dvh] rounded-t-xl",
            )}
          >
            <SheetHeader className={cn(
              "border-b px-3 py-2 text-left",
              (activeMobileTab === "import" || activeMobileImportDetailItem) && "border-[#303030] bg-[#1f1f1f]",
            )}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                      activeMobileTab === "import" || activeMobileImportDetailItem
                        ? "text-zinc-200 hover:bg-white/10 hover:text-white"
                        : "text-foreground hover:bg-muted/60",
                    )}
                    onClick={() => {
                      if (activeMobileImportDetailItem) {
                        setActiveMobileImportDetailId(null)
                        return
                      }
                      setMobileOpen(false)
                    }}
                    aria-label="戻る"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>戻る</span>
                  </button>
                  <div className="min-w-0">
                    <SheetTitle className={cn("truncate text-base", (activeMobileTab === "import" || activeMobileImportDetailItem) && "text-zinc-100")}>
                      {activeMobileImportDetailItem ? "AIチャット履歴" : activeMobileTab === "import" ? "AIチャット履歴" : "Codex看板"}
                    </SheetTitle>
                    {activeMobileImportDetailItem && (
                      <div className="mt-0.5 line-clamp-1 text-xs font-medium text-zinc-400">
                        {activeMobileImportDetailItem.title}
                      </div>
                    )}
                    <SheetDescription className="sr-only">
                      {activeMobileImportDetailItem
                        ? "選択したCodexチャット履歴を会話形式で確認する"
                        : activeMobileTab === "import"
                        ? "Codex画面から開いたAIチャット履歴をステータス別に確認する"
                        : "Codexの実行状況を確認する"}
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                    <Bot className="h-3.5 w-3.5" />
                    Codex
                  </span>
                  <RunnerChip state={runnerState} />
                </div>
              </div>
              {activeMobileImportDetailItem ? null : activeMobileTab === "import" ? (
                <div className="-mx-1 overflow-x-auto pt-2">
                  <div className="flex w-max gap-1.5 px-1" role="tablist" aria-label="AIチャット履歴ステータス">
                    {MOBILE_IMPORT_HISTORY_FILTERS.map(filter => {
                      const active = filter.id === activeMobileImportFilter
                      return (
                        <button
                          key={filter.id}
                          id={`codex-import-history-filter-${filter.id}`}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-controls="codex-import-history-list"
                          aria-label={`${filter.label} ${mobileImportFilterCounts[filter.id]}件`}
                          className={cn(
                            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
                            active
                              ? filter.id === "review"
                                ? "border-amber-400/70 bg-amber-500/10 text-amber-800 shadow-sm dark:text-amber-200"
                                : "border-emerald-400/45 bg-emerald-500/10 text-emerald-700 shadow-sm dark:text-emerald-200"
                              : "border-border bg-muted/40 text-muted-foreground",
                          )}
                          onClick={() => setActiveMobileImportFilter(filter.id)}
                        >
                          <span>{filter.label}</span>
                          <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {mobileImportFilterCounts[filter.id]}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
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
                          "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors",
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
              )}
            </SheetHeader>
            <div className={cn(
              "min-h-0 flex-1",
              activeMobileImportDetailItem
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto px-2.5 py-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]",
            )}>
              {activeMobileImportDetailItem ? (
                <MobileImportChatDetail item={activeMobileImportDetailItem} detail={activeMobileImportDetail} />
              ) : error && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                  {error}
                </div>
              )}
              {!activeMobileImportDetailItem && activeMobileTab === "import" ? (
                <div id="codex-import-history-list" className="space-y-2" role="tabpanel" aria-labelledby={`codex-import-history-filter-${activeMobileImportFilter}`}>
                  {mobileImportRepoControl && (
                    <MobileImportRepoControls control={mobileImportRepoControl} runnerState={runnerState} />
                  )}
                  {mobileImportItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
                      {mobileImportRepoControl && !normalizeRepoPath(mobileImportRepoControl.selectedRepoPath)
                        ? "リポを選択すると取り込みチャットを表示します"
                        : "このリポで取り込めるCodexチャットはありません"}
                    </div>
                  ) : filteredMobileImportItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
                      この条件のAIチャット履歴はありません
                    </div>
                  ) : filteredMobileImportItems.map(item => {
                    const visualStatus = item.status ?? "awaiting_approval"
                    const uiStatus = getCodexMonitorUiStatus(visualStatus)
                    const canOpenDetail = Boolean(item.aiTaskId)
                    const openImportDetail = () => {
                      if (canOpenDetail) handleOpenImportItem(item)
                    }
                    return (
                      <div
                        key={item.id}
                        role={canOpenDetail ? "button" : undefined}
                        tabIndex={canOpenDetail ? 0 : undefined}
                        className={cn(
                          "relative overflow-visible rounded-lg border p-2.5 pl-4 transition-all duration-150",
                          canOpenDetail && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring active:scale-[0.99]",
                          codexMonitorCardClass(visualStatus),
                        )}
                        onClick={openImportDetail}
                        onKeyDown={event => {
                          if (!canOpenDetail) return
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          openImportDetail()
                        }}
                        aria-label={canOpenDetail ? `「${item.title}」のチャットを見る` : undefined}
                      >
                        {uiStatus === "running" && <CodexMonitorRunningOutline />}
                        <span className={cn("absolute bottom-3 left-0 top-3 w-1 rounded-r-full", codexMonitorAccentClass(visualStatus))} aria-hidden="true" />
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-semibold leading-snug">{item.title}</div>
                            {item.snippet && (
                              <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {item.snippet}
                              </div>
                            )}
                          </div>
                          {(item.statusLabel || visualStatus) && (
                            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", codexMonitorToneClass(visualStatus))}>
                              {uiStatus === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                              {item.statusLabel ?? codexMonitorUiLabel(visualStatus)}
                            </span>
                          )}
                          {canOpenDetail && (
                            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          {item.repoPath && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5" title={item.repoPath}>
                              {repoNameFromPath(item.repoPath)}
                            </span>
                          )}
                          <span className="rounded-full bg-muted px-1.5 py-0.5">{item.updatedLabel}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-1.5">
                          {canOpenDetail && (
                            <button
                              type="button"
                              className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-amber-400/50 bg-amber-500/10 px-3 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-500/20 dark:text-amber-200"
                              onClick={event => {
                                event.stopPropagation()
                                handleOpenImportItem(item)
                              }}
                            >
                              履歴を見る
                            </button>
                          )}
                          {onPlaceImportItem && (
                            <button
                              type="button"
                              className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
                              onClick={event => {
                                event.stopPropagation()
                                handlePlaceImportItem(item.id)
                              }}
                            >
                              配置先を選ぶ
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : !activeMobileImportDetailItem ? (
                <div
                  onPointerDown={handleMobileLanePointerDown}
                  onPointerUp={handleMobileLanePointerEnd}
                  onPointerCancel={handleMobileLanePointerCancel}
                >
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
              ) : null}
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
