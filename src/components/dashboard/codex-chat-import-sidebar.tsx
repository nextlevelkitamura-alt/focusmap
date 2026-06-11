"use client"

import * as React from "react"
import { Check, FolderGit2, FolderOpen, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import {
  CODEX_CHAT_IMPORT_DRAG_TYPE,
  encodeCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd"
import { cn } from "@/lib/utils"

export type CodexChatImportItem = {
  id: string
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
  text: string | null
  error: string | null
}

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
}: CodexChatImportSidebarProps) {
  const [pickerPending, setPickerPending] = React.useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false)
  const [repoError, setRepoError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [expandedChatId, setExpandedChatId] = React.useState<string | null>(null)
  const [chatDetailsById, setChatDetailsById] = React.useState<Record<string, ChatDetailState>>({})
  const { repos, isLoading, error: reposError, refresh, requestRescan } = useAvailableRepos()

  const currentRepoPath = normalizeRepoPath(selectedRepoPath ?? "")
  const hasRepoPath = currentRepoPath.length > 0
  const isBusy = importPending || pickerPending
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
    setRepoError(null)
    try {
      await onToggleImport()
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "取り込み設定を更新できませんでした")
    }
  }, [hasRepoPath, isBusy, onToggleImport])

  const handleRefreshRepos = React.useCallback(async () => {
    setRepoError(null)
    try {
      await requestRescan()
      await refresh()
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "リポフォルダ一覧を更新できませんでした")
    }
  }, [refresh, requestRescan])

  const handleChatItemClick = React.useCallback((item: CodexChatImportItem) => {
    const willOpen = expandedChatId !== item.id
    setExpandedChatId(willOpen ? item.id : null)
    if (!willOpen) return

    const currentDetail = chatDetailsById[item.id]
    if (currentDetail?.loading || currentDetail?.text || currentDetail?.error) return

    setChatDetailsById(prev => ({
      ...prev,
      [item.id]: { loading: true, text: null, error: null },
    }))

    void fetch(`/api/tasks/${encodeURIComponent(item.id)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || (data as { success?: boolean })?.success === false) {
          const message = (data as { error?: { message?: string } })?.error?.message || "チャット詳細を取得できませんでした"
          throw new Error(message)
        }
        setChatDetailsById(prev => ({
          ...prev,
          [item.id]: {
            loading: false,
            text: readTaskDetailText(data, item.snippet),
            error: null,
          },
        }))
      })
      .catch(error => {
        setChatDetailsById(prev => ({
          ...prev,
          [item.id]: {
            loading: false,
            text: null,
            error: error instanceof Error ? error.message : "チャット詳細を取得できませんでした",
          },
        }))
      })
  }, [chatDetailsById, expandedChatId])

  return (
    <aside
      className="flex h-full w-[340px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden border border-y-0 border-r-0 bg-background/95 shadow-2xl backdrop-blur"
      aria-label="チャット取り込み"
      title={projectTitle}
    >
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
          </div>
          <Switch
            checked={importEnabled && hasRepoPath}
            onCheckedChange={() => void handleToggleImport()}
            disabled={!hasRepoPath || isBusy}
            aria-label="リポ監視"
            className="h-6 w-10 shrink-0 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-700 [&>span]:h-5 [&>span]:w-5 [&>span[data-state=checked]]:translate-x-4"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="チャット取り込みを閉じる"
            title="閉じる"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
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

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {filteredChatItems.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              未配置チャットはありません
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredChatItems.map(item => (
                <div key={item.id}>
                  <div
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedChatId === item.id}
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
                    {expandedChatId === item.id && (
                      <div className="mt-1 rounded-md border bg-muted/25 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {chatDetailsById[item.id]?.loading ? (
                          <div className="flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            詳細を取得中
                          </div>
                        ) : chatDetailsById[item.id]?.error ? (
                          <div className="text-destructive">{chatDetailsById[item.id]?.error}</div>
                        ) : (
                          <div className="max-h-32 overflow-auto whitespace-pre-wrap">
                            {chatDetailsById[item.id]?.text ?? item.snippet ?? "詳細はありません"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          ドラッグしてノードへ配置
        </div>
      </div>
    </aside>
  )
}
