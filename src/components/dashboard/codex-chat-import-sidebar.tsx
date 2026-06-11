"use client"

import * as React from "react"
import { Bot, Check, FolderOpen, GitBranch, Loader2, RefreshCw, Search, X } from "lucide-react"
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
  placementLabel: string
  statusLabel: string | null
  updatedLabel: string | null
  placed: boolean
}

type CodexChatImportSidebarProps = {
  projectTitle: string
  repoPath: string | null
  importEnabled: boolean
  importPending?: boolean
  repoSaving?: boolean
  chatItems: CodexChatImportItem[]
  onClose: () => void
  onSaveRepoPath: (repoPath: string | null) => Promise<void> | void
  onToggleImport: () => Promise<void> | void
}

function normalizeRepoPath(value: string) {
  return value.trim().replace(/\/+$/, "")
}

export function CodexChatImportSidebar({
  projectTitle,
  repoPath,
  importEnabled,
  importPending = false,
  repoSaving = false,
  chatItems,
  onClose,
  onSaveRepoPath,
  onToggleImport,
}: CodexChatImportSidebarProps) {
  const [draftRepoPath, setDraftRepoPath] = React.useState(repoPath ?? "")
  const [pickerPending, setPickerPending] = React.useState(false)
  const [repoError, setRepoError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const { repos, isLoading, error: reposError, refresh, requestRescan } = useAvailableRepos()

  React.useEffect(() => {
    setDraftRepoPath(repoPath ?? "")
  }, [repoPath])

  const currentRepoPath = normalizeRepoPath(repoPath ?? "")
  const draftNormalized = normalizeRepoPath(draftRepoPath)
  const hasRepoPath = currentRepoPath.length > 0
  const isBusy = importPending || repoSaving || pickerPending
  const hasDraftChanges = draftNormalized !== currentRepoPath
  const normalizedQuery = query.trim().toLowerCase()
  const filteredChatItems = React.useMemo(() => {
    if (!normalizedQuery) return chatItems
    return chatItems.filter(item => {
      const haystack = [item.title, item.snippet, item.repoPath, item.placementLabel, item.statusLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [chatItems, normalizedQuery])

  const saveRepoPath = React.useCallback(async (nextRepoPath: string | null) => {
    const normalized = nextRepoPath ? normalizeRepoPath(nextRepoPath) : ""
    setRepoError(null)
    try {
      await onSaveRepoPath(normalized || null)
      setDraftRepoPath(normalized)
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "リポを保存できませんでした")
    }
  }, [onSaveRepoPath])

  const chooseFolder = React.useCallback(async () => {
    setPickerPending(true)
    setRepoError(null)
    try {
      const res = await fetch("/api/codex/choose-folder")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error && data.error !== "canceled") setRepoError(String(data.error))
        return
      }
      if (typeof data?.path === "string") setDraftRepoPath(normalizeRepoPath(data.path))
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Finderを開けませんでした")
    } finally {
      setPickerPending(false)
    }
  }, [])

  const handleToggleImport = React.useCallback(async () => {
    if (!hasRepoPath || isBusy) {
      if (!hasRepoPath) setRepoError("リポを保存してからONにできます")
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
      setRepoError(error instanceof Error ? error.message : "リポ一覧を更新できませんでした")
    }
  }, [refresh, requestRescan])

  return (
    <aside
      className="flex h-full w-[340px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-2xl backdrop-blur"
      aria-label="チャット取り込み"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-sky-500" />
            チャット取り込み
          </div>
          <div className="truncate text-[11px] text-muted-foreground" title={projectTitle}>
            {projectTitle}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="チャット取り込みを閉じる">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3 border-b p-3">
        <div className="rounded-xl border bg-muted/25 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">リポ監視</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {hasRepoPath ? currentRepoPath : "リポ未設定"}
              </div>
            </div>
            <Switch
              checked={importEnabled && hasRepoPath}
              onCheckedChange={() => void handleToggleImport()}
              disabled={!hasRepoPath || isBusy}
              aria-label="リポ監視"
              className="h-7 w-12 border-0 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-700 [&>span]:h-6 [&>span]:w-6 [&>span[data-state=checked]]:translate-x-5"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">リポ / 構成</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleRefreshRepos}
              disabled={isBusy}
            >
              <RefreshCw className={cn("mr-1 h-3 w-3", isLoading && "animate-spin")} />
              更新
            </Button>
          </div>

          {repos.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-auto rounded-lg border bg-muted/20 p-1">
              {repos.slice(0, 5).map(repo => {
                const selected = currentRepoPath === repo.absolute_path
                return (
                  <button
                    key={repo.id}
                    type="button"
                    aria-label={`リポを選択 ${repo.display_name || repo.absolute_path}`}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background",
                      selected && "bg-background",
                    )}
                    onClick={() => void saveRepoPath(repo.absolute_path)}
                    disabled={repoSaving}
                    title={repo.absolute_path}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">{repo.display_name || repo.absolute_path}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{repo.absolute_path}</span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Input
              value={draftRepoPath}
              onChange={event => setDraftRepoPath(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && (draftNormalized || currentRepoPath)) {
                  event.preventDefault()
                  void saveRepoPath(draftNormalized || null)
                }
              }}
              placeholder="/Users/you/repo"
              className="h-8 font-mono text-xs"
              aria-label="プロジェクトリポ"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={chooseFolder}
              disabled={isBusy}
              aria-label="Finderでリポを選択"
              title="Finderでリポを選択"
            >
              {pickerPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => void saveRepoPath(draftNormalized || null)}
              disabled={repoSaving || !hasDraftChanges}
            >
              {repoSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              保存
            </Button>
            {currentRepoPath && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => void saveRepoPath(null)}
                disabled={repoSaving}
              >
                解除
              </Button>
            )}
          </div>
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
              取り込み済みチャットはまだありません
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredChatItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  className="group flex w-full cursor-grab flex-col gap-1 rounded-lg border bg-card/80 px-2.5 py-2 text-left shadow-sm transition-colors hover:border-sky-400/60 hover:bg-card active:cursor-grabbing"
                  data-testid={`codex-chat-import-row-${item.id}`}
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
                    {item.updatedLabel && <span className="shrink-0 text-[10px] text-muted-foreground">{item.updatedLabel}</span>}
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
                      <span className="min-w-0 truncate rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.repoPath}
                      </span>
                    )}
                  </div>
                </button>
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
