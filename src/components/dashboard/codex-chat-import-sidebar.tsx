"use client"

import * as React from "react"
import { Archive, ArrowLeft, Bot, Check, ChevronDown, ChevronUp, Clock, ExternalLink, FolderGit2, GitBranch, Loader2, RefreshCw, Settings, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import { useAiHistory } from "@/hooks/useAiHistory"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import {
  buildFallbackCodexDisplaySummary,
  codexDisplaySummarySignature,
  type CodexDisplaySummary,
  type CodexDisplaySummaryInput,
} from "@/lib/codex-display-summary"
import {
  aiHistoryPlacementLabel,
  aiHistoryRepoName,
  aiHistoryStatusLabel,
  aiHistoryWorkTiming,
  formatAiHistoryRelativeTime,
  normalizeAiHistoryRepoPath,
} from "@/lib/ai-history-display"
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
import type { AiHistoryListItem, AiHistoryPlacement, AiHistoryProvider, AiHistoryRepoFilter, AiHistoryScopeFilter } from "@/types/ai-history"

export type CodexChatImportItem = {
  id: string
  historyItemId?: string | null
  sourceTaskId?: string | null
  aiTaskId?: string | null
  title: string
  snippet: string | null
  repoPath: string | null
  repoLabel?: string | null
  worktreePath?: string | null
  threadId?: string | null
  codexOpenUrl?: string | null
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
  workDurationSeconds?: number | null
  workDurationSyncedAt?: string | null
  placed: boolean
}

type CodexChatImportSidebarProps = {
  projectId: string | null
  projectTitle: string
  initialRepoPath?: string | null
  detailItems?: CodexChatImportItem[]
  initialSelectedChatId?: string | null
  onInitialSelectedChatClear?: () => void
  onClose: () => void
  onSelectRepoPath?: (repoPath: string | null) => Promise<void> | void
  onOpenSettings?: () => void
  onChatDragStateChange?: (state: { itemId: string; title: string } | null) => void
  hiddenItemIds?: ReadonlySet<string>
}

type AiHistoryScopeOption = {
  scope: AiHistoryScopeFilter
  repoPath: AiHistoryRepoFilter
  label: string
  title: string
  sourceLabel?: string | null
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
  hydrateRequired: boolean
  hydrateReason: string | null
  detailSyncedAt: string | null
  messageCount: number | null
}

const CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT = 30
const ACTIVITY_DETAIL_PAGE_LIMIT = 30
const ACTIVITY_DETAIL_MAX_PAGES = 6
const ACTIVITY_TIME_BREAK_MIN_GAP_MS = 60 * 60 * 1000
const CHAT_DETAIL_REFRESH_INTERVAL_MS = 5_000
const AI_HISTORY_DETAIL_HYDRATE_POLL_INTERVAL_MS = 3_000
const RUNNING_PROMPT_START_TOLERANCE_MS = 5 * 60 * 1000
const LOCAL_WORK_TIMER_STORAGE_KEY = "focusmap:codex-chat-import:local-work-timers"

const AI_HISTORY_PROVIDER_OPTIONS: Array<{
  provider: AiHistoryProvider
  label: string
  enabled: boolean
}> = [
  { provider: "codex_app", label: "Codex", enabled: true },
  { provider: "claude_code", label: "Claude Code", enabled: false },
  { provider: "antigravity", label: "Antigravity", enabled: false },
]

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

function distinctWorktreePath(repoPath: string | null | undefined, worktreePath: string | null | undefined) {
  const normalizedWorktreePath = normalizeRepoPath(worktreePath ?? "")
  if (!normalizedWorktreePath) return null
  const normalizedRepoPath = normalizeRepoPath(repoPath ?? "")
  return normalizedWorktreePath === normalizedRepoPath ? null : normalizedWorktreePath
}

function mergeSourceLabels(current: string | null | undefined, next: string | null | undefined) {
  const labels: string[] = []
  for (const value of [current, next]) {
    if (!value) continue
    for (const label of value.split("/")) {
      const trimmed = label.trim()
      if (trimmed && !labels.includes(trimmed)) labels.push(trimmed)
    }
  }
  return labels.length > 0 ? labels.join(" / ") : null
}

function aiHistoryToChatImportItem(item: AiHistoryListItem): CodexChatImportItem {
  const visualStatus = item.status === "completed" ? "done" : item.status
  return {
    id: item.id,
    historyItemId: item.id,
    sourceTaskId: item.sourceTaskId,
    aiTaskId: item.linkedAiTaskId,
    title: item.title,
    snippet: item.snippet,
    repoPath: item.repoPath || null,
    repoLabel: item.repoLabel,
    worktreePath: item.worktreePath,
    threadId: item.externalThreadId || null,
    codexOpenUrl: item.codexOpenUrl,
    status: visualStatus,
    projectTitle: null,
    placementLabel: aiHistoryPlacementLabel(item),
    statusLabel: aiHistoryStatusLabel(item.status),
    updatedLabel: formatAiHistoryRelativeTime(item.lastActivityAt),
    sortAt: item.lastActivityAt || item.indexedAt,
    ...aiHistoryWorkTiming(item),
    workDurationSeconds: item.workDurationSeconds,
    workDurationSyncedAt: item.indexedAt,
    placed: item.placement === "mindmap",
  }
}

function chatArchiveIdentityKeys(item: CodexChatImportItem) {
  return Array.from(new Set([
    item.id,
    item.historyItemId ?? undefined,
    item.sourceTaskId ?? undefined,
  ].filter((value): value is string => Boolean(value))))
}

function addKeysToSet(previous: Set<string>, keys: string[]) {
  const next = new Set(previous)
  for (const key of keys) next.add(key)
  return next
}

function removeKeysFromSet(previous: Set<string>, keys: string[]) {
  const next = new Set(previous)
  for (const key of keys) next.delete(key)
  return next
}

function removeRecordKey<T>(previous: Record<string, T>, key: string) {
  if (!(key in previous)) return previous
  const next = { ...previous }
  delete next[key]
  return next
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

type LocalWorkTimer = {
  state: "running" | "finished"
  startedAtMs: number
  finishedAtMs?: number
  elapsedMs?: number
}

function readLocalWorkTimers(): Record<string, LocalWorkTimer> {
  if (typeof window === "undefined") return {}
  try {
    const rawValue = window.sessionStorage.getItem(LOCAL_WORK_TIMER_STORAGE_KEY)
    if (!rawValue) return {}
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const timers: Record<string, LocalWorkTimer> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const record = readRecord(value)
      const startedAtMs = readNumber(record?.startedAtMs)
      if (!key || startedAtMs === null) continue
      const state = record?.state === "finished" ? "finished" : "running"
      const finishedAtMs = readNumber(record?.finishedAtMs)
      const elapsedMs = readNumber(record?.elapsedMs)
      timers[key] = {
        state,
        startedAtMs,
        ...(finishedAtMs !== null ? { finishedAtMs } : {}),
        ...(elapsedMs !== null ? { elapsedMs } : {}),
      }
    }
    return timers
  } catch {
    return {}
  }
}

function writeLocalWorkTimers(timers: Record<string, LocalWorkTimer>) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(LOCAL_WORK_TIMER_STORAGE_KEY, JSON.stringify(timers))
  } catch {
    // Session storage is a display cache only. Ignore quota/private-mode failures.
  }
}

function localWorkTimerKey(item: CodexChatImportItem) {
  return item.id
}

function localWorkElapsedMs(timer: LocalWorkTimer | null | undefined, nowMs: number) {
  if (!timer) return null
  if (timer.state === "finished") {
    if (typeof timer.elapsedMs === "number" && Number.isFinite(timer.elapsedMs)) {
      return Math.max(0, timer.elapsedMs)
    }
    if (typeof timer.finishedAtMs === "number" && Number.isFinite(timer.finishedAtMs)) {
      return Math.max(0, timer.finishedAtMs - timer.startedAtMs)
    }
    return null
  }
  return Math.max(0, nowMs - timer.startedAtMs)
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

function isBrowserDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible"
}

type ChatDetailHydrateState = Pick<ChatDetailState, "hydrateRequired" | "hydrateReason" | "detailSyncedAt" | "messageCount">
type ActivityHydrateState = ChatDetailHydrateState & { hydrateKnown: boolean }

const EMPTY_ACTIVITY_HYDRATE_STATE: ActivityHydrateState = {
  hydrateRequired: false,
  hydrateReason: null,
  detailSyncedAt: null,
  messageCount: null,
  hydrateKnown: false,
}

function readActivityHydrateState(data: unknown): ActivityHydrateState {
  const hydrate = isRecord(data) ? readRecord(data.hydrate) : null
  if (!hydrate) return EMPTY_ACTIVITY_HYDRATE_STATE
  return {
    hydrateRequired: readBoolean(hydrate.required) ?? false,
    hydrateReason: readString(hydrate.reason),
    detailSyncedAt: readString(hydrate.detailSyncedAt),
    messageCount: readNumber(hydrate.messageCount),
    hydrateKnown: true,
  }
}

function readDetailHydrateState(detail: Record<string, unknown> | null): ActivityHydrateState {
  if (!detail) return EMPTY_ACTIVITY_HYDRATE_STATE
  return {
    hydrateRequired: readBoolean(detail.hydrateRequired) ?? false,
    hydrateReason: readString(detail.hydrateReason),
    detailSyncedAt: readString(detail.detailSyncedAt),
    messageCount: readNumber(detail.messageCount),
    hydrateKnown: true,
  }
}

function mergeActivityHydrateState(current: ActivityHydrateState, next: ActivityHydrateState): ActivityHydrateState {
  if (next.hydrateKnown) return next
  if (!current.hydrateKnown) return EMPTY_ACTIVITY_HYDRATE_STATE
  return current
}

function chatDetailHydrateState(state: ActivityHydrateState): ChatDetailHydrateState {
  return {
    hydrateRequired: state.hydrateRequired,
    hydrateReason: state.hydrateReason,
    detailSyncedAt: state.detailSyncedAt,
    messageCount: state.messageCount,
  }
}

function aiHistoryDetailFallbackText(item: CodexChatImportItem, hydrateRequired: boolean) {
  const snippet = sanitizeCodexDisplayText(item.snippet, { maxChars: 1_200, fallback: "" }).text
  if (snippet) return snippet
  if (hydrateRequired) return null
  return "表示できるチャット内容がありません"
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

function formatFinishedAgoLabelFromMs(time: number | null | undefined, nowMs: number) {
  if (typeof time !== "number" || !Number.isFinite(time)) return null
  const diff = Math.max(0, nowMs - time)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}分前`
  if (diff < day) return `${Math.floor(diff / hour)}時間前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}日前`
  return new Date(time).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

function formatFinishedAgoLabel(value: string | null | undefined, nowMs: number) {
  if (!value) return null
  const time = new Date(value).getTime()
  return formatFinishedAgoLabelFromMs(time, nowMs)
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
  status.textContent = "マップへ配置"
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
  if (typeof item.workDurationSeconds === "number" && Number.isFinite(item.workDurationSeconds)) {
    const baseElapsedMs = Math.max(0, item.workDurationSeconds * 1000)
    if (!active) return baseElapsedMs

    const syncedMs = new Date(item.workDurationSyncedAt ?? "").getTime()
    if (!Number.isFinite(syncedMs)) return baseElapsedMs
    return baseElapsedMs + Math.max(0, nowMs - syncedMs)
  }
  return getCodexThreadRallyWorkElapsedMs(item, { nowMs, active })
}

function codexChatImportFinishedAt(item: CodexChatImportItem | null | undefined) {
  return item?.workAwaitingApprovalAt ?? item?.workCompletedAt ?? null
}

function codexChatImportSortTime(item: CodexChatImportItem) {
  const time = new Date(item.sortAt ?? "").getTime()
  return Number.isFinite(time) ? time : 0
}

function codexChatImportSortPriority(item: CodexChatImportItem) {
  const uiStatus = getCodexMonitorUiStatus(item.status ?? null)
  if (uiStatus === "running") return 0
  if (uiStatus === "review") return 1
  if (uiStatus === "unsent") return 2
  if (uiStatus === "connection_failed") return 3
  return 4
}

function compareCodexChatImportItems(left: CodexChatImportItem, right: CodexChatImportItem) {
  const priorityDelta = codexChatImportSortPriority(left) - codexChatImportSortPriority(right)
  if (priorityDelta !== 0) return priorityDelta
  const timeDelta = codexChatImportSortTime(right) - codexChatImportSortTime(left)
  if (timeDelta !== 0) return timeDelta
  return left.id.localeCompare(right.id)
}

function isNormallyHiddenCodexChatImportItem(item: CodexChatImportItem) {
  return getCodexMonitorUiStatus(item.status ?? null) === "done"
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

function completedWorkMessageIndex(
  messages: AiTaskActivityMessage[],
  running: boolean,
  fallbackElapsedMs?: number | null,
) {
  if (running) return -1
  const canUseFallback = typeof fallbackElapsedMs === "number" && Number.isFinite(fallbackElapsedMs)

  let latestUserIndex = -1
  messages.forEach((message, index) => {
    if (isUserActivityMessage(message)) latestUserIndex = index
  })
  if (latestUserIndex < 0) return -1

  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || isStatusActivityMessage(message)) continue
    if (activityMessageWorkElapsedMs(message) !== null || canUseFallback) return index
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

function ChatRunningWorkInlineStatus({ elapsedText }: { elapsedText: string | null }) {
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

function DetailHydrateNotice({
  hydrateRequired,
  canHydrate,
  hasCachedContent,
}: {
  hydrateRequired: boolean
  canHydrate: boolean
  hasCachedContent: boolean
}) {
  if (!hydrateRequired) return null

  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#303030] bg-[#111111] px-2.5 py-1.5 text-[11px] text-zinc-500">
      {canHydrate ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-emerald-300/80" aria-hidden="true" />
      ) : (
        <Clock className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="font-semibold text-zinc-300">
          {canHydrate ? "更新中" : "Macエージェント待ち"}
        </span>
        <span className="ml-1">
          {canHydrate
            ? hasCachedContent
              ? "取得済みの内容を表示したまま詳細本文を更新しています。"
              : "詳細本文を取得しています。"
            : hasCachedContent
              ? "Mac/agent offline のため更新不能です。取得済みの内容を表示しています。"
              : "Mac/agent offline のため更新不能です。"}
        </span>
      </span>
    </div>
  )
}

export function CodexChatImportSidebar({
  projectId,
  projectTitle,
  initialRepoPath = null,
  detailItems = [],
  initialSelectedChatId = null,
  onInitialSelectedChatClear,
  onClose,
  onOpenSettings,
  onChatDragStateChange,
  hiddenItemIds,
}: CodexChatImportSidebarProps) {
  const initialRepoOption = normalizeAiHistoryRepoPath(initialRepoPath)
  const [providerPickerOpen, setProviderPickerOpen] = React.useState(false)
  const [scopePickerOpen, setScopePickerOpen] = React.useState(false)
  const [providerFilter, setProviderFilter] = React.useState<AiHistoryProvider>("codex_app")
  const [historyScope, setHistoryScope] = React.useState<AiHistoryScopeFilter>("global")
  const [repoFilter, setRepoFilter] = React.useState<AiHistoryRepoFilter>("all")
  const [activePlacement, setActivePlacement] = React.useState<AiHistoryPlacement>("unplaced")
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null)
  const [draggingChatId, setDraggingChatId] = React.useState<string | null>(null)
  const [expandedArchiveChatId, setExpandedArchiveChatId] = React.useState<string | null>(null)
  const [archivingChatIds, setArchivingChatIds] = React.useState<Set<string>>(() => new Set())
  const [locallyArchivedChatIds, setLocallyArchivedChatIds] = React.useState<Set<string>>(() => new Set())
  const [archiveErrorByChatId, setArchiveErrorByChatId] = React.useState<Record<string, string>>({})
  const [chatDetailsById, setChatDetailsById] = React.useState<Record<string, ChatDetailState>>({})
  const [collapsedSummaryChatIds, setCollapsedSummaryChatIds] = React.useState<Set<string>>(() => new Set())
  const [aiSummaryByChatId, setAiSummaryByChatId] = React.useState<Record<string, {
    signature: string
    summary: CodexDisplaySummary
    loading: boolean
    source: "ai" | "fallback"
  }>>({})
  const consumedInitialSelectedChatIdRef = React.useRef<string | null>(null)
  const previousInitialRepoPathRef = React.useRef<string | null | undefined>(initialRepoPath)
  const summaryRequestInFlightRef = React.useRef(new Set<string>())
  const hydratePollInFlightRef = React.useRef(false)
  const queryRepoFilter = repoFilter
  const {
    repos: availableRepos,
    isLoading: availableReposLoading,
    refresh: refreshAvailableRepos,
  } = useAvailableRepos()

  const aiHistory = useAiHistory({
    projectId,
    provider: providerFilter,
    scope: historyScope,
    repo: queryRepoFilter,
    placement: activePlacement,
  })
  const historyChatItems = React.useMemo(() => (
    aiHistory.items.map(aiHistoryToChatImportItem)
  ), [aiHistory.items])
  const visibleHistoryChatItems = React.useMemo(() => (
    historyChatItems
      .filter(item => (
        !chatArchiveIdentityKeys(item).some(key => locallyArchivedChatIds.has(key)) &&
        !isNormallyHiddenCodexChatImportItem(item) &&
        !hiddenItemIds?.has(item.id) &&
        !(item.sourceTaskId && hiddenItemIds?.has(item.sourceTaskId))
      ))
      .sort(compareCodexChatImportItems)
  ), [hiddenItemIds, historyChatItems, locallyArchivedChatIds])
  const providerOptions = React.useMemo(() => {
    const byProvider = new Map<string, { provider: AiHistoryProvider; label: string; enabled: boolean }>()
    for (const option of AI_HISTORY_PROVIDER_OPTIONS) byProvider.set(option.provider, option)
    for (const option of aiHistory.sync.providerOptions ?? []) {
      byProvider.set(option.provider, {
        provider: option.provider,
        label: option.label,
        enabled: option.enabled,
      })
    }
    return Array.from(byProvider.values())
  }, [aiHistory.sync.providerOptions])
  const currentProviderLabel = React.useMemo(() => (
    providerOptions.find(option => option.provider === providerFilter)?.label ?? "Codex"
  ), [providerFilter, providerOptions])
  const scopeOptions = React.useMemo(() => {
    const options: AiHistoryScopeOption[] = []
    const seenRepoPaths = new Set<string>()
    const addRepoOption = (input: {
      scope: AiHistoryScopeFilter
      repoPath: string | null | undefined
      label?: string | null
      title?: string | null
      sourceLabel?: string | null
    }) => {
      const repoPath = normalizeAiHistoryRepoPath(input.repoPath)
      if (!repoPath) return
      const existing = options.find(option => option.repoPath === repoPath)
      if (existing) {
        existing.label = existing.label || input.label?.trim() || aiHistoryRepoName(repoPath)
        existing.title = existing.title || input.title?.trim() || repoPath
        existing.sourceLabel = mergeSourceLabels(existing.sourceLabel, input.sourceLabel)
        return
      }
      if (seenRepoPaths.has(repoPath)) return
      seenRepoPaths.add(repoPath)
      options.push({
        scope: input.scope,
        repoPath,
        label: input.label?.trim() || aiHistoryRepoName(repoPath),
        title: input.title?.trim() || repoPath,
        sourceLabel: input.sourceLabel ?? null,
      })
    }
    if (initialRepoOption) {
      const projectRepo = aiHistory.sync.repoOptions
        .map(option => ({
          repoPath: normalizeAiHistoryRepoPath(option.repoPath),
          label: option.label,
        }))
        .find(option => option.repoPath === initialRepoOption)
      addRepoOption({
        scope: "global",
        repoPath: initialRepoOption,
        label: projectRepo?.label || aiHistoryRepoName(initialRepoOption),
        title: initialRepoOption,
        sourceLabel: null,
      })
    }
    for (const option of aiHistory.sync.repoOptions ?? []) {
      addRepoOption({
        scope: "global",
        repoPath: option.repoPath,
        label: option.label,
        title: option.repoPath,
        sourceLabel: null,
      })
    }
    for (const repo of availableRepos.filter(repo => repo.source === "codex")) {
      const threadCount = typeof repo.thread_count === "number" && repo.thread_count > 0
        ? `${repo.thread_count}件`
        : null
      addRepoOption({
        scope: "global",
        repoPath: repo.absolute_path,
        label: repo.display_name,
        title: repo.absolute_path,
        sourceLabel: threadCount ? `Codex ${threadCount}` : null,
      })
    }
    options.push({
      scope: "global",
      repoPath: "all",
      label: "全体",
      title: `${currentProviderLabel}の非アーカイブチャット全体`,
    })
    return options
  }, [aiHistory.sync.repoOptions, availableRepos, currentProviderLabel, initialRepoOption])
  const currentScopeOption = React.useMemo(() => (
    scopeOptions.find(option => option.scope === historyScope && option.repoPath === repoFilter) ??
    scopeOptions.find(option => option.scope === historyScope) ??
    scopeOptions.at(-1)
  ), [historyScope, repoFilter, scopeOptions])
  const selectScopeOption = React.useCallback((option: AiHistoryScopeOption) => {
    setHistoryScope(option.scope)
    setRepoFilter(option.repoPath)
    setScopePickerOpen(false)
    setSelectedChatId(null)
    setChatDetailsById({})
  }, [])
  const aiOnlineLabel = aiHistory.sync.aiOnline ? "AI online" : "AI offline"
  const selectableChatItems = React.useMemo(() => {
    const byId = new Map<string, CodexChatImportItem>()
    for (const item of historyChatItems) byId.set(item.id, item)
    for (const item of historyChatItems) {
      if (item.sourceTaskId) byId.set(item.sourceTaskId, item)
    }
    for (const item of detailItems) byId.set(item.id, item)
    return Array.from(byId.values())
  }, [historyChatItems, detailItems])
  const selectedChatItem = React.useMemo(() => {
    if (!selectedChatId) return null
    return selectableChatItems.find(item => item.id === selectedChatId || item.sourceTaskId === selectedChatId) ?? null
  }, [selectableChatItems, selectedChatId])
  const [localWorkTimers, setLocalWorkTimers] = React.useState<Record<string, LocalWorkTimer>>(() => readLocalWorkTimers())
  const hasLiveWorkTimer = React.useMemo(() => {
    const hasRunningTimer = [...visibleHistoryChatItems, selectedChatItem].some(item => (
      getCodexMonitorUiStatus(item?.status ?? null) === "running"
    ))
    const hasSelectedFinishedAgoTimer = !!selectedChatItem &&
      getCodexMonitorUiStatus(selectedChatItem.status ?? null) === "review" &&
      (!!codexChatImportFinishedAt(selectedChatItem) || !!localWorkTimers[localWorkTimerKey(selectedChatItem)]?.finishedAtMs)
    return hasRunningTimer || hasSelectedFinishedAgoTimer
  }, [visibleHistoryChatItems, localWorkTimers, selectedChatItem])
  const [workNowMs, setWorkNowMs] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (previousInitialRepoPathRef.current === initialRepoPath) return
    previousInitialRepoPathRef.current = initialRepoPath
    setHistoryScope("global")
    setRepoFilter("all")
    setProviderFilter("codex_app")
    setProviderPickerOpen(false)
    setScopePickerOpen(false)
    setSelectedChatId(null)
    setChatDetailsById({})
    onInitialSelectedChatClear?.()
  }, [initialRepoPath, onInitialSelectedChatClear])

  React.useEffect(() => {
    const nowMs = Date.now()
    setLocalWorkTimers(previousTimers => {
      let nextTimers = previousTimers
      let changed = false

      for (const item of selectableChatItems) {
        const key = localWorkTimerKey(item)
        const uiStatus = getCodexMonitorUiStatus(item.status ?? null)
        const current = previousTimers[key]

        if (uiStatus === "running") {
          if (!current || current.state !== "running") {
            if (!changed) nextTimers = { ...previousTimers }
            nextTimers[key] = { state: "running", startedAtMs: nowMs }
            changed = true
          }
          continue
        }

        if (uiStatus === "review" && current?.state === "running") {
          if (!changed) nextTimers = { ...previousTimers }
          nextTimers[key] = {
            state: "finished",
            startedAtMs: current.startedAtMs,
            finishedAtMs: nowMs,
            elapsedMs: Math.max(0, nowMs - current.startedAtMs),
          }
          changed = true
        }
      }

      if (changed) writeLocalWorkTimers(nextTimers)
      return changed ? nextTimers : previousTimers
    })
  }, [selectableChatItems])

  React.useEffect(() => {
    setWorkNowMs(Date.now())
    if (!hasLiveWorkTimer) return
    const intervalId = window.setInterval(() => setWorkNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [hasLiveWorkTimer])

  React.useEffect(() => {
    if (!selectedChatId) return
    if (selectableChatItems.some(item => item.id === selectedChatId || item.sourceTaskId === selectedChatId)) return
    setSelectedChatId(null)
    onInitialSelectedChatClear?.()
  }, [onInitialSelectedChatClear, selectableChatItems, selectedChatId])

  const finishChatDrag = React.useCallback(() => {
    setDraggingChatId(null)
    onChatDragStateChange?.(null)
  }, [onChatDragStateChange])

  React.useEffect(() => {
    if (!draggingChatId) return
    if (selectableChatItems.some(item => item.id === draggingChatId || item.sourceTaskId === draggingChatId)) return
    finishChatDrag()
  }, [draggingChatId, finishChatDrag, selectableChatItems])

  const resolveAiTaskId = React.useCallback((item: CodexChatImportItem) => {
    const directAiTaskId = item.aiTaskId?.trim()
    if (directAiTaskId) return directAiTaskId
    return null
  }, [])
  const displayUpdatedLabel = React.useCallback((item: CodexChatImportItem) => item.updatedLabel, [])
  const fetchChatActivityPage = React.useCallback(async (
    activityUrl: string,
    cursor: { created_at: string; id: string | null } | null = null,
    options: { watch?: boolean } = {},
  ) => {
    const url = new URL(activityUrl, window.location.origin)
    url.searchParams.set("limit", String(ACTIVITY_DETAIL_PAGE_LIMIT))
    url.searchParams.set("mode", "report")
    if (options.watch === true && !cursor) url.searchParams.set("watch", "1")
    if (cursor) {
      url.searchParams.set("before_created_at", cursor.created_at)
      if (cursor.id) url.searchParams.set("before_id", cursor.id)
    }
    const activityRes = await fetchWithSupabaseAuth(`${url.pathname}${url.search}`, { cache: "no-store" })
    const activityData = await activityRes.json().catch(() => ({}))
    if (!activityRes.ok && activityRes.status !== 202) {
      return {
        messages: [] as AiTaskActivityMessage[],
        nextCursor: null,
        hydrate: EMPTY_ACTIVITY_HYDRATE_STATE,
      }
    }
    return {
      messages: readActivityMessages(activityData),
      nextCursor: readActivityNextCursor(activityData),
      hydrate: readActivityHydrateState(activityData),
    }
  }, [])
  const fetchChatActivityMessages = React.useCallback(async (
    activityUrl: string,
    initialHydrate: ActivityHydrateState = EMPTY_ACTIVITY_HYDRATE_STATE,
    options: { watch?: boolean } = {},
  ) => {
    const messages: AiTaskActivityMessage[] = []
    let cursor: { created_at: string; id: string | null } | null = null
    let hasMore = false
    let hydrate = initialHydrate
    for (let page = 0; page < ACTIVITY_DETAIL_MAX_PAGES; page += 1) {
      const activityPage = await fetchChatActivityPage(activityUrl, cursor, { watch: options.watch === true && page === 0 })
      hydrate = mergeActivityHydrateState(hydrate, activityPage.hydrate)
      messages.push(...activityPage.messages)
      const visibleMessages = latestVisibleActivityMessages(messages)
      const allVisibleMessages = visibleActivityMessages(dedupeActivityMessages(messages))
      if (allVisibleMessages.length > CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT) {
        return { messages: visibleMessages, hasMore: true, hydrate }
      }
      if (!activityPage.nextCursor) {
        return { messages: visibleMessages, hasMore: false, hydrate }
      }
      hasMore = true
      cursor = activityPage.nextCursor
      if (allVisibleMessages.length >= CHAT_DETAIL_VISIBLE_MESSAGE_LIMIT) {
        return { messages: visibleMessages, hasMore: true, hydrate }
      }
    }
    return { messages: latestVisibleActivityMessages(messages), hasMore, hydrate }
  }, [fetchChatActivityPage])

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
          hydrateRequired: previous?.hydrateRequired ?? false,
          hydrateReason: previous?.hydrateReason ?? null,
          detailSyncedAt: previous?.detailSyncedAt ?? null,
          messageCount: previous?.messageCount ?? null,
        },
      }
    })

    try {
      if (item.historyItemId) {
        const detailRes = await fetchWithSupabaseAuth(`/api/ai-history/${encodeURIComponent(item.historyItemId)}`, { cache: "no-store" })
        const detailData = await detailRes.json().catch(() => ({}))
        if (!detailRes.ok) {
          const message = isRecord(detailData) && typeof detailData.error === "string"
            ? detailData.error
            : "AI履歴の詳細を取得できませんでした"
          throw new Error(message)
        }
        const detail = isRecord(detailData) ? readRecord(detailData.detail) : null
        const detailHydrate = readDetailHydrateState(detail)
        const activityUrl = readString(detail?.activityUrl) ??
          `/api/ai-history/${encodeURIComponent(item.historyItemId)}/activity`
        const { messages, hasMore, hydrate } = await fetchChatActivityMessages(activityUrl, detailHydrate, { watch: !background })
        if (messages.length > 0) {
          setChatDetailsById(prev => ({
            ...prev,
            [item.id]: {
              loading: false,
              messages,
              text: null,
              hasMore,
              error: null,
              ...chatDetailHydrateState(hydrate),
            },
          }))
          return
        }
        const fallbackText = aiHistoryDetailFallbackText(item, hydrate.hydrateRequired)
        setChatDetailsById(prev => ({
          ...prev,
          [item.id]: {
            loading: false,
            messages: [],
            text: fallbackText,
            hasMore: false,
            error: null,
            ...chatDetailHydrateState(hydrate),
          },
        }))
        return
      }

      const aiTaskId = resolveAiTaskId(item)

      if (aiTaskId) {
        const { messages, hasMore, hydrate } = await fetchChatActivityMessages(`/api/ai-tasks/${encodeURIComponent(aiTaskId)}/activity`)
        if (messages.length > 0) {
          setChatDetailsById(prev => ({
            ...prev,
            [item.id]: {
              loading: false,
              messages,
              text: null,
              hasMore,
              error: null,
              ...chatDetailHydrateState(hydrate),
            },
          }))
          return
        }
      }

      const fallbackRes = await fetchWithSupabaseAuth(`/api/tasks/${encodeURIComponent(item.id)}`)
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
          ...chatDetailHydrateState(EMPTY_ACTIVITY_HYDRATE_STATE),
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
            ...chatDetailHydrateState(EMPTY_ACTIVITY_HYDRATE_STATE),
          },
        }
      })
    }
  }, [fetchChatActivityMessages, resolveAiTaskId])

  const handleChatItemClick = React.useCallback((item: CodexChatImportItem) => {
    setSelectedChatId(item.id)
    setProviderPickerOpen(false)
    setScopePickerOpen(false)
    void loadChatDetail(item)
  }, [loadChatDetail])

  const handleArchiveChatItem = React.useCallback(async (item: CodexChatImportItem) => {
    if (!item.historyItemId) return
    if (expandedArchiveChatId !== item.id) {
      setExpandedArchiveChatId(item.id)
      setArchiveErrorByChatId(previous => removeRecordKey(previous, item.id))
      return
    }

    const archiveKeys = chatArchiveIdentityKeys(item)
    setArchivingChatIds(previous => addKeysToSet(previous, archiveKeys))
    setArchiveErrorByChatId(previous => removeRecordKey(previous, item.id))
    setLocallyArchivedChatIds(previous => addKeysToSet(previous, archiveKeys))
    if (selectedChatId && archiveKeys.includes(selectedChatId)) {
      setSelectedChatId(null)
    }

    try {
      const response = await fetchWithSupabaseAuth(
        `/api/ai-history/${encodeURIComponent(item.historyItemId)}/archive`,
        { method: "POST", cache: "no-store" },
      )
      const data = await response.json().catch(() => ({})) as {
        success?: boolean
        error?: string | { message?: string }
      }
      if (!response.ok || data.success === false) {
        const message = typeof data.error === "string"
          ? data.error
          : data.error?.message
        throw new Error(message || "チャットをアーカイブできませんでした")
      }
      setExpandedArchiveChatId(current => current === item.id ? null : current)
      void aiHistory.refresh({ silent: true })
    } catch (error) {
      setLocallyArchivedChatIds(previous => removeKeysFromSet(previous, archiveKeys))
      setArchiveErrorByChatId(previous => ({
        ...previous,
        [item.id]: error instanceof Error ? error.message : "チャットをアーカイブできませんでした",
      }))
      setExpandedArchiveChatId(item.id)
    } finally {
      setArchivingChatIds(previous => removeKeysFromSet(previous, archiveKeys))
    }
  }, [aiHistory, expandedArchiveChatId, selectedChatId])

  React.useEffect(() => {
    if (!initialSelectedChatId) {
      consumedInitialSelectedChatIdRef.current = null
      return
    }
    if (consumedInitialSelectedChatIdRef.current === initialSelectedChatId) return
    const item = selectableChatItems.find(candidate => candidate.id === initialSelectedChatId || candidate.sourceTaskId === initialSelectedChatId)
    if (!item) return
    consumedInitialSelectedChatIdRef.current = initialSelectedChatId
    setSelectedChatId(item.id)
    setProviderPickerOpen(false)
    setScopePickerOpen(false)
    void loadChatDetail(item)
  }, [initialSelectedChatId, loadChatDetail, selectableChatItems])

  const selectedDetail = selectedChatItem ? chatDetailsById[selectedChatItem.id] : null
  const selectedMessages = codexReportViewMessages(visibleActivityMessages(selectedDetail?.messages ?? []))
  const selectedThreadHref = selectedChatItem?.codexOpenUrl ?? codexThreadUrl(selectedChatItem?.threadId)
  const selectedVisualStatus = selectedChatItem?.status ?? "awaiting_approval"
  const selectedWorktreePath = selectedChatItem
    ? distinctWorktreePath(selectedChatItem.repoPath, selectedChatItem.worktreePath)
    : null
  const selectedUiStatus = getCodexMonitorUiStatus(selectedVisualStatus)
  const selectedCanHydrateDetail = Boolean(
    aiHistory.sync.featureEnabled &&
    aiHistory.sync.aiOnline &&
    aiHistory.sync.agentConnected,
  )
  const selectedStatusText = selectedUiStatus === "review"
    ? "確認待ち"
    : selectedChatItem?.statusLabel ?? codexMonitorUiLabel(selectedVisualStatus)
  const selectedLocalWorkTimer = selectedChatItem
    ? localWorkTimers[localWorkTimerKey(selectedChatItem)] ?? null
    : null
  const selectedLocalWorkElapsedMs = localWorkElapsedMs(selectedLocalWorkTimer, workNowMs)
  const selectedRallyWorkElapsedMs = selectedChatItem
    ? codexChatImportWorkElapsedMs(selectedChatItem, workNowMs, selectedUiStatus === "running")
    : null

  React.useEffect(() => {
    if (!selectedChatItem || selectedUiStatus !== "running") return
    const timer = window.setInterval(() => {
      if (!isBrowserDocumentVisible()) return
      void loadChatDetail(selectedChatItem, { background: true })
    }, CHAT_DETAIL_REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [loadChatDetail, selectedChatItem, selectedUiStatus])

  React.useEffect(() => {
    if (!selectedChatItem || !selectedDetail?.hydrateRequired || !selectedCanHydrateDetail) return
    const poll = async () => {
      if (!isBrowserDocumentVisible()) return
      if (hydratePollInFlightRef.current) return
      hydratePollInFlightRef.current = true
      try {
        await loadChatDetail(selectedChatItem, { background: true })
      } finally {
        hydratePollInFlightRef.current = false
      }
    }
    const timer = window.setInterval(() => {
      void poll()
    }, AI_HISTORY_DETAIL_HYDRATE_POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [loadChatDetail, selectedCanHydrateDetail, selectedChatItem, selectedDetail?.hydrateRequired])

  const selectedCompletedWorkFallbackElapsedMs = selectedUiStatus !== "running"
    ? selectedRallyWorkElapsedMs ?? selectedLocalWorkElapsedMs
    : null
  const selectedCompletedWorkMessageIndex = completedWorkMessageIndex(
    selectedMessages,
    selectedUiStatus === "running",
    selectedCompletedWorkFallbackElapsedMs,
  )
  const selectedCompletedWorkElapsedMs = selectedCompletedWorkMessageIndex >= 0
    ? activityMessageWorkElapsedMs(selectedMessages[selectedCompletedWorkMessageIndex]) ??
      selectedCompletedWorkFallbackElapsedMs
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
    ? selectedRallyWorkElapsedMs ?? selectedLocalWorkElapsedMs ?? selectedRunningWorkElapsedMs
    : selectedCompletedWorkElapsedMs ?? selectedRallyWorkElapsedMs ?? selectedLocalWorkElapsedMs
  const selectedWorkElapsedText = formatAiTaskWorkElapsedMs(selectedWorkElapsedMs)
  const selectedCompletedWorkElapsedText = formatAiTaskWorkElapsedMs(selectedCompletedWorkElapsedMs)
  const selectedFinishedAgoLabel = selectedUiStatus === "review"
    ? formatFinishedAgoLabel(codexChatImportFinishedAt(selectedChatItem), workNowMs) ??
      (selectedLocalWorkTimer?.finishedAtMs
        ? formatFinishedAgoLabelFromMs(selectedLocalWorkTimer.finishedAtMs, workNowMs)
        : null)
    : null
  const selectedStatusTimeLabel = selectedUiStatus === "running"
    ? selectedWorkElapsedText
    : selectedFinishedAgoLabel
  const selectedStatusAriaLabel = [selectedStatusText, selectedStatusTimeLabel].filter(Boolean).join(" ")
  const selectedReviewWorkLabel = selectedUiStatus !== "running"
    ? formatAiTaskWorkLabel(selectedWorkElapsedMs, false)
    : null
  const selectedHasTimelineMessages = selectedMessages.length > 0 || Boolean(selectedSyntheticRunningPromptMessage)
  const selectedHasCachedDetailContent = selectedMessages.length > 0 || Boolean(selectedDetail?.text)
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
  return (
    <aside
      className="flex h-full w-[min(460px,calc(100vw-1.5rem))] flex-col overflow-hidden border border-y-0 border-r-0 border-[#303030] bg-[#171717] text-zinc-100 shadow-2xl shadow-black/40"
      aria-label="AI履歴"
      title={projectTitle}
    >
      {!selectedChatItem && (
        <div className="border-b border-[#303030] bg-[#171717] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-xs font-semibold",
              aiHistory.sync.aiOnline
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.06] text-zinc-400",
            )}>
              {aiOnlineLabel}
            </span>
            <div className="relative min-w-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 max-w-[105px] justify-start gap-1.5 border-[#303030] bg-[#111111] px-2 text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setProviderPickerOpen(open => !open)
                  setScopePickerOpen(false)
                }}
                aria-expanded={providerPickerOpen}
                aria-controls="ai-history-provider-filter"
                title={currentProviderLabel}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="min-w-0 truncate text-xs">{currentProviderLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              </Button>
              {providerPickerOpen && (
                <div
                  id="ai-history-provider-filter"
                  className="absolute right-0 top-full z-20 mt-1 w-48 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-[#303030] bg-[#171717] p-1 shadow-xl shadow-black/40"
                >
                  <div className="max-h-64 overflow-auto">
                    {providerOptions.map(option => {
                      const selected = option.provider === providerFilter
                      return (
                        <button
                          key={option.provider}
                          type="button"
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-300 transition-colors hover:bg-white/10 hover:text-white",
                            selected && "bg-white/10 text-white",
                            !option.enabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-zinc-300",
                          )}
                          disabled={!option.enabled}
                          onClick={() => {
                            setProviderFilter(option.provider)
                            setProviderPickerOpen(false)
                            setSelectedChatId(null)
                            setChatDetailsById({})
                          }}
                          title={option.enabled ? option.label : `${option.label}は未対応`}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {option.label}
                          </span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="relative min-w-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 max-w-[120px] justify-start gap-1.5 border-[#303030] bg-[#111111] px-2 text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setScopePickerOpen(open => !open)
                  setProviderPickerOpen(false)
                }}
                aria-expanded={scopePickerOpen}
                aria-controls="ai-history-scope-filter"
                title={currentScopeOption?.title ?? "全体"}
              >
                <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="min-w-0 truncate text-xs">{currentScopeOption?.label ?? "全体"}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              </Button>
              {scopePickerOpen && (
                <div
                  id="ai-history-scope-filter"
                  className="absolute right-0 top-full z-20 mt-1 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-[#303030] bg-[#171717] p-1 shadow-xl shadow-black/40"
                >
                  <div className="max-h-64 overflow-auto">
                    {scopeOptions.map(option => {
                      const selected = option.scope === historyScope && option.repoPath === repoFilter
                      return (
                        <button
                          key={`${option.scope}:${option.repoPath}`}
                          type="button"
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-300 transition-colors hover:bg-white/10 hover:text-white",
                            selected && "bg-white/10 text-white",
                          )}
                          onClick={() => {
                            selectScopeOption(option)
                          }}
                          title={option.title}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {option.label}
                          </span>
                          {option.sourceLabel && (
                            <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                              {option.sourceLabel}
                            </span>
                          )}
                          {selected ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:ring-zinc-500/70"
              onClick={() => {
                void Promise.allSettled([
                  aiHistory.refresh(),
                  refreshAvailableRepos(),
                ])
              }}
              disabled={aiHistory.isLoading || availableReposLoading}
              aria-label="AI履歴を更新"
              title="更新"
            >
              <RefreshCw className={cn("h-4 w-4", (aiHistory.isLoading || availableReposLoading) && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:ring-zinc-500/70"
              onClick={() => {
                if (onOpenSettings) {
                  onOpenSettings()
                  return
                }
                if (typeof window !== "undefined") window.location.assign("/dashboard/settings/automation")
              }}
              aria-label="AI履歴設定"
              title="AI履歴設定"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:ring-zinc-500/70"
              onClick={onClose}
              aria-label="AI履歴を閉じる"
              title="閉じる"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(
                "h-10 rounded-md text-sm font-semibold transition-colors",
                activePlacement === "unplaced"
                  ? "bg-amber-400 text-zinc-950 shadow-[0_8px_18px_rgba(245,158,11,0.18)]"
                  : "bg-white/[0.06] text-zinc-300 hover:bg-white/10 hover:text-white",
              )}
              onClick={() => setActivePlacement("unplaced")}
            >
              未配置 {aiHistory.counts.unplaced}件
            </button>
            <button
              type="button"
              className={cn(
                "h-10 rounded-md text-sm font-semibold transition-colors",
                activePlacement === "mindmap"
                  ? "bg-amber-400 text-zinc-950 shadow-[0_8px_18px_rgba(245,158,11,0.18)]"
                  : "bg-white/[0.06] text-zinc-300 hover:bg-white/10 hover:text-white",
              )}
              onClick={() => setActivePlacement("mindmap")}
            >
              マインドマップ
            </button>
          </div>
          {aiHistory.error && (
            <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
              {aiHistory.error}
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
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium leading-none text-zinc-400" title={selectedChatItem.repoPath}>
                          <span className="text-zinc-500">repo</span>
                          <span className="truncate">{selectedChatItem.repoLabel || repoNameFromPath(selectedChatItem.repoPath)}</span>
                        </span>
                      )}
                      {selectedWorktreePath && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[11px] font-medium leading-none text-amber-200" title={selectedWorktreePath}>
                          <span className="text-amber-300/75">実行</span>
                          <span className="truncate">{repoNameFromPath(selectedWorktreePath)}</span>
                        </span>
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
                  <span
                    className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold leading-none", codexMonitorToneClass(selectedVisualStatus))}
                    aria-label={selectedStatusAriaLabel || undefined}
                  >
                    {selectedUiStatus === "running" && (
                      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                      </span>
                    )}
                    <span className="truncate">{selectedStatusText}</span>
                    {selectedStatusTimeLabel && (
                      <span className="border-l border-current/25 pl-1 font-mono tabular-nums">{selectedStatusTimeLabel}</span>
                    )}
                  </span>
                  {selectedReviewWorkLabel && (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium leading-none text-zinc-400">
                      <Clock className="h-3 w-3" />
                      <span className="truncate">{selectedReviewWorkLabel}</span>
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

            <DetailHydrateNotice
              hydrateRequired={selectedDetail?.hydrateRequired === true}
              canHydrate={selectedCanHydrateDetail}
              hasCachedContent={selectedHasCachedDetailContent}
            />

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
                        <ChatRunningWorkInlineStatus elapsedText={selectedWorkElapsedText} />
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
                    <ChatRunningWorkInlineStatus elapsedText={selectedWorkElapsedText} />
                  </React.Fragment>
                )}
                {selectedUiStatus === "running" && selectedRunningUserMessageIndex < 0 && !selectedSyntheticRunningPromptMessage && (
                  <ChatRunningWorkInlineStatus elapsedText={selectedWorkElapsedText} />
                )}
              </div>
            ) : selectedDetail?.text ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-zinc-500">取得内容</div>
                <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100">
                  {selectedDetail.text}
                </div>
                {selectedUiStatus === "running" && (
                  <ChatRunningWorkInlineStatus elapsedText={selectedWorkElapsedText} />
                )}
              </div>
            ) : !selectedDetail?.loading && !selectedDetail?.error ? (
              <div className="rounded-xl border border-dashed border-[#303030] p-4 text-center text-xs text-zinc-500">
                {selectedDetail?.hydrateRequired
                  ? selectedCanHydrateDetail
                    ? "Macエージェントが本文を取得するとここに表示されます"
                    : "取得済みの詳細本文はまだありません。Macエージェントがonlineになると更新できます。"
                  : "表示できるチャット内容がありません"}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            {aiHistory.isLoading && visibleHistoryChatItems.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#303030] bg-[#111111] px-3 py-2 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI履歴を取得中
              </div>
            ) : visibleHistoryChatItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#303030] p-4 text-center text-xs text-zinc-500">
                AI履歴はありません
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleHistoryChatItems.map(item => {
                  const dragTaskId = item.sourceTaskId?.trim() || (item.placed ? item.id : "")
                  const dragHistoryItemId = item.historyItemId?.trim() || (!dragTaskId ? item.id : "")
                  const canDragToMindMap = Boolean(dragTaskId || dragHistoryItemId)
                  const isDragging = draggingChatId === item.id
                  const visualStatus = item.status ?? "awaiting_approval"
                  const uiStatus = getCodexMonitorUiStatus(visualStatus)
                  const statusText = item.statusLabel ?? codexMonitorUiLabel(visualStatus)
                  const threadHref = item.codexOpenUrl ?? codexThreadUrl(item.threadId)
                  const updatedLabel = displayUpdatedLabel(item)
                  const itemLocalWorkTimer = localWorkTimers[localWorkTimerKey(item)] ?? null
                  const itemLocalWorkElapsedMs = localWorkElapsedMs(itemLocalWorkTimer, workNowMs)
                  const itemRallyWorkElapsedMs = codexChatImportWorkElapsedMs(item, workNowMs, uiStatus === "running")
                  const workElapsedMs = itemRallyWorkElapsedMs ?? itemLocalWorkElapsedMs
                  const workElapsedText = formatAiTaskWorkElapsedMs(workElapsedMs)
                  const workLabel = formatAiTaskWorkLabel(workElapsedMs, uiStatus === "running")
                  const itemWorktreePath = distinctWorktreePath(item.repoPath, item.worktreePath)
                  const archiveExpanded = expandedArchiveChatId === item.id
                  const archiveBusy = chatArchiveIdentityKeys(item).some(key => archivingChatIds.has(key))
                  const archiveError = archiveErrorByChatId[item.id] ?? null
                  return (
                    <div
                      key={item.id}
                      draggable={canDragToMindMap}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group relative flex w-full flex-col gap-1 overflow-visible rounded-lg border px-3 py-2 pl-4 text-left text-zinc-200 transition-all duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
                        canDragToMindMap ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
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
                        if (!canDragToMindMap) {
                          event.preventDefault()
                          return
                        }
                        setDraggingChatId(item.id)
                        onChatDragStateChange?.({ itemId: item.id, title: item.title })
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData(
                          CODEX_CHAT_IMPORT_DRAG_TYPE,
                          encodeCodexChatImportDragPayload({
                            taskId: dragTaskId || undefined,
                            historyItemId: dragHistoryItemId || undefined,
                            title: item.title,
                            snippet: item.snippet,
                          }),
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
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] leading-none text-zinc-500" title={item.repoPath}>
                          <span className="text-zinc-600">repo</span>
                          <span className="truncate">{item.repoLabel || repoNameFromPath(item.repoPath)}</span>
                        </span>
                      )}
                      {itemWorktreePath && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] leading-none text-amber-200" title={itemWorktreePath}>
                          <span className="text-amber-300/75">実行</span>
                          <span className="truncate">{repoNameFromPath(itemWorktreePath)}</span>
                        </span>
                      )}
                    </div>
                    {(threadHref || item.historyItemId) && (
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
                        {item.historyItemId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "ml-auto h-8 shrink-0 overflow-hidden border border-white/10 bg-white/[0.04] text-zinc-400 transition-[width,background-color,border-color,color] duration-150 hover:border-amber-300/30 hover:bg-amber-400/10 hover:text-amber-100 focus-visible:ring-amber-300/40 disabled:cursor-wait disabled:opacity-70",
                              archiveExpanded
                                ? "w-[168px] justify-start gap-1.5 px-3 text-[11px] font-semibold text-amber-100"
                                : "w-8 px-0",
                            )}
                            aria-label={archiveExpanded ? `チャットをアーカイブ ${item.title}` : `アーカイブ操作を開く ${item.title}`}
                            aria-pressed={archiveExpanded}
                            title={archiveExpanded ? "チャットをアーカイブ" : "アーカイブ"}
                            disabled={archiveBusy}
                            onClick={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              void handleArchiveChatItem(item)
                            }}
                            onMouseDown={event => event.stopPropagation()}
                          >
                            {archiveBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" />
                            )}
                            {archiveExpanded && (
                              <span className="whitespace-nowrap">
                                {archiveBusy ? "アーカイブ中" : "チャットをアーカイブ"}
                              </span>
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                    {archiveError && (
                      <div className="text-[10px] leading-4 text-rose-300">
                        {archiveError}
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
            {draggingChatId ? "マップ外で離すとカードに戻ります" : "ドラッグしてマインドマップへ配置"}
          </div>
        </div>
      )}
    </aside>
  )
}
