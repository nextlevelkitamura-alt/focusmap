"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Check, ChevronRight, FolderGit2, Loader2, RefreshCw, Search, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAvailableRepos, type AvailableRepo } from "@/hooks/useAvailableRepos"

interface RepoPickerProps {
  value: string | null
  onChange: (path: string | null) => Promise<void> | void
  placeholder?: string
  /** カスタムパス入力を許可するか（デフォルト true）*/
  allowCustom?: boolean
  className?: string
  disabled?: boolean
  /** トリガー表示モード。"row" は iOS 設定風の行型、"button" は従来のボタン型 */
  triggerVariant?: "row" | "button"
  /** triggerVariant="row" のときの行ラベル */
  rowLabel?: string
  /** triggerVariant="row" のときの補助説明 */
  rowDescription?: string
  /** triggerVariant="row" のときの状態表示 */
  rowStatus?: ReactNode
}

function formatRelative(iso: string | null): string {
  if (!iso) return "コミット履歴なし"
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "今"
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}日前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}ヶ月前`
  return `${Math.floor(months / 12)}年前`
}

export function RepoPicker({
  value,
  onChange,
  placeholder = "未設定",
  allowCustom = true,
  className,
  disabled,
  triggerVariant = "button",
  rowLabel = "リポジトリ",
  rowDescription,
  rowStatus,
}: RepoPickerProps) {
  const { repos, isLoading, refresh, requestRescan } = useAvailableRepos()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [customPath, setCustomPath] = useState("")
  const [saving, setSaving] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const selectedRepo = useMemo(
    () => repos.find(r => r.absolute_path === value) ?? null,
    [repos, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r =>
      r.display_name.toLowerCase().includes(q) ||
      r.absolute_path.toLowerCase().includes(q),
    )
  }, [repos, query])

  // ホスト別グループ化
  const groupedByHost = useMemo(() => {
    const groups = new Map<string, AvailableRepo[]>()
    for (const r of filtered) {
      if (!groups.has(r.hostname)) groups.set(r.hostname, [])
      groups.get(r.hostname)!.push(r)
    }
    return Array.from(groups.entries())
  }, [filtered])

  const handleSelect = async (path: string | null) => {
    setSaving(true)
    try {
      await onChange(path)
      setOpen(false)
      setQuery("")
      setCustomPath("")
    } finally {
      setSaving(false)
    }
  }

  const handleRescan = async () => {
    setRescanning(true)
    try {
      await requestRescan()
      const previousCount = repos.length
      const start = Date.now()
      while (Date.now() - start < 70_000) {
        await new Promise(r => setTimeout(r, 5000))
        await refresh()
        if (repos.length !== previousCount) break
      }
    } finally {
      setRescanning(false)
    }
  }

  const displayValue = saving ? "保存中..." : selectedRepo ? selectedRepo.display_name : value || placeholder

  // ─── トリガー ───────────────────────────────────────────
  const trigger = triggerVariant === "row" ? (
    <button
      type="button"
      onClick={() => !disabled && setOpen(true)}
      disabled={disabled || saving}
      className={cn(
        "w-full flex min-h-[64px] flex-col gap-2 px-4 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.08] disabled:opacity-50 sm:flex-row sm:items-center",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-400">
          <FolderGit2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-5 text-zinc-50">{rowLabel}</span>
          {rowDescription ? <span className="mt-1 block truncate text-[12px] leading-5 text-zinc-500">{rowDescription}</span> : null}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-11 sm:pl-0">
        {rowStatus}
        <span className={cn(
          "max-w-[220px] truncate text-right text-[13px]",
          selectedRepo || value ? "text-zinc-400" : "text-zinc-600",
        )}>
          {displayValue}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
      </span>
    </button>
  ) : (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || saving}
      onClick={() => setOpen(true)}
      className={cn(
        "w-full min-h-[44px] justify-between font-normal",
        !value && "text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <FolderGit2 className="h-4 w-4 shrink-0" />
        <span className="truncate">{displayValue}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
    </Button>
  )

  return (
    <>
      {trigger}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="h-[92vh] sm:h-[80vh] p-0 flex flex-col rounded-t-3xl"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg">リポジトリを選択</SheetTitle>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-base text-primary px-2 py-1 -mr-2 min-h-[44px]"
              >
                完了
              </button>
            </div>
          </SheetHeader>

          {/* 検索バー（sticky） */}
          <div className="px-4 py-2 border-b shrink-0 bg-background">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="名前 or パスで検索"
                className="w-full min-h-[44px] rounded-xl bg-muted/60 pl-10 pr-10 text-base outline-none focus:bg-muted"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                  aria-label="検索クリア"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* リスト（スクロール） */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {value && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 min-h-[56px] px-4 text-left active:bg-muted/60 border-b border-border/40 text-base text-destructive"
              >
                <X className="h-5 w-5" />
                選択を解除（未設定にする）
              </button>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中...
              </div>
            ) : filtered.length === 0 ? (
              <RepoEmptyState
                hasQuery={query.length > 0}
                hasAnyRepos={repos.length > 0}
              />
            ) : (
              <div>
                {groupedByHost.map(([hostname, rows]) => (
                  <div key={hostname}>
                    {/* iOS 風セクションヘッダー */}
                    <div className="px-4 pt-5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {hostname}（{rows.length}件）
                    </div>
                    <div className="bg-card mx-3 rounded-2xl overflow-hidden mb-2 divide-y divide-border/40">
                      {rows.map(repo => (
                        <RepoRow
                          key={repo.id}
                          repo={repo}
                          selected={repo.absolute_path === value}
                          onSelect={() => handleSelect(repo.absolute_path)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* フッターアクション */}
            <div className="mt-4 mb-4">
              <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                その他
              </div>
              <div className="bg-card mx-3 rounded-2xl overflow-hidden divide-y divide-border/40">
                <button
                  type="button"
                  onClick={handleRescan}
                  disabled={rescanning}
                  className="w-full flex items-center gap-3 min-h-[56px] px-4 text-left active:bg-muted/60 disabled:opacity-60"
                >
                  {rescanning ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  ) : (
                    <RefreshCw className="h-5 w-5 text-primary shrink-0" />
                  )}
                  <span className="text-base flex-1">
                    {rescanning ? "スキャン中（最大1分）..." : "Mac を再スキャン"}
                  </span>
                </button>

                {allowCustom && (
                  <details className="group">
                    <summary className="cursor-pointer list-none flex items-center gap-3 min-h-[56px] px-4 active:bg-muted/60">
                      <span className="text-base flex-1">リストに無いパスを直接入力</span>
                      <ChevronRight className="h-5 w-5 text-muted-foreground/60 transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="px-4 pb-3 flex gap-2">
                      <input
                        type="text"
                        value={customPath}
                        onChange={e => setCustomPath(e.target.value)}
                        placeholder="/Users/.../my-repo"
                        className="flex-1 min-h-[44px] rounded-xl bg-muted/60 px-3 text-sm font-mono outline-none focus:bg-muted"
                        spellCheck={false}
                      />
                      <Button
                        type="button"
                        onClick={() => customPath.trim() && handleSelect(customPath.trim())}
                        disabled={!customPath.trim()}
                        className="min-h-[44px]"
                      >
                        使う
                      </Button>
                    </div>
                  </details>
                )}
              </div>
              <p className="px-5 pt-2 text-[11px] text-muted-foreground leading-4">
                Mac の task-runner が <code className="font-mono">~/dev</code>{" "}
                <code className="font-mono">~/Documents</code> 等を5分おきにスキャンします。
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function RepoRow({
  repo,
  selected,
  onSelect,
}: {
  repo: AvailableRepo
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 active:bg-muted/60 flex items-center gap-3 min-h-[64px]",
        selected && "bg-primary/10",
      )}
    >
      <FolderGit2 className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-medium truncate">{repo.display_name}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {formatRelative(repo.last_git_commit_at)}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
          {repo.absolute_path}
        </div>
      </div>
      {selected && <Check className="h-5 w-5 shrink-0 text-primary" />}
    </button>
  )
}

function RepoEmptyState({ hasQuery, hasAnyRepos }: { hasQuery: boolean; hasAnyRepos: boolean }) {
  if (hasQuery) {
    return (
      <div className="py-12 px-6 text-center text-sm text-muted-foreground space-y-1">
        <p className="text-base">該当するリポが見つかりません</p>
        <p className="text-xs">検索キーワードを変更するか、カスタムパス入力をお試しください</p>
      </div>
    )
  }
  if (!hasAnyRepos) {
    return (
      <div className="py-12 px-6 text-center text-sm text-muted-foreground space-y-2">
        <p className="text-base font-medium">スキャンされたリポがありません</p>
        <p className="text-xs leading-5">
          Mac の task-runner がデフォルトのフォルダを自動探索しますが、まだ完了していないかも。
          下の「Mac を再スキャン」を押してみてください。
        </p>
      </div>
    )
  }
  return null
}
