"use client"

import * as React from "react"
import { ArrowLeft, Check, ChevronDown, ChevronUp, Clock, ExternalLink, FolderGit2, FolderOpen, GitBranch, Loader2, PanelBottomOpen, RefreshCw, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import { useCodexRunnerStatus } from "@/hooks/useCodexRunnerStatus"
import {
  buildFallbackCodexDisplaySummary,
  codexDisplaySummarySignature,
  type CodexDisplaySummary,
  type CodexDisplaySummaryInput,
} from "@/lib/codex-display-summary"
import {
  CODEX_CHAT_IMPORT_DRAG_TYPE,
  encodeCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd"
import { sanitizeCodexDisplayText } from "@/lib/codex-display-sanitize"
import { codexReportViewMessages, codexReportViewSummaryMessages } from "@/lib/codex-report-view"
import {
  codexMonitorAccentClass,
  codexMonitorCardClass,
  codexMonitorToneClass,
  codexMonitorUiLabel,
  codexThreadUrl,
  getCodexMonitorUiStatus,
} from "@/lib/task-progress-ui"
import { formatAiTaskWorkElapsedMs, formatAiTaskWorkLabel } from "@/lib/ai-task-work-elapsed"
import { getCodexThreadRallyWorkElapsedMs } from "@/lib/codex-thread-import-display"
import { cn } from "@/lib/utils"
import type { AiTaskActivityKind, AiTaskActivityMessage, AiTaskActivityRole } from "@/types/ai-task"

export type CodexChatImportItem = {
  id: string
  aiTaskId?: string | null
  title: string
  snippet: string | null
  repoPath: string | null
  threadId?: string | null
  status?: string | null
  projectTitle: string | null
  placementLabel: string
  statusLabel: string | null
  updatedLabel: string | null
  sortAt?: string | null
  workStartedAt?: string | null
  workAwaitingApprovalAt?: string | null
  workCompletedAt?: string | null
  workLastActivityAt?: string | null
  placed: boolean
}

type CodexChatImportSidebarProps = {
  projectTitle: string
  selectedRepoPath: string | null
  importEnabled: boolean
  importOwnerLabel?: string | null
  importPending?: boolean
  chatItems: CodexChatImportItem[]
  detailItems?: CodexChatImportItem[]
  initialSelectedChatId?: string | null
  onInitialSelectedChatClear?: () => void
  onClose: () => void
  onSelectRepoPath: (repoPath: string | null) => Promise<void> | void
  onToggleImport: () => Promise<void> | void
  onDeleteChatItem?: (taskId: string) => Promise<void> | void
  onPlaceChatItem?: (taskId: string) => Promise<void> | void
  onReturnPlacedChatItem?: (taskId: string) => Promise<void> | void
  onChatDragStateChange?: (state: { itemId: string; title: string } | null) => void
  onOpenBoard?: () => void
}

type FocusmapDesktopFolderBridge = {
  openPath?: (path: string) => Promise<{ ok?: boolean; error?: string }>
  openExternal?: (url: string) => Promise<unknown>
}

type ChatDetailState = {
  loading: boolean
  messages: AiTaskActivityMessage[]
  text: string | null
  hasMore: boolean
  error: string | null
}

const CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT = 30
const ACTIVITY_DETAIL_PAGE_LIMIT = 30
const ACTIVITY_DETAIL_MAX_PAGES = 6
const ACTIVITY_TIME_BREAK_MIN_GAP_MS = 60 * 60 * 1000
const CHAT_DETAIL_REFRESH_INTERVAL_MS = 5_000
const RUNNING_PROMPT_START_TOLERANCE_MS = 5 * 60 * 1000

const ACTIVITY_ROLES = new Set<AiTaskActivityRole>(["system", "codex", "user", "status"])
const ACTIVITY_KINDS = new Set<AiTaskActivityKind>([
  "prompt_waiting",
  "sent",
  "progress",
  "question",
  "approval",
  "resumed",
  "completed",
  "failed",
  "user_answer",
])

function normalizeRepoPath(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function repoNameFromPath(value: string | null | undefined) {
  const normalized = normalizeRepoPath(value ?? "")
  if (!normalized) return "未選択"
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => readString(item)).filter((item): item is string => !!item)
    : []
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

type CodexThreadImportScopeStatus = {
  projectId: string | null
  repoPath: string
  cwdPaths: string[]
}

function readCodexThreadImportScopes(metadata: Record<string, unknown> | null): CodexThreadImportScopeStatus[] {
  if (!metadata) return []
  const nested = readRecord(metadata.codex_thread_import)
  const scopes = Array.isArray(nested?.scopes) ? nested.scopes : null
  if (scopes) {
    return scopes.map(scope => {
      const record = readRecord(scope)
      const repoPath = normalizeRepoPath(readString(record?.repo_path) ?? "")
      if (!repoPath) return null
      return {
        projectId: readString(record?.project_id),
        repoPath,
        cwdPaths: readStringArray(record?.cwd_paths).map(normalizeRepoPath).filter(Boolean),
      }
    }).filter((scope): scope is CodexThreadImportScopeStatus => !!scope)
  }
  return readStringArray(metadata.codex_import_scope_repo_paths)
    .map(path => normalizeRepoPath(path))
    .filter(Boolean)
    .map(repoPath => ({ projectId: null, repoPath, cwdPaths: [repoPath] }))
}

function readCodexThreadImportMetadata(metadata: Record<string, unknown> | null) {
  const nested = readRecord(metadata?.codex_thread_import)
  return {
    stateDbFound: typeof nested?.state_db_found === "boolean"
      ? nested.state_db_found
      : typeof metadata?.codex_monitor_db_available === "boolean"
        ? metadata.codex_monitor_db_available
        : null,
    lastScopeRefreshAt: readString(nested?.last_scope_refresh_at) ?? readString(metadata?.codex_last_scope_refresh_at),
    lastScopeRefreshError: readString(nested?.last_scope_refresh_error) ?? readString(metadata?.codex_last_scope_refresh_error),
    lastReconcileAt: readString(nested?.last_reconcile_at) ?? readString(metadata?.codex_last_reconcile_at),
    lastReconcileImported: readNumber(nested?.last_reconcile_imported) ?? readNumber(metadata?.codex_last_reconcile_imported),
    lastError: readString(nested?.last_error) ?? readString(metadata?.codex_monitor_last_error),
    scopes: readCodexThreadImportScopes(metadata),
  }
}

function focusmapDesktopFolderBridge() {
  if (typeof window === "undefined") return null
  return (window as Window & { focusmapDesktop?: FocusmapDesktopFolderBridge }).focusmapDesktop ?? null
}

function readTaskDetailText(data: unknown, fallback: string | null) {
  const task = (data as { task?: { memo?: unknown; title?: unknown } } | null)?.task
  const memo = typeof task?.memo === "string" ? task.memo.trim() : ""
  if (memo) return sanitizeCodexDisplayText(memo, { maxChars: 1_200, fallback: "" }).text
  const title = typeof task?.title === "string" ? task.title.trim() : ""
  if (title) return sanitizeCodexDisplayText(title, { maxChars: 1_200, fallback: "" }).text
  return sanitizeCodexDisplayText(fallback, { maxChars: 1_200, fallback: "詳細はありません" }).text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readActivityMessages(data: unknown): AiTaskActivityMessage[] {
  const rawMessages = isRecord(data) && Array.isArray(data.messages) ? data.messages : []
  return rawMessages.flatMap((rawMessage, index): AiTaskActivityMessage[] => {
    if (!isRecord(rawMessage)) return []
    const rawBody = typeof rawMessage.body === "string" ? rawMessage.body.trim() : ""
    const body = sanitizeCodexDisplayText(rawBody, { maxChars: 4_000, fallback: "" }).text
    if (!body) return []
    const role = ACTIVITY_ROLES.has(rawMessage.role as AiTaskActivityRole)
      ? rawMessage.role as AiTaskActivityRole
      : "status"
    const kind = ACTIVITY_KINDS.has(rawMessage.kind as AiTaskActivityKind)
      ? rawMessage.kind as AiTaskActivityKind
      : "progress"
    const metadata = isRecord(rawMessage.metadata) ? rawMessage.metadata : {}
    return [{
      id: typeof rawMessage.id === "string" ? rawMessage.id : `activity-${index}`,
      task_id: typeof rawMessage.task_id === "string" ? rawMessage.task_id : "",
      user_id: typeof rawMessage.user_id === "string" ? rawMessage.user_id : "",
      role,
      kind,
      body,
      importance: rawMessage.importance === "important" ? "important" : "normal",
      metadata,
      created_at: typeof rawMessage.created_at === "string" ? rawMessage.created_at : "",
    }]
  })
}

function readActivityNextCursor(data: unknown) {
  if (!isRecord(data) || data.has_more !== true || !isRecord(data.next_cursor)) return null
  const createdAt = typeof data.next_cursor.created_at === "string" ? data.next_cursor.created_at : ""
  if (!createdAt) return null
  return {
    created_at: createdAt,
    id: typeof data.next_cursor.id === "string" ? data.next_cursor.id : null,
  }
}

function dedupeActivityMessages(messages: AiTaskActivityMessage[]) {
  const byId = new Map<string, AiTaskActivityMessage>()
  for (const message of messages) {
    const key = message.id || `${message.created_at}:${message.role}:${message.kind}:${message.body}`
    byId.set(key, message)
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a.created_at).getTime()
    const bTime = new Date(b.created_at).getTime()
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です|Codex セッションは確認待ちです|Codex実行を開始しました|Codexが実行を開始しました|Codex thread が見つからないため監視を停止しました|Codex thread が一時的に見つからないため、監視を継続します|Codex thread の監視を停止しました/u.test(value.trim())
}

function visibleActivityMessages(messages: AiTaskActivityMessage[]) {
  return messages.filter(message => !isGenericCodexPulseText(message.body) && !isStatusActivityMessage(message))
}

function latestVisibleActivityMessages(messages: AiTaskActivityMessage[], limit = CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT) {
  return visibleActivityMessages(dedupeActivityMessages(messages)).slice(-limit)
}

function formatActivityTime(value: string | null | undefined) {
  if (!value) return ""
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ""
  const diff = Date.now() - time
  if (diff < 0) return "たった今"
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return "たった今"
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}分前`
  if (diff < day) return `${Math.floor(diff / hour)}時間前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}日前`
  return new Date(time).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

function shouldShowActivityTimeBreak(previous: AiTaskActivityMessage | null, current: AiTaskActivityMessage) {
  const currentTime = new Date(current.created_at).getTime()
  if (!Number.isFinite(currentTime)) return false
  if (!previous) return true

  const previousTime = new Date(previous.created_at).getTime()
  if (!Number.isFinite(previousTime)) return true
  const previousDay = new Date(previousTime).toLocaleDateString("ja-JP")
  const currentDay = new Date(currentTime).toLocaleDateString("ja-JP")
  return previousDay !== currentDay || currentTime - previousTime >= ACTIVITY_TIME_BREAK_MIN_GAP_MS
}

function ActivityTimeBreak({ value }: { value: string }) {
  const label = formatActivityTime(value)
  if (!label) return null
  return (
    <div className="flex items-center gap-3 py-1 text-center text-[11px] font-medium text-zinc-500" aria-label={label}>
      <span className="h-px min-w-0 flex-1 bg-[#303030]" aria-hidden="true" />
      <span className="shrink-0">{label}</span>
      <span className="h-px min-w-0 flex-1 bg-[#303030]" aria-hidden="true" />
    </div>
  )
}

function createChatDragImage(item: CodexChatImportItem) {
  if (typeof document === "undefined") return null
  const preview = document.createElement("div")
  preview.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    "z-index:999999",
    "width:220px",
    "max-width:220px",
    "border:1px solid rgba(56,189,248,0.9)",
    "border-radius:8px",
    "background:rgba(10,20,28,0.96)",
    "box-shadow:0 18px 42px rgba(0,0,0,0.35),0 0 0 3px rgba(56,189,248,0.18)",
    "color:white",
    "padding:8px 10px",
    "font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "line-height:1.35",
    "pointer-events:none",
  ].join(";")

  const status = document.createElement("div")
  status.textContent = "ノード化"
  status.style.cssText = "margin-bottom:4px;color:rgb(125,211,252);font-size:10px;font-weight:700"

  const title = document.createElement("div")
  title.textContent = item.title
  title.style.cssText = "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"

  preview.append(status, title)
  document.body.appendChild(preview)
  const removePreview = () => preview.remove()
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(removePreview)
  } else {
    window.setTimeout(removePreview, 0)
  }
  return preview
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
        <rect className="codex-monitor-running-orbit__rail" x="1.5" y="1.5" width="97" height="97" rx="7" pathLength={100} />
        <rect className="codex-monitor-running-orbit__runner" x="1.5" y="1.5" width="97" height="97" rx="7" pathLength={100} />
      </svg>
    </span>
  )
}

function codexChatImportWorkElapsedMs(item: CodexChatImportItem, nowMs: number, active: boolean) {
  return getCodexThreadRallyWorkElapsedMs(item, { nowMs, active })
}

function isUserActivityMessage(message: AiTaskActivityMessage) {
  return message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
}

function isStatusActivityMessage(message: AiTaskActivityMessage) {
  return message.role === "status" || message.role === "system"
}

function activityMessageCreatedMs(message: AiTaskActivityMessage | null | undefined) {
  const time = new Date(message?.created_at ?? "").getTime()
  return Number.isFinite(time) ? time : null
}

function isCurrentRallyUserMessage(message: AiTaskActivityMessage, workStartedAt: string | null | undefined) {
  if (!isUserActivityMessage(message)) return false
  if (!workStartedAt) return true
  const messageMs = activityMessageCreatedMs(message)
  const startedMs = new Date(workStartedAt).getTime()
  if (messageMs === null || !Number.isFinite(startedMs)) return false
  return messageMs >= startedMs - RUNNING_PROMPT_START_TOLERANCE_MS
}

function activityMessageWorkElapsedMs(message: AiTaskActivityMessage | null | undefined) {
  const metadata = readRecord(message?.metadata)
  const directValue = readNumber(metadata?.work_elapsed_ms)
  if (directValue !== null) return Math.max(0, directValue)
  if (typeof metadata?.work_elapsed_ms === "string" && metadata.work_elapsed_ms.trim()) {
    const parsed = Number(metadata.work_elapsed_ms)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }

  const startedAt = readString(metadata?.turn_started_at)
  const completedAt = readString(metadata?.turn_completed_at)
  if (!startedAt || !completedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const completedMs = new Date(completedAt).getTime()
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) return null
  return Math.max(0, completedMs - startedMs)
}

function runningRallyUserMessageIndex(messages: AiTaskActivityMessage[], workStartedAt?: string | null) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !isCurrentRallyUserMessage(message, workStartedAt)) continue
    return index
  }
  return -1
}

function runningRallyElapsedMs(messages: AiTaskActivityMessage[], nowMs: number, workStartedAt?: string | null) {
  const index = runningRallyUserMessageIndex(messages, workStartedAt)
  if (index >= 0) {
    const startedMs = activityMessageCreatedMs(messages[index])
    if (startedMs === null) return null
    return Math.max(0, nowMs - startedMs)
  }
  return null
}

function completedWorkMessageIndex(messages: AiTaskActivityMessage[], running: boolean) {
  if (running) return -1

  let latestUserIndex = -1
  messages.forEach((message, index) => {
    if (isUserActivityMessage(message)) latestUserIndex = index
  })
  if (latestUserIndex < 0) return -1

  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || isStatusActivityMessage(message)) continue
    if (activityMessageWorkElapsedMs(message) !== null) return index
  }
  return -1
}

function codexSummaryInput(
  item: CodexChatImportItem,
  messages: AiTaskActivityMessage[],
): CodexDisplaySummaryInput {
  return {
    title: item.title,
    status: item.status ?? null,
    statusLabel: item.statusLabel ?? null,
    snippet: item.snippet,
    detailText: null,
    messages: codexReportViewSummaryMessages(visibleActivityMessages(messages)).map(message => ({
      role: message.role,
      kind: message.kind,
      body: message.body,
      created_at: message.created_at,
    })),
  }
}

function syntheticRunningPromptMessage(
  item: CodexChatImportItem,
  messages: AiTaskActivityMessage[],
): AiTaskActivityMessage | null {
  if (runningRallyUserMessageIndex(messages, item.workStartedAt) >= 0) return null
  const body = item.snippet?.trim()
  if (!body) return null
  const createdAt = item.workStartedAt ?? item.sortAt ?? ""
  return {
    id: `running-prompt:${item.id}:${createdAt || "current"}`,
    task_id: item.aiTaskId ?? item.id,
    user_id: "",
    role: "user",
    kind: "sent",
    body,
    importance: "normal",
    metadata: { source: "codex_chat_import_item.snippet", synthetic: true },
    created_at: createdAt,
  }
}

function CodexChatAiSummaryRow({
  summary,
  collapsed,
  onToggleCollapsed,
  loading,
}: {
  summary: CodexDisplaySummary | null
  collapsed: boolean
  onToggleCollapsed: () => void
  loading?: boolean
}) {
  if (!summary) return null

  const rows = [
    { label: "実行したこと", value: summary.done },
    { label: "現状", value: summary.current },
    { label: "確認すること", value: summary.next },
  ]

  return (
    <section aria-label="AI要約" className="min-w-0 border-t border-[#303030]/80 pt-3">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-zinc-400">
          <span>AI要約</span>
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-500" aria-label="AI要約を更新中" />
          )}
        </div>
        {loading && (
          <span className="text-[10px] font-medium text-zinc-500">
            更新中
          </span>
        )}
        <button
          type="button"
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500/50"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "AI要約を展開" : "AI要約を折りたたむ"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>
      {!collapsed && (
        <dl className="min-w-0 divide-y divide-[#303030]/80">
          {rows.map(row => (
            <div key={row.label} className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] gap-2 py-2 first:pt-1.5">
              <dt className="min-w-0 text-[11px] font-semibold leading-relaxed text-zinc-500">
                {row.label}
              </dt>
              <dd className="min-w-0 break-words text-[12px] leading-relaxed text-zinc-300">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function ActivityMessageBubble({ message }: { message: AiTaskActivityMessage }) {
  const isUserMessage = isUserActivityMessage(message)

  return (
    <article className={cn("flex", isUserMessage && "justify-end")}>
      <div className={cn(
        "flex min-w-0 flex-col",
        isUserMessage ? "max-w-[82%] items-end" : "w-full",
      )}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-[15px] leading-7",
            "[overflow-wrap:anywhere]",
            isUserMessage
              ? "rounded-2xl bg-white px-4 py-2.5 font-medium text-zinc-950 shadow-sm"
              : "px-0 py-0 text-zinc-100",
            message.kind === "failed" && !isUserMessage && "text-red-200",
          )}
        >
          {message.body}
        </div>
      </div>
    </article>
  )
}

function ChatRunningInlineStatus({ elapsedText }: { elapsedText: string | null }) {
  if (!elapsedText) return null

  return (
    <div
      className="!mt-2 flex items-center justify-start gap-1.5 text-[12px] font-medium leading-none text-zinc-500"
      aria-live="polite"
      aria-label={`${elapsedText} 作業中`}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300/80" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-mono tabular-nums">{elapsedText}</span>
        <span className="ml-1">作業中</span>
      </span>
    </div>
  )
}

function ChatCompletedWorkInlineStatus({ elapsedText }: { elapsedText: string | null }) {
  if (!elapsedText) return null

  return (
    <div
      className="!my-2 flex items-center gap-2 text-[12px] font-medium leading-none text-zinc-500"
      aria-label={`${elapsedText}作業しました`}
    >
      <span className="shrink-0">
        <span className="font-mono tabular-nums">{elapsedText}</span>
        <span>作業しました</span>
      </span>
      <span className="h-px min-w-0 flex-1 bg-[#303030]" aria-hidden="true" />
    </div>
  )
}

export function CodexChatImportSidebar({
  projectTitle,
  selectedRepoPath,
  importEnabled,
  importOwnerLabel = null,
  importPending = false,
  chatItems,
  detailItems = [],
  initialSelectedChatId = null,
  onInitialSelectedChatClear,
  onClose,
  onSelectRepoPath,
  onToggleImport,
  onDeleteChatItem,
  onChatDragStateChange,
  onOpenBoard,
}: CodexChatImportSidebarProps) {
  const [pickerPending, setPickerPending] = React.useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false)
  const [repoError, setRepoError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null)
  const [chatDetailsById, setChatDetailsById] = React.useState<Record<string, ChatDetailState>>({})
  const [linkedAiTaskIdsBySourceId, setLinkedAiTaskIdsBySourceId] = React.useState<Record<string, string>>({})
  const [draggingChatId, setDraggingChatId] = React.useState<string | null>(null)
  const [collapsedSummaryChatIds, setCollapsedSummaryChatIds] = React.useState<Set<string>>(() => new Set())
  const [aiSummaryByChatId, setAiSummaryByChatId] = React.useState<Record<string, {
    signature: string
    summary: CodexDisplaySummary
    loading: boolean
    source: "ai" | "fallback"
  }>>({})
  const consumedInitialSelectedChatIdRef = React.useRef<string | null>(null)
  const summaryRequestInFlightRef = React.useRef(new Set<string>())
  const { repos, isLoading, error: reposError, refresh, requestRescan } = useAvailableRepos()
  const codexRunnerStatus = useCodexRunnerStatus()

  const currentRepoPath = normalizeRepoPath(selectedRepoPath ?? "")
  const hasRepoPath = currentRepoPath.length > 0
  const codexRepos = React.useMemo(() => repos.filter(repo => repo.source === "codex"), [repos])
  const currentRepo = repos.find(repo => normalizeRepoPath(repo.absolute_path) === currentRepoPath) ?? null
  const currentCodexRepo = codexRepos.find(repo => normalizeRepoPath(repo.absolute_path) === currentRepoPath) ?? null
  const currentRepoIsCodexProject = !!currentCodexRepo
  const currentRepoIsCandidateOnly = hasRepoPath && !currentRepoIsCodexProject
  const importMetadata = React.useMemo(
    () => readCodexThreadImportMetadata(codexRunnerStatus.metadata),
    [codexRunnerStatus.metadata],
  )
  const currentImportScope = React.useMemo(() => (
    importMetadata.scopes.find(scope => scope.repoPath === currentRepoPath) ?? null
  ), [currentRepoPath, importMetadata.scopes])
  const currentRepoAgentScopeMatched = !!currentImportScope
  const currentRepoWorktreeCount = currentImportScope
    ? new Set(currentImportScope.cwdPaths.map(normalizeRepoPath).filter(Boolean)).size
    : 0
  const agentStatusLabel = !codexRunnerStatus.ready
    ? "agent未接続"
    : importMetadata.stateDbFound === false
      ? "Codex DB未検出"
      : currentRepoAgentScopeMatched
        ? "agent反映済み"
        : importEnabled && hasRepoPath
          ? "agent反映待ち"
          : "監視OFF"
  const agentStatusTone = currentRepoAgentScopeMatched
    ? "bg-emerald-400/10 text-emerald-300"
    : importEnabled && hasRepoPath && codexRunnerStatus.ready
      ? "bg-amber-400/10 text-amber-200"
      : "bg-white/[0.06] text-zinc-400"
  const lastScopeRefreshLabel = formatActivityTime(importMetadata.lastScopeRefreshAt)
  const lastReconcileLabel = formatActivityTime(importMetadata.lastReconcileAt)
  const isBusy = importPending || pickerPending
  const runnerUnavailable = !codexRunnerStatus.ready
  const runnerUnavailableMessage = codexRunnerStatus.loading || !codexRunnerStatus.checked
    ? "Macの通信状態を確認中です。確認後にリポ監視を切り替えられます"
    : "Macがオンラインではありません。Focusmap Macを起動するとリポ監視を切り替えられます"
  const currentRepoLabel = currentRepo?.display_name || repoNameFromPath(currentRepoPath)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredChatItems = React.useMemo(() => {
    if (!normalizedQuery) return chatItems
    return chatItems.filter(item => {
      const haystack = [item.title, item.snippet, item.repoPath, item.projectTitle, item.placementLabel, item.statusLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [chatItems, normalizedQuery])
  const isFilteringChatItems = normalizedQuery.length > 0
  const selectableChatItems = React.useMemo(() => {
    const byId = new Map<string, CodexChatImportItem>()
    for (const item of chatItems) byId.set(item.id, item)
    for (const item of detailItems) byId.set(item.id, item)
    return Array.from(byId.values())
  }, [chatItems, detailItems])
  const selectedChatItem = React.useMemo(() => {
    if (!selectedChatId) return null
    return selectableChatItems.find(item => item.id === selectedChatId) ?? null
  }, [selectableChatItems, selectedChatId])
  const hasRunningWorkTimer = React.useMemo(() => (
    [...filteredChatItems, selectedChatItem].some(item => (
      !!item?.workStartedAt && getCodexMonitorUiStatus(item.status ?? null) === "running"
    ))
  ), [filteredChatItems, selectedChatItem])
  const [workNowMs, setWorkNowMs] = React.useState(() => Date.now())

  React.useEffect(() => {
    setWorkNowMs(Date.now())
    if (!hasRunningWorkTimer) return
    const intervalId = window.setInterval(() => setWorkNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [hasRunningWorkTimer])

  React.useEffect(() => {
    if (!selectedChatId) return
    if (selectableChatItems.some(item => item.id === selectedChatId)) return
    setSelectedChatId(null)
    onInitialSelectedChatClear?.()
  }, [onInitialSelectedChatClear, selectableChatItems, selectedChatId])

  const resolveAiTaskId = React.useCallback((item: CodexChatImportItem) => {
    const directAiTaskId = item.aiTaskId?.trim()
    if (directAiTaskId) return directAiTaskId
    return linkedAiTaskIdsBySourceId[item.id]?.trim() || null
  }, [linkedAiTaskIdsBySourceId])
  const displayUpdatedLabel = React.useCallback((item: CodexChatImportItem) => item.updatedLabel, [])
  const fetchChatActivityPage = React.useCallback(async (
    aiTaskId: string,
    cursor: { created_at: string; id: string | null } | null = null,
  ) => {
    const params = new URLSearchParams({ limit: String(ACTIVITY_DETAIL_PAGE_LIMIT), mode: "report" })
    if (cursor) {
      params.set("before_created_at", cursor.created_at)
      if (cursor.id) params.set("before_id", cursor.id)
    }
    const activityRes = await fetch(`/api/ai-tasks/${encodeURIComponent(aiTaskId)}/activity?${params}`, { cache: "no-store" })
    const activityData = await activityRes.json().catch(() => ({}))
    if (!activityRes.ok) return { messages: [] as AiTaskActivityMessage[], nextCursor: null }
    return {
      messages: readActivityMessages(activityData),
      nextCursor: readActivityNextCursor(activityData),
    }
  }, [])
  const fetchChatActivityMessages = React.useCallback(async (aiTaskId: string) => {
    const messages: AiTaskActivityMessage[] = []
    let cursor: { created_at: string; id: string | null } | null = null
    let hasMore = false
    for (let page = 0; page < ACTIVITY_DETAIL_MAX_PAGES; page += 1) {
      const activityPage = await fetchChatActivityPage(aiTaskId, cursor)
      messages.push(...activityPage.messages)
      const visibleMessages = latestVisibleActivityMessages(messages)
      const allVisibleMessages = visibleActivityMessages(dedupeActivityMessages(messages))
      if (allVisibleMessages.length > CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT) {
        return { messages: visibleMessages, hasMore: true }
      }
      if (!activityPage.nextCursor) {
        return { messages: visibleMessages, hasMore: false }
      }
      hasMore = true
      cursor = activityPage.nextCursor
      if (allVisibleMessages.length >= CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT) {
        return { messages: visibleMessages, hasMore: true }
      }
    }
    return { messages: latestVisibleActivityMessages(messages), hasMore }
  }, [fetchChatActivityPage])

  const selectRepoPath = React.useCallback(async (nextRepoPath: string | null) => {
    const normalized = nextRepoPath ? normalizeRepoPath(nextRepoPath) : ""
    setRepoError(null)
    try {
      await onSelectRepoPath(normalized || null)
      setRepoPickerOpen(false)
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "対象リポを選択できませんでした")
    }
  }, [onSelectRepoPath])

  const openRepoInFinder = React.useCallback(async () => {
    if (!currentRepoPath) {
      setRepoError("先にCodexプロジェクトを選択してください")
      return
    }
    setPickerPending(true)
    setRepoError(null)
    try {
      const bridge = focusmapDesktopFolderBridge()
      if (bridge?.openPath) {
        const data = await bridge.openPath(currentRepoPath)
        if (!data?.ok) setRepoError(data?.error || "Finderで選択中リポを開けませんでした")
        return
      }
      setRepoError("Finder表示はMacアプリ更新後に利用できます。リポ選択はCodexプロジェクト候補から行ってください")
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Finderで選択中リポを開けませんでした")
    } finally {
      setPickerPending(false)
    }
  }, [currentRepoPath])

  const handleToggleImport = React.useCallback(async () => {
    if (!hasRepoPath || isBusy) {
      if (!hasRepoPath) setRepoError("対象リポを選択してからONにできます")
      return
    }
    if (!importEnabled && currentRepoIsCandidateOnly) {
      setRepoError("Codexプロジェクト候補から選び直すと監視ONにできます")
      return
    }
    if (runnerUnavailable) {
      setRepoError(runnerUnavailableMessage)
      return
    }
    setRepoError(null)
    try {
      await onToggleImport()
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "取り込み設定を更新できませんでした")
    }
  }, [currentRepoIsCandidateOnly, hasRepoPath, importEnabled, isBusy, onToggleImport, runnerUnavailable, runnerUnavailableMessage])

  const handleRefreshRepos = React.useCallback(async () => {
    setRepoError(null)
    try {
      await requestRescan()
      await refresh()
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "リポフォルダ一覧を更新できませんでした")
    }
  }, [refresh, requestRescan])

  const syncChatActivity = React.useCallback(async (item: CodexChatImportItem) => {
    const aiTaskId = resolveAiTaskId(item)
    const payload = aiTaskId
      ? { ai_task_id: aiTaskId, include_visible_activity: true }
      : { source_task_id: item.id, include_visible_activity: true }

    const res = await fetch("/api/codex/sync-node", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data as { success?: boolean })?.success === false) {
      const message = (data as { error?: string; message?: string })?.error ||
        (data as { message?: string })?.message ||
        "CodexチャットをDBへ保存できませんでした"
      throw new Error(message)
    }

    const syncedAiTaskId = typeof (data as { task_id?: unknown }).task_id === "string"
      ? (data as { task_id: string }).task_id
      : aiTaskId
    if (syncedAiTaskId) {
      setLinkedAiTaskIdsBySourceId(prev => (
        prev[item.id] === syncedAiTaskId ? prev : { ...prev, [item.id]: syncedAiTaskId }
      ))
    }
    return syncedAiTaskId
  }, [resolveAiTaskId])

  const loadChatDetail = React.useCallback(async (
    item: CodexChatImportItem,
    options: { background?: boolean } = {},
  ) => {
    const background = options.background === true
    setChatDetailsById(prev => {
      const previous = prev[item.id]
      return {
        ...prev,
        [item.id]: {
          loading: background ? previous?.loading ?? false : true,
          messages: previous?.messages ?? [],
          text: previous?.text ?? null,
          hasMore: previous?.hasMore ?? false,
          error: background ? previous?.error ?? null : null,
        },
      }
    })

    let aiTaskId = resolveAiTaskId(item)
    try {
      try {
        aiTaskId = await syncChatActivity(item) || aiTaskId
      } catch {
        // ローカルMacが使えない環境でも、既にDBへ保存済みのactivityは表示する。
      }

      if (aiTaskId) {
        const { messages, hasMore } = await fetchChatActivityMessages(aiTaskId)
        if (messages.length > 0) {
          setChatDetailsById(prev => ({
            ...prev,
            [item.id]: { loading: false, messages, text: null, hasMore, error: null },
          }))
          return
        }
      }

      const fallbackRes = await fetch(`/api/tasks/${encodeURIComponent(item.id)}`)
      const fallbackData = await fallbackRes.json().catch(() => ({}))
      if (!fallbackRes.ok || (fallbackData as { success?: boolean })?.success === false) {
        const message = (fallbackData as { error?: { message?: string } })?.error?.message || "チャット詳細を取得できませんでした"
        throw new Error(message)
      }
      setChatDetailsById(prev => ({
        ...prev,
        [item.id]: {
          loading: false,
          messages: [],
          text: readTaskDetailText(fallbackData, item.snippet),
          hasMore: false,
          error: null,
        },
      }))
    } catch (error) {
      setChatDetailsById(prev => {
        const previous = prev[item.id]
        if (background && previous) {
          return {
            ...prev,
            [item.id]: {
              ...previous,
              loading: false,
            },
          }
        }
        return {
          ...prev,
          [item.id]: {
            loading: false,
            messages: [],
            text: null,
            hasMore: false,
            error: error instanceof Error ? error.message : "チャット詳細を取得できませんでした",
          },
        }
      })
    }
  }, [fetchChatActivityMessages, resolveAiTaskId, syncChatActivity])

  const handleChatItemClick = React.useCallback((item: CodexChatImportItem) => {
    setSelectedChatId(item.id)
    setRepoPickerOpen(false)
    void loadChatDetail(item)
  }, [loadChatDetail])

  React.useEffect(() => {
    if (!initialSelectedChatId) {
      consumedInitialSelectedChatIdRef.current = null
      return
    }
    if (consumedInitialSelectedChatIdRef.current === initialSelectedChatId) return
    const item = selectableChatItems.find(candidate => candidate.id === initialSelectedChatId)
    if (!item) return
    consumedInitialSelectedChatIdRef.current = initialSelectedChatId
    setSelectedChatId(item.id)
    setRepoPickerOpen(false)
    void loadChatDetail(item)
  }, [initialSelectedChatId, loadChatDetail, selectableChatItems])

  const selectedDetail = selectedChatItem ? chatDetailsById[selectedChatItem.id] : null
  const selectedMessages = codexReportViewMessages(visibleActivityMessages(selectedDetail?.messages ?? []))
  const selectedThreadHref = codexThreadUrl(selectedChatItem?.threadId)
  const selectedUpdatedLabel = selectedChatItem ? displayUpdatedLabel(selectedChatItem) : null
  const selectedVisualStatus = selectedChatItem?.status ?? "awaiting_approval"
  const selectedUiStatus = getCodexMonitorUiStatus(selectedVisualStatus)
  const selectedRallyWorkElapsedMs = selectedChatItem
    ? codexChatImportWorkElapsedMs(selectedChatItem, workNowMs, selectedUiStatus === "running")
    : null

  React.useEffect(() => {
    if (!selectedChatItem || selectedUiStatus !== "running") return
    const timer = window.setInterval(() => {
      void loadChatDetail(selectedChatItem, { background: true })
    }, CHAT_DETAIL_REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [loadChatDetail, selectedChatItem, selectedUiStatus])

  const selectedCompletedWorkMessageIndex = completedWorkMessageIndex(
    selectedMessages,
    selectedUiStatus === "running",
  )
  const selectedCompletedWorkElapsedMs = selectedCompletedWorkMessageIndex >= 0
    ? activityMessageWorkElapsedMs(selectedMessages[selectedCompletedWorkMessageIndex])
    : null
  const selectedRunningUserMessageIndex = selectedUiStatus === "running"
    ? runningRallyUserMessageIndex(selectedMessages, selectedChatItem?.workStartedAt)
    : -1
  const selectedSyntheticRunningPromptMessage = selectedUiStatus === "running" && selectedChatItem
    ? syntheticRunningPromptMessage(selectedChatItem, selectedMessages)
    : null
  const selectedRunningWorkElapsedMs = selectedUiStatus === "running"
    ? runningRallyElapsedMs(selectedMessages, workNowMs, selectedChatItem?.workStartedAt)
    : null
  const selectedWorkElapsedMs = selectedUiStatus === "running"
    ? selectedRunningWorkElapsedMs ?? selectedRallyWorkElapsedMs
    : selectedCompletedWorkElapsedMs ?? selectedRallyWorkElapsedMs
  const selectedWorkElapsedText = formatAiTaskWorkElapsedMs(selectedWorkElapsedMs)
  const selectedCompletedWorkElapsedText = formatAiTaskWorkElapsedMs(selectedCompletedWorkElapsedMs)
  const selectedWorkLabel = formatAiTaskWorkLabel(selectedWorkElapsedMs, selectedUiStatus === "running")
  const selectedHasTimelineMessages = selectedMessages.length > 0 || Boolean(selectedSyntheticRunningPromptMessage)
  const selectedSummaryInput = React.useMemo(() => {
    if (!selectedChatItem) return null
    return codexSummaryInput(selectedChatItem, selectedDetail?.messages ?? [])
  }, [selectedChatItem, selectedDetail?.messages])
  const selectedSummarySignature = React.useMemo(() => {
    return selectedSummaryInput ? codexDisplaySummarySignature(selectedSummaryInput) : null
  }, [selectedSummaryInput])
  const selectedFallbackSummary = React.useMemo(() => {
    return selectedSummaryInput ? buildFallbackCodexDisplaySummary(selectedSummaryInput) : null
  }, [selectedSummaryInput])
  const selectedAiSummaryState = selectedChatItem ? aiSummaryByChatId[selectedChatItem.id] : null
  const selectedSummary = selectedAiSummaryState &&
    selectedSummarySignature &&
    selectedAiSummaryState.signature === selectedSummarySignature
    ? selectedAiSummaryState.summary
    : selectedFallbackSummary
  const selectedSummaryLoading = Boolean(
    selectedDetail?.loading ||
    (
      selectedAiSummaryState?.loading &&
      selectedSummarySignature &&
      selectedAiSummaryState.signature === selectedSummarySignature
    ),
  )
  const selectedSummaryCollapsed = selectedChatItem ? collapsedSummaryChatIds.has(selectedChatItem.id) : false
  const toggleSelectedSummaryCollapsed = React.useCallback(() => {
    if (!selectedChatItem) return
    setCollapsedSummaryChatIds(prev => {
      const next = new Set(prev)
      if (next.has(selectedChatItem.id)) {
        next.delete(selectedChatItem.id)
      } else {
        next.add(selectedChatItem.id)
      }
      return next
    })
  }, [selectedChatItem])
  React.useEffect(() => {
    if (!selectedChatItem || !selectedSummaryInput || !selectedSummarySignature || !selectedFallbackSummary) return
    if (!selectedDetail || selectedDetail.loading) return

    const bodySize = JSON.stringify(selectedSummaryInput).length
    if (bodySize < 240) return

    const existing = aiSummaryByChatId[selectedChatItem.id]
    if (existing?.signature === selectedSummarySignature && !existing.loading) return

    const requestKey = `${selectedChatItem.id}:${selectedSummarySignature}`
    if (summaryRequestInFlightRef.current.has(requestKey)) return
    summaryRequestInFlightRef.current.add(requestKey)
    setAiSummaryByChatId(prev => ({
      ...prev,
      [selectedChatItem.id]: {
        signature: selectedSummarySignature,
        summary: existing?.signature === selectedSummarySignature ? existing.summary : selectedFallbackSummary,
        loading: true,
        source: existing?.signature === selectedSummarySignature ? existing.source : "fallback",
      },
    }))

    const targetId = resolveAiTaskId(selectedChatItem) ?? selectedChatItem.id
    void fetchWithSupabaseAuth(`/api/ai-tasks/${encodeURIComponent(targetId)}/codex-display-summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectedSummaryInput),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        const summary = data && typeof data === "object" && "summary" in data
          ? (data as { summary?: Partial<CodexDisplaySummary>; source?: "ai" | "fallback" }).summary
          : null
        setAiSummaryByChatId(prev => {
          const current = prev[selectedChatItem.id]
          if (!current || current.signature !== selectedSummarySignature) return prev
          return {
            ...prev,
            [selectedChatItem.id]: {
              signature: selectedSummarySignature,
              summary: response.ok && summary?.done && summary.current && summary.next
                ? { done: summary.done, current: summary.current, next: summary.next }
                : selectedFallbackSummary,
              loading: false,
              source: response.ok && data?.source === "ai" ? "ai" : "fallback",
            },
          }
        })
      })
      .catch(() => {
        setAiSummaryByChatId(prev => {
          const current = prev[selectedChatItem.id]
          if (!current || current.signature !== selectedSummarySignature) return prev
          return {
            ...prev,
            [selectedChatItem.id]: {
              signature: selectedSummarySignature,
              summary: selectedFallbackSummary,
              loading: false,
              source: "fallback",
            },
          }
        })
      })
      .finally(() => {
        summaryRequestInFlightRef.current.delete(requestKey)
      })
  }, [
    aiSummaryByChatId,
    resolveAiTaskId,
    selectedChatItem,
    selectedDetail,
    selectedFallbackSummary,
    selectedSummaryInput,
    selectedSummarySignature,
  ])
  const openCodexThread = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.stopPropagation()
    const bridge = focusmapDesktopFolderBridge()
    if (!bridge?.openExternal) return
    event.preventDefault()
    void bridge.openExternal(href).catch(error => {
      console.error("[CodexChatImportSidebar] Failed to open Codex thread via desktop bridge:", error)
      if (typeof window !== "undefined") window.location.href = href
    })
  }, [])
  const finishChatDrag = React.useCallback(() => {
    setDraggingChatId(null)
    onChatDragStateChange?.(null)
  }, [onChatDragStateChange])

  React.useEffect(() => {
    if (!draggingChatId) return
    if (chatItems.some(item => item.id === draggingChatId)) return
    finishChatDrag()
  }, [chatItems, draggingChatId, finishChatDrag])

  return (
    <aside
      className="flex h-full w-[min(460px,calc(100vw-1.5rem))] flex-col overflow-hidden border border-y-0 border-r-0 border-[#303030] bg-[#171717] text-zinc-100 shadow-2xl shadow-black/40"
      aria-label="チャット取り込み"
      title={projectTitle}
    >
      {!selectedChatItem && (
        <div className="space-y-2 border-b border-[#303030] p-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#2d2d2d] bg-[#111111] px-2.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-zinc-200">リポ監視</span>
              {hasRepoPath && importOwnerLabel && (
                <span className="max-w-[96px] shrink-0 truncate rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400" title={importOwnerLabel}>
                  監視: {importOwnerLabel}
                </span>
              )}
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  codexRunnerStatus.ready
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-amber-400/10 text-amber-200",
                )}
              >
                {codexRunnerStatus.loading || !codexRunnerStatus.checked
                  ? "Mac確認中"
                  : codexRunnerStatus.ready
                    ? "Mac online"
                    : "Mac offline"}
              </span>
            </div>
            <Switch
              checked={importEnabled && hasRepoPath}
              onCheckedChange={() => void handleToggleImport()}
              disabled={!hasRepoPath || isBusy || runnerUnavailable || (!importEnabled && currentRepoIsCandidateOnly)}
              aria-label="リポ監視"
              title={runnerUnavailable ? runnerUnavailableMessage : currentRepoIsCandidateOnly ? "Codexプロジェクト候補から選び直すとONにできます" : undefined}
              className="h-6 w-10 shrink-0 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700 [&>span]:h-5 [&>span]:w-5 [&>span[data-state=checked]]:translate-x-4"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:ring-zinc-500/70"
              onClick={onClose}
              aria-label="AI実行を閉じる"
              title="閉じる"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-lg border border-[#2d2d2d] bg-[#101010] px-2.5 py-2">
            <div className="flex min-w-0 items-start gap-2">
              <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-[10px] font-medium text-zinc-500">選択中</span>
                  <span className="min-w-0 truncate text-xs font-semibold text-zinc-100" title={hasRepoPath ? currentRepoPath : undefined}>
                    {hasRepoPath ? currentRepoLabel : "Codexプロジェクト未選択"}
                  </span>
                  {hasRepoPath && (
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      currentRepoIsCodexProject
                        ? "bg-sky-400/10 text-sky-200"
                        : "bg-amber-400/10 text-amber-200",
                    )}>
                      {currentRepoIsCodexProject ? "Codexプロジェクト" : "Codex候補外"}
                    </span>
                  )}
                </div>
                <div className="mt-1 min-w-0 truncate text-[10px] text-zinc-500" title={hasRepoPath ? currentRepoPath : undefined}>
                  {hasRepoPath ? currentRepoPath : "Codex側に表示されているプロジェクトから選択してください"}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    importEnabled && hasRepoPath ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.06] text-zinc-400",
                  )}>
                    {importEnabled && hasRepoPath ? "監視ON" : "監視OFF"}
                  </span>
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", agentStatusTone)}>
                    {agentStatusLabel}
                  </span>
                  {currentRepoWorktreeCount > 1 && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                      worktree含む
                    </span>
                  )}
                  {lastScopeRefreshLabel && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-500">
                      scope {lastScopeRefreshLabel}
                    </span>
                  )}
                  {lastReconcileLabel && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-500">
                      照合 {lastReconcileLabel}{typeof importMetadata.lastReconcileImported === "number" ? ` / ${importMetadata.lastReconcileImported}件` : ""}
                    </span>
                  )}
                </div>
                {(importMetadata.lastScopeRefreshError || importMetadata.lastError) && (
                  <div className="mt-1 truncate text-[10px] text-amber-200" title={importMetadata.lastScopeRefreshError ?? importMetadata.lastError ?? undefined}>
                    {importMetadata.lastScopeRefreshError ?? importMetadata.lastError}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-[#303030] bg-[#111111] px-2 text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={() => setRepoPickerOpen(open => !open)}
                disabled={isBusy}
                aria-expanded={repoPickerOpen}
                aria-controls="codex-repo-picker"
              >
                <FolderGit2 className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">Codexプロジェクトから選択</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-[#303030] bg-[#111111] px-2 text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={openRepoInFinder}
                disabled={isBusy || !hasRepoPath}
                aria-label="選択中リポをFinderで開く"
                title="選択中リポをFinderで開く"
              >
                {pickerPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                <span className="ml-1.5 text-xs">Finder</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-400 hover:bg-white/10 hover:text-white"
                onClick={handleRefreshRepos}
                disabled={isBusy}
                aria-label="リポ候補を更新"
                title="リポ候補を更新"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              </Button>
              {currentRepoPath && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                  onClick={() => void selectRepoPath(null)}
                  disabled={isBusy}
                >
                  選択解除
                </Button>
              )}
            </div>

            {repoPickerOpen && (
              <div
                id="codex-repo-picker"
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-[#303030] bg-[#171717] p-1 shadow-xl shadow-black/40"
              >
                {codexRepos.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-zinc-500">
                    Codexプロジェクト候補がありません
                  </div>
                ) : (
                  codexRepos.slice(0, 8).map(repo => {
                    const selected = currentRepoPath === repo.absolute_path
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        aria-label={`対象リポを選択 ${repo.display_name || repoNameFromPath(repo.absolute_path)}`}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-300 transition-colors hover:bg-white/10 hover:text-white",
                          selected && "bg-white/10 text-white",
                        )}
                        onClick={() => void selectRepoPath(repo.absolute_path)}
                        disabled={isBusy}
                        title={repo.absolute_path}
                      >
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {repo.display_name || repoNameFromPath(repo.absolute_path)}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-500">
                          Codex
                        </span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {onOpenBoard && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full justify-start border-[#303030] bg-[#111111] px-2.5 text-zinc-200 hover:bg-white/10 hover:text-white"
              onClick={onOpenBoard}
            >
              <PanelBottomOpen className="h-3.5 w-3.5" />
              <span className="ml-1.5 text-xs font-semibold">Codex看板を開く</span>
            </Button>
          )}

          {(repoError || reposError) && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
              {repoError ?? reposError}
            </p>
          )}
        </div>
      )}

      {selectedChatItem ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-[#303030] px-3 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-zinc-500/50"
                onClick={() => {
                  setSelectedChatId(null)
                  onInitialSelectedChatClear?.()
                }}
                aria-label="一覧へ戻る"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1" title={selectedChatItem.title}>
                    <div className="line-clamp-2 break-words text-base font-semibold leading-snug text-zinc-100">{selectedChatItem.title}</div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      {selectedChatItem.placed && (
                        <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] font-medium leading-none text-emerald-300">
                          {selectedChatItem.placementLabel}
                        </span>
                      )}
                      {selectedChatItem.repoPath && (
                        <span className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium leading-none text-zinc-400">
                          <span className="truncate">{repoNameFromPath(selectedChatItem.repoPath)}</span>
                        </span>
                      )}
                      {selectedUpdatedLabel && (
                        <span className="text-xs font-medium text-zinc-500">{selectedUpdatedLabel}</span>
                      )}
                      {selectedThreadHref && (
                        <a
                          href={selectedThreadHref}
                          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-500/10 px-2.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                          aria-label={`Codexで開く ${selectedChatItem.title}`}
                          onClick={event => openCodexThread(event, selectedThreadHref)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Codexで開く
                        </a>
                      )}
                    </div>
                  </div>
                  <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold leading-none", codexMonitorToneClass(selectedVisualStatus))}>
                    {selectedUiStatus === "running" && (
                      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                      </span>
                    )}
                    <span className="truncate">{selectedChatItem.statusLabel ?? codexMonitorUiLabel(selectedVisualStatus)}</span>
                    {selectedUiStatus === "running" && selectedWorkElapsedText && (
                      <span className="border-l border-current/25 pl-1 font-mono tabular-nums">{selectedWorkElapsedText}</span>
                    )}
                  </span>
                  {selectedUiStatus !== "running" && selectedWorkLabel && (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium leading-none text-zinc-400">
                      <Clock className="h-3 w-3" />
                      <span className="truncate">{selectedWorkLabel}</span>
                    </span>
                  )}
                </div>

              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-1 h-9 w-9 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:ring-zinc-500/70"
                onClick={onClose}
                aria-label="AI実行を閉じる"
                title="閉じる"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <CodexChatAiSummaryRow
              summary={selectedSummary}
              collapsed={selectedSummaryCollapsed}
              onToggleCollapsed={toggleSelectedSummaryCollapsed}
              loading={selectedSummaryLoading}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5">
            <div className="mb-3 text-[12px] font-semibold text-zinc-400">チャット履歴</div>

            {selectedDetail?.loading && !selectedHasTimelineMessages && !selectedDetail.text ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#303030] bg-[#111111] px-3 py-2 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                チャット内容を取得中
              </div>
            ) : null}

            {selectedDetail?.error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {selectedDetail.error}
              </div>
            ) : null}

            {selectedDetail?.loading && selectedHasTimelineMessages ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#303030] bg-[#111111] px-2 py-1.5 text-[11px] text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                最新内容を取得中
              </div>
            ) : null}

            {selectedHasTimelineMessages ? (
              <div className="space-y-5">
                {(selectedDetail?.hasMore || selectedThreadHref) && (
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-[#3a3a3a] bg-[#111111] px-3 py-2 text-[12px] text-zinc-400">
                    <span className="min-w-0 flex-1">
                      {selectedDetail?.hasMore
                        ? "これより前の履歴は各エディター画面から確認してください。"
                        : "全文や細かい操作は各エディター画面から確認できます。"}
                    </span>
                    {selectedThreadHref && (
                      <a
                        href={selectedThreadHref}
                        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        onClick={event => openCodexThread(event, selectedThreadHref)}
                        aria-label={`各エディター画面で履歴を開く ${selectedChatItem.title}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Codexで開く
                      </a>
                    )}
                  </div>
                )}
                {selectedMessages.map((message, index) => {
                  const previous = index > 0 ? selectedMessages[index - 1] : null
                  return (
                    <React.Fragment key={message.id}>
                      {shouldShowActivityTimeBreak(previous, message) && <ActivityTimeBreak value={message.created_at} />}
                      {selectedCompletedWorkMessageIndex === index && (
                        <ChatCompletedWorkInlineStatus elapsedText={selectedCompletedWorkElapsedText} />
                      )}
                      <ActivityMessageBubble message={message} />
                      {selectedRunningUserMessageIndex === index && (
                        <ChatRunningInlineStatus elapsedText={selectedWorkElapsedText} />
                      )}
                    </React.Fragment>
                  )
                })}
                {selectedSyntheticRunningPromptMessage && (
                  <React.Fragment key={selectedSyntheticRunningPromptMessage.id}>
                    {shouldShowActivityTimeBreak(
                      selectedMessages.at(-1) ?? null,
                      selectedSyntheticRunningPromptMessage,
                    ) && <ActivityTimeBreak value={selectedSyntheticRunningPromptMessage.created_at} />}
                    <ActivityMessageBubble message={selectedSyntheticRunningPromptMessage} />
                    <ChatRunningInlineStatus elapsedText={selectedWorkElapsedText} />
                  </React.Fragment>
                )}
                {selectedUiStatus === "running" && selectedRunningUserMessageIndex < 0 && !selectedSyntheticRunningPromptMessage && (
                  <ChatRunningInlineStatus elapsedText={selectedWorkElapsedText} />
                )}
              </div>
            ) : selectedDetail?.text ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-zinc-500">取得内容</div>
                <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100">
                  {selectedDetail.text}
                </div>
                {selectedUiStatus === "running" && (
                  <ChatRunningInlineStatus elapsedText={selectedWorkElapsedText} />
                )}
              </div>
            ) : !selectedDetail?.loading && !selectedDetail?.error ? (
              <div className="rounded-xl border border-dashed border-[#303030] p-4 text-center text-xs text-zinc-500">
                表示できるチャット内容がありません
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[#303030] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-11 rounded-lg border-[#2d2d2d] bg-[#111111] pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-zinc-500"
                placeholder="チャットを検索"
                aria-label="チャットを検索"
              />
            </div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2 px-1">
              <div className="min-w-0 truncate text-xs font-semibold text-zinc-400">Codexチャット履歴</div>
              <div
                className="flex shrink-0 items-center gap-1.5"
                aria-label={`未配置 ${chatItems.length}件${isFilteringChatItems ? `、表示 ${filteredChatItems.length}件` : ""}`}
              >
                <span className="inline-flex h-6 items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2 text-[11px] font-semibold text-amber-200">
                  未配置 {chatItems.length}件
                </span>
                {isFilteringChatItems && (
                  <span className="inline-flex h-6 items-center rounded-full border border-white/10 bg-white/[0.06] px-2 text-[11px] font-medium text-zinc-300">
                    表示 {filteredChatItems.length}件
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            {filteredChatItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#303030] p-4 text-center text-xs text-zinc-500">
                Codexチャット履歴はありません
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredChatItems.map(item => {
                  const isDragging = draggingChatId === item.id
                  const visualStatus = item.status ?? "awaiting_approval"
                  const uiStatus = getCodexMonitorUiStatus(visualStatus)
                  const statusText = item.statusLabel ?? codexMonitorUiLabel(visualStatus)
                  const threadHref = codexThreadUrl(item.threadId)
                  const updatedLabel = displayUpdatedLabel(item)
                  const workElapsedMs = codexChatImportWorkElapsedMs(item, workNowMs, uiStatus === "running")
                  const workElapsedText = formatAiTaskWorkElapsedMs(workElapsedMs)
                  const workLabel = formatAiTaskWorkLabel(workElapsedMs, uiStatus === "running")
                  return (
                    <div
                      key={item.id}
                      draggable
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group relative flex w-full cursor-grab flex-col gap-1 overflow-visible rounded-lg border px-3 py-2 pl-4 text-left text-zinc-200 transition-all duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 active:cursor-grabbing",
                        codexMonitorCardClass(visualStatus),
                        isDragging && "scale-[0.985] opacity-70 shadow-inner ring-1 ring-sky-400/60",
                      )}
                      data-testid={`codex-chat-import-row-${item.id}`}
                      aria-grabbed={isDragging}
                      onClick={() => handleChatItemClick(item)}
                      onKeyDown={event => {
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        handleChatItemClick(item)
                      }}
                      onDragStart={event => {
                        setDraggingChatId(item.id)
                        onChatDragStateChange?.({ itemId: item.id, title: item.title })
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData(
                          CODEX_CHAT_IMPORT_DRAG_TYPE,
                          encodeCodexChatImportDragPayload({ taskId: item.id, title: item.title, snippet: item.snippet }),
                        )
                        event.dataTransfer.setData("text/plain", item.title)
                        const dragImage = createChatDragImage(item)
                        if (dragImage && typeof event.dataTransfer.setDragImage === "function") {
                          event.dataTransfer.setDragImage(dragImage, 24, 18)
                        }
                      }}
                      onDragEnd={finishChatDrag}
                      title={item.snippet ?? item.title}
                    >
                    {uiStatus === "running" && <CodexMonitorRunningOutline />}
                    <span className={cn("absolute bottom-2 left-0 top-2 w-1 rounded-r-full", codexMonitorAccentClass(visualStatus))} aria-hidden="true" />
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-start gap-1.5">
                        <GitBranch className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500 transition-colors", uiStatus === "running" && "text-emerald-200", isDragging && "text-sky-300")} />
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</div>
                      </div>
                      {updatedLabel && <span className="shrink-0 text-[10px] text-zinc-500">{updatedLabel}</span>}
                    </div>
                    {item.snippet && (
                      <div className="line-clamp-2 text-xs leading-5 text-zinc-500">
                        {item.snippet}
                      </div>
                    )}
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {item.placed && (
                        <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-300">
                          {item.placementLabel}
                        </span>
                      )}
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none", codexMonitorToneClass(visualStatus))}>
                        {uiStatus === "running" && (
                          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                          </span>
                        )}
                        {statusText}
                        {uiStatus === "running" && workElapsedText && (
                          <span className="border-l border-current/25 pl-1 font-mono tabular-nums">{workElapsedText}</span>
                        )}
                      </span>
                      {uiStatus !== "running" && workLabel && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium leading-none text-zinc-500">
                          <Clock className="h-3 w-3" />
                          {workLabel}
                        </span>
                      )}
                      {item.repoPath && (
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] leading-none text-zinc-500" title={item.repoPath}>
                          {repoNameFromPath(item.repoPath)}
                        </span>
                      )}
                    </div>
                    {(threadHref || onDeleteChatItem) && (
                      <div className="mt-1 flex min-h-8 items-end gap-2">
                        {threadHref && (
                          <a
                            href={threadHref}
                            className="inline-flex min-h-8 w-fit items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            onClick={event => openCodexThread(event, threadHref)}
                            draggable={false}
                            aria-label={`Codexで開く ${item.title}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Codexで開く
                          </a>
                        )}
                        {onDeleteChatItem && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-auto h-9 w-9 shrink-0 text-zinc-500 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-red-300"
                            aria-label={`チャットを削除 ${item.title}`}
                            onClick={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              void onDeleteChatItem(item.id)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedChatItem && (
        <div className="flex min-h-12 items-center justify-end border-t border-[#303030] bg-[#171717] px-3 py-2">
          <div className={cn(
            "flex min-w-0 items-center justify-end truncate text-[11px] text-zinc-500 transition-colors",
            draggingChatId && "text-sky-300",
          )}>
            {draggingChatId ? "マップ外で離すとカードに戻ります" : "ドラッグしてノードへ配置"}
          </div>
        </div>
      )}
    </aside>
  )
}
