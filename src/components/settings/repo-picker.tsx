"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, FolderGit2, Loader2, RefreshCw, Search, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
  placeholder = "リポジトリを選択...",
  allowCustom = true,
  className,
  disabled,
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
      // 最大1分待つ間に何度か再取得してみる
      const start = Date.now()
      const previousCount = repos.length
      while (Date.now() - start < 70_000) {
        await new Promise(r => setTimeout(r, 5000))
        await refresh()
        if (repos.length !== previousCount) break
      }
    } finally {
      setRescanning(false)
    }
  }

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || saving}
            className={cn(
              "w-full min-h-[44px] justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <FolderGit2 className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {saving ? "保存中..." : selectedRepo ? selectedRepo.display_name : value || placeholder}
              </span>
              {selectedRepo && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelative(selectedRepo.last_git_commit_at)}
                </span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(420px,calc(100vw-32px))] p-0" align="start">
          {/* 検索 */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="名前 or パスで検索..."
                className="w-full min-h-[40px] rounded-md border bg-background pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>
          </div>

          {/* リスト */}
          <div className="max-h-[50vh] overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted border-b"
              >
                <X className="h-3 w-3" />
                選択を解除
              </button>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 読み込み中...
              </div>
            ) : filtered.length === 0 ? (
              <RepoEmptyState
                hasQuery={query.length > 0}
                hasAnyRepos={repos.length > 0}
              />
            ) : (
              <ul>
                {filtered.map(repo => (
                  <li key={repo.id}>
                    <RepoRow
                      repo={repo}
                      selected={repo.absolute_path === value}
                      onSelect={() => handleSelect(repo.absolute_path)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* フッター: 再スキャン + カスタムパス */}
          <div className="border-t p-2 space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRescan}
              disabled={rescanning}
              className="w-full justify-start min-h-[40px] text-xs"
            >
              {rescanning ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />スキャン中（最大1分）...</>
              ) : (
                <><RefreshCw className="mr-2 h-3.5 w-3.5" />Mac を再スキャンして最新化</>
              )}
            </Button>

            {allowCustom && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                  リストに無い → 絶対パスを直接入力
                </summary>
                <div className="flex gap-1 mt-1">
                  <input
                    type="text"
                    value={customPath}
                    onChange={e => setCustomPath(e.target.value)}
                    placeholder="/Users/.../my-repo"
                    className="flex-1 min-h-[36px] rounded-md border bg-background px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-primary"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => customPath.trim() && handleSelect(customPath.trim())}
                    disabled={!customPath.trim()}
                  >
                    使う
                  </Button>
                </div>
              </details>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
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
        "w-full text-left px-3 py-2.5 hover:bg-muted flex items-start gap-2 min-h-[56px]",
        selected && "bg-primary/10",
      )}
    >
      <FolderGit2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{repo.display_name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatRelative(repo.last_git_commit_at)}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground truncate font-mono">
          {repo.absolute_path}
        </div>
      </div>
      {selected && <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />}
    </button>
  )
}

function RepoEmptyState({ hasQuery, hasAnyRepos }: { hasQuery: boolean; hasAnyRepos: boolean }) {
  if (hasQuery) {
    return (
      <div className="py-6 px-3 text-center text-xs text-muted-foreground space-y-1">
        <p>該当するリポが見つかりません</p>
        <p className="text-[10px]">検索キーワードを変更するか、カスタムパス入力をお試しください</p>
      </div>
    )
  }
  if (!hasAnyRepos) {
    return (
      <div className="py-6 px-3 text-center text-xs text-muted-foreground space-y-2">
        <p className="font-medium">スキャンされたリポがありません</p>
        <p className="text-[10px] leading-5">
          Mac の task-runner が <code className="bg-muted px-1 rounded">~/dev</code>,{" "}
          <code className="bg-muted px-1 rounded">~/Documents</code>,{" "}
          <code className="bg-muted px-1 rounded">~/Private</code> 等を自動探索します。
          <br />
          まだスキャンが終わっていないか、これらのフォルダに git リポがないかも。
        </p>
      </div>
    )
  }
  return null
}
