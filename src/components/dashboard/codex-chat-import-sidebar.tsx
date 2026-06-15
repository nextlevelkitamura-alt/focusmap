"use client"

import * as React from "react"
import { ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink, FolderGit2, FolderOpen, GitBranch, Loader2, RefreshCw, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import { useCodexRunnerStatus } from "@/hooks/useCodexRunnerStatus"
import {
  CODEX_CHAT_IMPORT_DRAG_TYPE,
  encodeCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd"
import {
  codexMonitorAccentClass,
  codexMonitorCardClass,
  codexMonitorToneClass,
  codexMonitorUiLabel,
  codexThreadUrl,
  getCodexMonitorUiStatus,
} from "@/lib/task-progress-ui"
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
}

type DesktopFolderPickerResult = {
  ok?: boolean
  path?: string
  canceled?: boolean
  error?: string
}

type FocusmapDesktopFolderBridge = {
  chooseFolder?: () => Promise<DesktopFolderPickerResult>
  openExternal?: (url: string) => Promise<unknown>
}

type ChatDetailState = {
  loading: boolean
  messages: AiTaskActivityMessage[]
  text: string | null
  error: string | null
}

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

function focusmapDesktopFolderBridge() {
  if (typeof window === "undefined") return null
  return (window as Window & { focusmapDesktop?: FocusmapDesktopFolderBridge }).focusmapDesktop ?? null
}

function canUseServerFolderPicker() {
  if (typeof window === "undefined") return false
  const { hostname } = window.location
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".trycloudflare.com")
}

function readTaskDetailText(data: unknown, fallback: string | null) {
  const task = (data as { task?: { memo?: unknown; title?: unknown } } | null)?.task
  const memo = typeof task?.memo === "string" ? task.memo.trim() : ""
  if (memo) return memo
  const title = typeof task?.title === "string" ? task.title.trim() : ""
  if (title) return title
  return fallback?.trim() || "詳細はありません"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readActivityMessages(data: unknown): AiTaskActivityMessage[] {
  const rawMessages = isRecord(data) && Array.isArray(data.messages) ? data.messages : []
  return rawMessages.flatMap((rawMessage, index): AiTaskActivityMessage[] => {
    if (!isRecord(rawMessage)) return []
    const body = typeof rawMessage.body === "string" ? rawMessage.body.trim() : ""
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

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です|Codex セッションは確認待ちです/u.test(value.trim())
}

function visibleActivityMessages(messages: AiTaskActivityMessage[]) {
  return messages.filter(message => !isGenericCodexPulseText(message.body) && !isStatusActivityMessage(message))
}

function latestVisibleActivityAt(messages: AiTaskActivityMessage[]) {
  let latestAt: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const message of visibleActivityMessages(messages)) {
    const time = new Date(message.created_at).getTime()
    if (!Number.isFinite(time) || time <= latestMs) continue
    latestAt = message.created_at
    latestMs = time
  }
  return latestAt
}

function newerActivityAt(current: string | null | undefined, next: string | null | undefined) {
  if (!next) return current ?? null
  if (!current) return next
  const currentTime = new Date(current).getTime()
  const nextTime = new Date(next).getTime()
  if (!Number.isFinite(nextTime)) return current
  if (!Number.isFinite(currentTime)) return next
  return nextTime > currentTime ? next : current
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

function activityLabel(message: AiTaskActivityMessage) {
  if (message.role === "user" || message.kind === "sent" || message.kind === "user_answer") return "送信内容"
  return "Codexの返答"
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

function isUserActivityMessage(message: AiTaskActivityMessage) {
  return message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
}

function isStatusActivityMessage(message: AiTaskActivityMessage) {
  return message.role === "status" || message.role === "system"
}

function compactSummaryText(value: string) {
  return value
    .replace(/[`*_#>\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function summarySentences(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\n。！？!?]+/u)
    .map(line => compactSummaryText(line))
    .filter(line => line.length >= 3)
}

function pushSummaryItem(items: string[], value: string | null | undefined, maxItems = 3) {
  if (items.length >= maxItems) return
  const text = compactSummaryText(value ?? "")
  if (!text || items.includes(text)) return
  items.push(text)
}

function collectSummaryItems(
  sources: string[],
  matcher: RegExp,
  maxItems = 3,
) {
  const items: string[] = []
  for (const source of sources) {
    for (const sentence of summarySentences(source)) {
      if (!matcher.test(sentence)) continue
      pushSummaryItem(items, sentence, maxItems)
      if (items.length >= maxItems) return items
    }
  }
  return items
}

type CodexChatAiSummary = {
  done: string
  next: string
  change: string
}

function buildCodexChatSummary(
  item: CodexChatImportItem,
  messages: AiTaskActivityMessage[],
  detailText: string | null | undefined,
): CodexChatAiSummary {
  const visibleMessages = visibleActivityMessages(messages)
  const codexTexts = visibleMessages
    .filter(message => !isUserActivityMessage(message))
    .map(message => message.body)
  const userTexts = visibleMessages
    .filter(isUserActivityMessage)
    .map(message => message.body)
  const allTexts = [...codexTexts, detailText ?? "", item.snippet ?? "", item.title].filter(Boolean)
  const uiStatus = getCodexMonitorUiStatus(item.status ?? "awaiting_approval")

  const doneItems = collectSummaryItems(
    allTexts,
    /確認|整理|修正|追加|実装|反映|保存|更新|通り|完了|削除|戻し|テスト|lint|型チェック|ステージ|コミット|デプロイ/u,
  )
  if (doneItems.length === 0 && userTexts.length > 0) pushSummaryItem(doneItems, userTexts[0], 1)
  if (doneItems.length === 0) pushSummaryItem(doneItems, "チャット内容を確認", 1)

  const changeItems = collectSummaryItems(
    allTexts,
    /方針|判断|仕様|変更|差分|原因|対象|状態|確認待ち|配置|表示|維持|戻す|優先/u,
  )
  if (changeItems[0] === doneItems[0]) changeItems.shift()
  if (changeItems.length === 0) pushSummaryItem(changeItems, "表示と配置を整理", 1)

  const nextItems = collectSummaryItems(
    [...codexTexts].reverse(),
    /次|確認|再確認|残|必要|TODO|レビュー|判断|ノード|配置|コミット|デプロイ|API|差分/u,
  )
  if (nextItems[0] === doneItems[0] || nextItems[0] === changeItems[0]) nextItems.shift()
  if (!item.placed) pushSummaryItem(nextItems, "ノード化の要否", 1)
  if (uiStatus === "review") pushSummaryItem(nextItems, "確認待ちの内容", 1)
  if (uiStatus === "running") pushSummaryItem(nextItems, "完了後の差分", 1)
  if (nextItems.length === 0) pushSummaryItem(nextItems, "原文ログ", 1)

  const done = doneItems[0] ?? "チャット内容を確認"
  const change = changeItems[0] ?? "表示と配置を整理"
  const next = nextItems[0] ?? "原文ログ"
  return { done, next, change }
}

function CodexChatAiSummaryRow({
  summary,
  collapsed,
  onToggleCollapsed,
  loading,
}: {
  summary: CodexChatAiSummary | null
  collapsed: boolean
  onToggleCollapsed: () => void
  loading?: boolean
}) {
  if (!summary) return null

  const rows = [
    { label: "ここで何をやったのか", value: summary.done },
    { label: "次に確認すること", value: summary.next },
    { label: "変更", value: summary.change },
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
      {collapsed ? (
        <p className="min-w-0 break-words text-[12px] leading-relaxed text-zinc-300 line-clamp-1">
          <span className="mr-2 font-semibold text-zinc-500">次に確認すること</span>
          {summary.next}
        </p>
      ) : (
        <dl className="min-w-0 divide-y divide-[#303030]/80">
          {rows.map(row => (
            <div key={row.label} className="grid min-w-0 grid-cols-[7.75rem_minmax(0,1fr)] gap-3 py-2 first:pt-1.5">
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
  const timeLabel = formatActivityTime(message.created_at)

  return (
    <article className={cn("flex", isUserMessage && "justify-end")}>
      <div className={cn(
        "flex min-w-0 flex-col gap-1.5",
        isUserMessage ? "max-w-[82%] items-end" : "w-full",
      )}>
        {(!isUserMessage || timeLabel) && (
          <div className={cn(
            "flex max-w-full items-center gap-2 text-[11px] text-zinc-500",
            isUserMessage && "justify-end",
          )}>
            {!isUserMessage && <span className="shrink-0 font-medium text-zinc-400">{activityLabel(message)}</span>}
            {timeLabel && <span className="truncate">{timeLabel}</span>}
          </div>
        )}
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-[15px] leading-7",
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
  onPlaceChatItem,
  onReturnPlacedChatItem,
  onChatDragStateChange,
}: CodexChatImportSidebarProps) {
  const [pickerPending, setPickerPending] = React.useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false)
  const [repoError, setRepoError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null)
  const [chatDetailsById, setChatDetailsById] = React.useState<Record<string, ChatDetailState>>({})
  const [linkedAiTaskIdsBySourceId, setLinkedAiTaskIdsBySourceId] = React.useState<Record<string, string>>({})
  const [latestChatActivityAtById, setLatestChatActivityAtById] = React.useState<Record<string, string>>({})
  const [placingPending, setPlacingPending] = React.useState(false)
  const [returningPending, setReturningPending] = React.useState(false)
  const [draggingChatId, setDraggingChatId] = React.useState<string | null>(null)
  const [collapsedSummaryChatIds, setCollapsedSummaryChatIds] = React.useState<Set<string>>(() => new Set())
  const backgroundSyncedChatIdsRef = React.useRef(new Set<string>())
  const consumedInitialSelectedChatIdRef = React.useRef<string | null>(null)
  const { repos, isLoading, error: reposError, refresh, requestRescan } = useAvailableRepos()
  const codexRunnerStatus = useCodexRunnerStatus()

  const currentRepoPath = normalizeRepoPath(selectedRepoPath ?? "")
  const hasRepoPath = currentRepoPath.length > 0
  const isBusy = importPending || pickerPending
  const runnerUnavailable = !codexRunnerStatus.ready
  const runnerUnavailableMessage = codexRunnerStatus.loading || !codexRunnerStatus.checked
    ? "Macの通信状態を確認中です。確認後にリポ監視を切り替えられます"
    : "Macがオンラインではありません。Focusmap Macを起動するとリポ監視を切り替えられます"
  const currentRepoLabel = repos.find(repo => repo.absolute_path === currentRepoPath)?.display_name || repoNameFromPath(currentRepoPath)
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
  const displayUpdatedLabel = React.useCallback((item: CodexChatImportItem) => {
    const latestActivityAt = latestChatActivityAtById[item.id]
    return latestActivityAt ? formatActivityTime(latestActivityAt) || item.updatedLabel : item.updatedLabel
  }, [latestChatActivityAtById])
  const rememberLatestChatActivityAt = React.useCallback((itemId: string, messages: AiTaskActivityMessage[]) => {
    const latestAt = latestVisibleActivityAt(messages)
    if (!latestAt) return null
    setLatestChatActivityAtById(prev => {
      const nextAt = newerActivityAt(prev[itemId], latestAt)
      if (!nextAt || nextAt === prev[itemId]) return prev
      return { ...prev, [itemId]: nextAt }
    })
    return latestAt
  }, [])
  const fetchChatActivityMessages = React.useCallback(async (aiTaskId: string) => {
    const activityRes = await fetch(`/api/ai-tasks/${encodeURIComponent(aiTaskId)}/activity`, { cache: "no-store" })
    const activityData = await activityRes.json().catch(() => ({}))
    if (!activityRes.ok) return []
    return readActivityMessages(activityData)
  }, [])

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

  const chooseFolder = React.useCallback(async () => {
    setPickerPending(true)
    setRepoError(null)
    try {
      const bridge = focusmapDesktopFolderBridge()
      if (bridge?.chooseFolder) {
        const data = await bridge.chooseFolder()
        if (data?.canceled) return
        if (!data?.ok || typeof data.path !== "string") {
          setRepoError(data?.error || "Finderでリポフォルダを選択できませんでした")
          return
        }
        const normalized = normalizeRepoPath(data.path)
        await selectRepoPath(normalized || null)
        return
      }

      if (!canUseServerFolderPicker()) {
        setRepoError("Finder選択はMacアプリ更新後に利用できます。候補から選択してください")
        return
      }

      const res = await fetch("/api/codex/choose-folder")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error && data.error !== "canceled") setRepoError(String(data.error))
        return
      }
      if (typeof data?.path === "string") {
        const normalized = normalizeRepoPath(data.path)
        await selectRepoPath(normalized || null)
      }
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Finderを開けませんでした")
    } finally {
      setPickerPending(false)
    }
  }, [selectRepoPath])

  const handleToggleImport = React.useCallback(async () => {
    if (!hasRepoPath || isBusy) {
      if (!hasRepoPath) setRepoError("対象リポを選択してからONにできます")
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
  }, [hasRepoPath, isBusy, onToggleImport, runnerUnavailable, runnerUnavailableMessage])

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

  const refreshChatActivityTime = React.useCallback(async (item: CodexChatImportItem) => {
    const aiTaskId = await syncChatActivity(item)
    if (!aiTaskId) return
    const messages = await fetchChatActivityMessages(aiTaskId)
    rememberLatestChatActivityAt(item.id, messages)
  }, [fetchChatActivityMessages, rememberLatestChatActivityAt, syncChatActivity])

  const loadChatDetail = React.useCallback(async (item: CodexChatImportItem) => {
    setChatDetailsById(prev => ({
      ...prev,
      [item.id]: {
        loading: true,
        messages: prev[item.id]?.messages ?? [],
        text: prev[item.id]?.text ?? null,
        error: null,
      },
    }))

    let aiTaskId = resolveAiTaskId(item)
    try {
      try {
        aiTaskId = await syncChatActivity(item) || aiTaskId
      } catch {
        // ローカルMacが使えない環境でも、既にDBへ保存済みのactivityは表示する。
      }

      if (aiTaskId) {
        const messages = await fetchChatActivityMessages(aiTaskId)
        rememberLatestChatActivityAt(item.id, messages)
        if (messages.length > 0) {
          setChatDetailsById(prev => ({
            ...prev,
            [item.id]: { loading: false, messages, text: null, error: null },
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
          error: null,
        },
      }))
    } catch (error) {
      setChatDetailsById(prev => ({
        ...prev,
        [item.id]: {
          loading: false,
          messages: [],
          text: null,
          error: error instanceof Error ? error.message : "チャット詳細を取得できませんでした",
        },
      }))
    }
  }, [fetchChatActivityMessages, rememberLatestChatActivityAt, resolveAiTaskId, syncChatActivity])

  React.useEffect(() => {
    if (!codexRunnerStatus.ready || chatItems.length === 0) return
    const timers: number[] = []
    for (const [index, item] of chatItems.slice(0, 20).entries()) {
      if (backgroundSyncedChatIdsRef.current.has(item.id)) continue
      backgroundSyncedChatIdsRef.current.add(item.id)
      const timer = window.setTimeout(() => {
        void refreshChatActivityTime(item).catch(() => undefined)
      }, index * 250)
      timers.push(timer)
    }
    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [chatItems, codexRunnerStatus.ready, refreshChatActivityTime])

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

  const handlePlaceSelectedChatItem = React.useCallback(async () => {
    if (!selectedChatItem || !onPlaceChatItem || placingPending) return
    setPlacingPending(true)
    try {
      await onPlaceChatItem(selectedChatItem.id)
      setSelectedChatId(null)
    } finally {
      setPlacingPending(false)
    }
  }, [onPlaceChatItem, placingPending, selectedChatItem])

  const handleReturnSelectedChatItem = React.useCallback(async () => {
    if (!selectedChatItem || !onReturnPlacedChatItem || returningPending) return
    setReturningPending(true)
    try {
      await onReturnPlacedChatItem(selectedChatItem.id)
      setSelectedChatId(null)
    } finally {
      setReturningPending(false)
    }
  }, [onReturnPlacedChatItem, returningPending, selectedChatItem])

  const selectedDetail = selectedChatItem ? chatDetailsById[selectedChatItem.id] : null
  const selectedMessages = visibleActivityMessages(selectedDetail?.messages ?? [])
  const selectedThreadHref = codexThreadUrl(selectedChatItem?.threadId)
  const selectedUpdatedLabel = selectedChatItem ? displayUpdatedLabel(selectedChatItem) : null
  const selectedSummary = selectedChatItem
    ? buildCodexChatSummary(selectedChatItem, selectedDetail?.messages ?? [], selectedDetail?.text)
    : null
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
              <span className="min-w-0 truncate text-[11px] text-zinc-500" title={hasRepoPath ? currentRepoPath : undefined}>
                {hasRepoPath ? currentRepoLabel : "リポ未選択"}
              </span>
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
              disabled={!hasRepoPath || isBusy || runnerUnavailable}
              aria-label="リポ監視"
              title={runnerUnavailable ? runnerUnavailableMessage : undefined}
              className="h-6 w-10 shrink-0 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700 [&>span]:h-5 [&>span]:w-5 [&>span[data-state=checked]]:translate-x-4"
            />
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
                <span className="ml-1.5 text-xs">既存リポ選択</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-[#303030] bg-[#111111] px-2 text-zinc-200 hover:bg-white/10 hover:text-white"
                onClick={chooseFolder}
                disabled={isBusy}
                aria-label="Finderでリポフォルダを選択"
                title="Finderでリポフォルダを選択"
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
                {repos.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-zinc-500">
                    リポ候補がありません
                  </div>
                ) : (
                  repos.slice(0, 8).map(repo => {
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
                        <span className="shrink-0 text-[10px] text-zinc-500">agent</span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

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
                      <span className={cn(
                        "rounded-full px-2 py-1 text-[11px] font-medium leading-none",
                        selectedChatItem.placed ? "bg-emerald-400/10 text-emerald-300" : "bg-sky-400/10 text-sky-300",
                      )}>
                        {selectedChatItem.placementLabel}
                      </span>
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
                  <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold leading-none", codexMonitorToneClass(selectedChatItem.status ?? "awaiting_approval"))}>
                    {getCodexMonitorUiStatus(selectedChatItem.status ?? "awaiting_approval") === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span className="truncate">{selectedChatItem.statusLabel ?? codexMonitorUiLabel(selectedChatItem.status ?? "awaiting_approval")}</span>
                  </span>
                </div>

              </div>
            </div>
            <CodexChatAiSummaryRow
              summary={selectedSummary}
              collapsed={selectedSummaryCollapsed}
              onToggleCollapsed={toggleSelectedSummaryCollapsed}
              loading={selectedDetail?.loading}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5">
            {selectedDetail?.loading && selectedMessages.length === 0 && !selectedDetail.text ? (
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

            {selectedDetail?.loading && selectedMessages.length > 0 ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#303030] bg-[#111111] px-2 py-1.5 text-[11px] text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                最新内容を取得中
              </div>
            ) : null}

            {selectedMessages.length > 0 ? (
              <div className="space-y-5">
                {selectedMessages.map(message => <ActivityMessageBubble key={message.id} message={message} />)}
              </div>
            ) : selectedDetail?.text ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-zinc-500">取得内容</div>
                <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-100">
                  {selectedDetail.text}
                </div>
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            <div className="mb-2 px-1 text-xs font-semibold text-zinc-400">Codexチャット履歴</div>
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
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                        item.placed ? "bg-emerald-400/10 text-emerald-300" : "bg-sky-400/10 text-sky-300",
                      )}>
                        {item.placementLabel}
                      </span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none", codexMonitorToneClass(visualStatus))}>
                        {uiStatus === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {statusText}
                      </span>
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

      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2 border-t border-[#303030] bg-[#171717] p-3">
        <Button type="button" variant="outline" className="h-11 min-w-0 border-[#303030] bg-[#111111] text-zinc-200 hover:bg-white/10 hover:text-white" onClick={onClose}>
          閉じる
        </Button>
        {selectedChatItem && !selectedChatItem.placed ? (
          <Button
            type="button"
            className="h-11 min-w-0 bg-white text-zinc-950 shadow-[0_10px_30px_rgba(255,255,255,0.12)] hover:bg-zinc-200"
            onClick={() => void handlePlaceSelectedChatItem()}
            disabled={!onPlaceChatItem || placingPending}
          >
            {placingPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
            ノードへ配置
          </Button>
        ) : selectedChatItem ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 min-w-0 border-amber-400/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/18 hover:text-amber-50"
            onClick={() => void handleReturnSelectedChatItem()}
            disabled={!onReturnPlacedChatItem || returningPending}
          >
            {returningPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowLeft className="mr-1.5 h-4 w-4" />}
            履歴へ戻す
          </Button>
        ) : (
          <div className={cn(
            "flex min-w-0 items-center justify-end truncate text-[11px] text-zinc-500 transition-colors",
            draggingChatId && "text-sky-300",
          )}>
            {draggingChatId ? "マップ外で離すとカードに戻ります" : "ドラッグしてノードへ配置"}
          </div>
        )}
      </div>
    </aside>
  )
}
