"use client"

import * as React from "react"
import { ArrowLeft, Check, FolderGit2, FolderOpen, GitBranch, Loader2, RefreshCw, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import { useCodexRunnerStatus } from "@/hooks/useCodexRunnerStatus"
import {
  CODEX_CHAT_IMPORT_DRAG_TYPE,
  encodeCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd"
import { cn } from "@/lib/utils"
import type { AiTaskActivityKind, AiTaskActivityMessage, AiTaskActivityRole } from "@/types/ai-task"

export type CodexChatImportItem = {
  id: string
  aiTaskId?: string | null
  title: string
  snippet: string | null
  repoPath: string | null
  threadId?: string | null
  projectTitle: string | null
  placementLabel: string
  statusLabel: string | null
  updatedLabel: string | null
  placed: boolean
}

type CodexChatImportSidebarProps = {
  projectTitle: string
  selectedRepoPath: string | null
  importEnabled: boolean
  importOwnerLabel?: string | null
  importPending?: boolean
  chatItems: CodexChatImportItem[]
  onClose: () => void
  onSelectRepoPath: (repoPath: string | null) => Promise<void> | void
  onToggleImport: () => Promise<void> | void
  onDeleteChatItem?: (taskId: string) => Promise<void> | void
  onPlaceChatItem?: (taskId: string) => Promise<void> | void
}

type DesktopFolderPickerResult = {
  ok?: boolean
  path?: string
  canceled?: boolean
  error?: string
}

type FocusmapDesktopFolderBridge = {
  chooseFolder?: () => Promise<DesktopFolderPickerResult>
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
  return messages.filter(message => !isGenericCodexPulseText(message.body))
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
  if (message.kind === "question") return "Codexの質問"
  if (message.kind === "approval") return "確認依頼"
  if (message.role === "status") return "進行状況"
  return "Codexの返答"
}

export function CodexChatImportSidebar({
  projectTitle,
  selectedRepoPath,
  importEnabled,
  importOwnerLabel = null,
  importPending = false,
  chatItems,
  onClose,
  onSelectRepoPath,
  onToggleImport,
  onDeleteChatItem,
  onPlaceChatItem,
}: CodexChatImportSidebarProps) {
  const [pickerPending, setPickerPending] = React.useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false)
  const [repoError, setRepoError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null)
  const [chatDetailsById, setChatDetailsById] = React.useState<Record<string, ChatDetailState>>({})
  const [linkedAiTaskIdsBySourceId, setLinkedAiTaskIdsBySourceId] = React.useState<Record<string, string>>({})
  const [placingPending, setPlacingPending] = React.useState(false)
  const backgroundSyncedChatIdsRef = React.useRef(new Set<string>())
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
  const selectedChatItem = React.useMemo(() => {
    if (!selectedChatId) return null
    return chatItems.find(item => item.id === selectedChatId) ?? null
  }, [chatItems, selectedChatId])

  React.useEffect(() => {
    if (!selectedChatId) return
    if (chatItems.some(item => item.id === selectedChatId)) return
    setSelectedChatId(null)
  }, [chatItems, selectedChatId])

  const resolveAiTaskId = React.useCallback((item: CodexChatImportItem) => {
    const directAiTaskId = item.aiTaskId?.trim()
    if (directAiTaskId) return directAiTaskId
    return linkedAiTaskIdsBySourceId[item.id]?.trim() || null
  }, [linkedAiTaskIdsBySourceId])

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
        const activityRes = await fetch(`/api/ai-tasks/${encodeURIComponent(aiTaskId)}/activity`, { cache: "no-store" })
        const activityData = await activityRes.json().catch(() => ({}))
        if (activityRes.ok) {
          const messages = readActivityMessages(activityData)
          if (messages.length > 0) {
            setChatDetailsById(prev => ({
              ...prev,
              [item.id]: { loading: false, messages, text: null, error: null },
            }))
            return
          }
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
  }, [resolveAiTaskId, syncChatActivity])

  React.useEffect(() => {
    if (!codexRunnerStatus.ready || chatItems.length === 0) return
    const timers: number[] = []
    for (const [index, item] of chatItems.slice(0, 20).entries()) {
      if (backgroundSyncedChatIdsRef.current.has(item.id)) continue
      backgroundSyncedChatIdsRef.current.add(item.id)
      const timer = window.setTimeout(() => {
        void syncChatActivity(item).catch(() => undefined)
      }, index * 250)
      timers.push(timer)
    }
    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [chatItems, codexRunnerStatus.ready, syncChatActivity])

  const handleChatItemClick = React.useCallback((item: CodexChatImportItem) => {
    setSelectedChatId(item.id)
    setRepoPickerOpen(false)
    void loadChatDetail(item)
  }, [loadChatDetail])

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

  const selectedDetail = selectedChatItem ? chatDetailsById[selectedChatItem.id] : null
  const selectedMessages = visibleActivityMessages(selectedDetail?.messages ?? [])

  return (
    <aside
      className="flex h-full w-[340px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden border border-y-0 border-r-0 bg-background/95 shadow-2xl backdrop-blur"
      aria-label="チャット取り込み"
      title={projectTitle}
    >
      {!selectedChatItem && (
        <div className="space-y-2 border-b p-2.5">
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs font-medium">リポ監視</span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={hasRepoPath ? currentRepoPath : undefined}>
                {hasRepoPath ? currentRepoLabel : "リポ未選択"}
              </span>
              {hasRepoPath && importOwnerLabel && (
                <span className="max-w-[96px] shrink-0 truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={importOwnerLabel}>
                  監視: {importOwnerLabel}
                </span>
              )}
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  codexRunnerStatus.ready
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
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
              className="h-6 w-10 shrink-0 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-700 [&>span]:h-5 [&>span]:w-5 [&>span[data-state=checked]]:translate-x-4"
            />
          </div>

          <div className="relative">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2"
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
                className="h-8 px-2"
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
                className="h-8 w-8"
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
                  className="h-7 px-2 text-xs text-muted-foreground"
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
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover p-1 shadow-xl"
              >
                {repos.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
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
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                          selected && "bg-muted",
                        )}
                        onClick={() => void selectRepoPath(repo.absolute_path)}
                        disabled={isBusy}
                        title={repo.absolute_path}
                      >
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {repo.display_name || repoNameFromPath(repo.absolute_path)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">agent</span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {(repoError || reposError) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {repoError ?? reposError}
            </p>
          )}
        </div>
      )}

      {selectedChatItem ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-1 h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={() => setSelectedChatId(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>戻る</span>
              </Button>
              <div className="min-w-0 flex-1 truncate text-xs font-semibold" title={selectedChatItem.title}>
                {selectedChatItem.title}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            {selectedDetail?.loading && selectedMessages.length === 0 && !selectedDetail.text ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                チャット内容を取得中
              </div>
            ) : null}

            {selectedDetail?.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {selectedDetail.error}
              </div>
            ) : null}

            {selectedDetail?.loading && selectedMessages.length > 0 ? (
              <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                最新内容を取得中
              </div>
            ) : null}

            {selectedMessages.length > 0 ? (
              <div className="space-y-4">
                {selectedMessages.map(message => {
                  const label = activityLabel(message)
                  const isUserMessage = message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
                  const isStatusMessage = message.role === "status" || message.role === "system"
                  const timeLabel = formatActivityTime(message.created_at)
                  return (
                    <article key={message.id} className="flex min-w-0 gap-2">
                      {!isUserMessage && (
                        <div
                          className={cn(
                            "mt-5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                            isStatusMessage
                              ? "bg-muted text-muted-foreground"
                              : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                          )}
                          aria-hidden="true"
                        >
                          {isStatusMessage ? <GitBranch className="h-3 w-3" /> : "C"}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex min-w-0 items-center gap-2">
                          <span className={cn(
                            "shrink-0 text-xs font-semibold",
                            isUserMessage && "text-sky-700 dark:text-sky-200",
                          )}>
                            {label}
                          </span>
                          {timeLabel && (
                            <span className={cn(
                              "truncate text-[11px] text-muted-foreground",
                              isUserMessage && "text-sky-700/70 dark:text-sky-200/60",
                            )}>
                              {timeLabel}
                            </span>
                          )}
                        </div>
                        <div
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm",
                            isUserMessage
                              ? "border-sky-400/25 bg-sky-500/[0.11] dark:border-sky-300/20 dark:bg-sky-400/[0.12]"
                              : "bg-muted/20",
                            message.importance === "important" && "border-amber-400/50 bg-amber-500/10",
                          )}
                        >
                          {message.body}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : selectedDetail?.text ? (
              <div className="space-y-1">
                <div className="text-xs font-semibold">取得内容</div>
                <div className="whitespace-pre-wrap break-words rounded-lg border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm">
                  {selectedDetail.text}
                </div>
              </div>
            ) : !selectedDetail?.loading && !selectedDetail?.error ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                表示できるチャット内容がありません
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-8 pl-7 text-xs"
                placeholder="チャットを検索"
                aria-label="チャットを検索"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
            {filteredChatItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                未配置チャットはありません
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredChatItems.map(item => (
                  <div
                    key={item.id}
                    draggable
                    role="button"
                    tabIndex={0}
                    className="group flex w-full cursor-grab flex-col gap-1 rounded-lg border bg-card/80 px-2.5 py-2 text-left shadow-sm transition-colors hover:border-sky-400/60 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    data-testid={`codex-chat-import-row-${item.id}`}
                    onClick={() => handleChatItemClick(item)}
                    onKeyDown={event => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      handleChatItemClick(item)
                    }}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        CODEX_CHAT_IMPORT_DRAG_TYPE,
                        encodeCodexChatImportDragPayload({ taskId: item.id }),
                      )
                      event.dataTransfer.setData("text/plain", item.title)
                    }}
                    title={item.snippet ?? item.title}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate text-xs font-semibold">{item.title}</div>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.updatedLabel && <span className="text-[10px] text-muted-foreground">{item.updatedLabel}</span>}
                        {onDeleteChatItem && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
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
                    </div>
                    {item.snippet && (
                      <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {item.snippet}
                      </div>
                    )}
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        item.placed ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-sky-500/15 text-sky-600 dark:text-sky-300",
                      )}>
                        {item.placementLabel}
                      </span>
                      {item.statusLabel && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.statusLabel}
                        </span>
                      )}
                      {item.repoPath && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={item.repoPath}>
                          {repoNameFromPath(item.repoPath)}
                        </span>
                      )}
                      {item.threadId && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={item.threadId}>
                          {item.threadId.slice(0, 8)}
                        </span>
                      )}
                      {item.projectTitle && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.projectTitle}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2 border-t p-3">
        <Button type="button" variant="outline" className="h-10 min-w-0" onClick={onClose}>
          閉じる
        </Button>
        {selectedChatItem ? (
          <Button
            type="button"
            className="h-10 min-w-0 bg-sky-500 text-white hover:bg-sky-600"
            onClick={() => void handlePlaceSelectedChatItem()}
            disabled={!onPlaceChatItem || placingPending}
          >
            {placingPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
            ノードへ配置
          </Button>
        ) : (
          <div className="flex min-w-0 items-center justify-end truncate text-[11px] text-muted-foreground">
            ドラッグしてノードへ配置
          </div>
        )}
      </div>
    </aside>
  )
}
