"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight, FolderSearch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"

interface ScanSetting {
  hostname: string
  scan_paths: string[]
  last_scanned_at: string | null
  scan_now_requested_at: string | null
}

const SUGGESTED_PATHS = ["~/dev", "~/Documents", "~/Projects", "~/Workspace", "~/Private", "~/Code"]

export function ScanSettingsSection() {
  const [settings, setSettings] = useState<ScanSetting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingHost, setSavingHost] = useState<string | null>(null)
  const [rescanningHost, setRescanningHost] = useState<string | null>(null)
  const [editingHost, setEditingHost] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/scan-settings")
      if (res.ok) setSettings((await res.json()) as ScanSetting[])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const updatePaths = async (hostname: string, paths: string[]) => {
    setSavingHost(hostname)
    try {
      await fetch("/api/scan-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname, scan_paths: paths }),
      })
      setSettings(prev => prev.map(s => s.hostname === hostname ? { ...s, scan_paths: paths } : s))
    } finally {
      setSavingHost(null)
    }
  }

  const rescan = async (hostname: string) => {
    setRescanningHost(hostname)
    try {
      await fetch("/api/scan-settings/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname }),
      })
      // 1分待ってリロード
      await new Promise(r => setTimeout(r, 65_000))
      await fetchSettings()
    } finally {
      setRescanningHost(null)
    }
  }

  const editingSetting = settings.find(s => s.hostname === editingHost) ?? null

  return (
    <>
      <div id="scan-settings">
        <h3 className="px-4 pt-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FolderSearch className="h-3 w-3" />
          リポジトリの自動スキャン
        </h3>

        {isLoading ? (
          <div className="mx-1 rounded-2xl bg-card flex min-h-[64px] items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />読み込み中
          </div>
        ) : settings.length === 0 ? (
          <div className="mx-1 rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground space-y-1.5">
            <p className="font-medium">この Mac はまだスキャン未実行</p>
            <p className="text-[11px] leading-5">
              Mac でメモから Claude を1回起動するか、task-runner が走ると自動でデフォルト設定が作成されます。
            </p>
          </div>
        ) : (
          <div className="mx-1 rounded-2xl bg-card overflow-hidden divide-y divide-border/40">
            {settings.map(s => (
              <button
                key={s.hostname}
                type="button"
                onClick={() => setEditingHost(s.hostname)}
                className="w-full flex items-center gap-3 min-h-[56px] px-4 py-2 text-left active:bg-muted/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-base font-mono truncate">{s.hostname}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {s.scan_paths.length} パス · 最終スキャン {formatLastScan(s.last_scanned_at)}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
              </button>
            ))}
          </div>
        )}

        <p className="px-5 pt-1.5 text-[11px] text-muted-foreground leading-4">
          Mac の task-runner が指定パス配下を再帰探索（深さ4まで）し、<code className="font-mono">.git</code> を持つフォルダをリポとして登録します。
        </p>
      </div>

      {/* 編集シート */}
      <Sheet open={!!editingHost} onOpenChange={(o) => !o && setEditingHost(null)}>
        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col rounded-t-3xl">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-mono truncate">{editingHost ?? ""}</SheetTitle>
              <button
                type="button"
                onClick={() => setEditingHost(null)}
                className="text-base text-primary px-2 py-1 -mr-2 min-h-[44px]"
              >
                完了
              </button>
            </div>
          </SheetHeader>

          {editingSetting && (
            <ScanPathEditor
              setting={editingSetting}
              isSaving={savingHost === editingSetting.hostname}
              isRescanning={rescanningHost === editingSetting.hostname}
              onSave={paths => updatePaths(editingSetting.hostname, paths)}
              onRescan={() => rescan(editingSetting.hostname)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function formatLastScan(iso: string | null): string {
  if (!iso) return "未実行"
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "1分前以内"
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}

function ScanPathEditor({
  setting,
  isSaving,
  isRescanning,
  onSave,
  onRescan,
}: {
  setting: ScanSetting
  isSaving: boolean
  isRescanning: boolean
  onSave: (paths: string[]) => Promise<void>
  onRescan: () => Promise<void>
}) {
  const [paths, setPaths] = useState(setting.scan_paths)
  const [newPath, setNewPath] = useState("")

  const isDirty = JSON.stringify(paths) !== JSON.stringify(setting.scan_paths)

  const addPath = () => {
    const trimmed = newPath.trim()
    if (!trimmed || paths.includes(trimmed)) return
    setPaths([...paths, trimmed])
    setNewPath("")
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain pb-8">
      {/* スキャン対象パス一覧 */}
      <h3 className="px-4 pt-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        スキャン対象パス（{paths.length}件）
      </h3>
      {paths.length === 0 ? (
        <div className="mx-3 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">
          パス未設定。下から追加してください
        </div>
      ) : (
        <div className="mx-3 rounded-2xl bg-card overflow-hidden divide-y divide-border/40">
          {paths.map(p => (
            <div
              key={p}
              className="flex items-center gap-2 min-h-[52px] px-4"
            >
              <span className="font-mono text-sm flex-1 truncate">{p}</span>
              <button
                type="button"
                onClick={() => setPaths(paths.filter(x => x !== p))}
                className="p-2 -mr-2 text-muted-foreground active:text-destructive"
                aria-label="削除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 入力欄 */}
      <div className="mx-3 mt-2">
        <div className="rounded-2xl bg-card p-3 flex gap-2">
          <input
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPath() } }}
            placeholder="~/my-folder"
            className="flex-1 min-h-[44px] rounded-xl bg-muted/60 px-3 text-base font-mono outline-none focus:bg-muted"
            spellCheck={false}
          />
          <Button type="button" onClick={addPath} disabled={!newPath.trim()} className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-1" />追加
          </Button>
        </div>
      </div>

      {/* サジェスト */}
      {SUGGESTED_PATHS.filter(p => !paths.includes(p)).length > 0 && (
        <>
          <h3 className="px-4 pt-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            候補
          </h3>
          <div className="mx-3 rounded-2xl bg-card overflow-hidden divide-y divide-border/40">
            {SUGGESTED_PATHS.filter(p => !paths.includes(p)).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPaths([...paths, p])}
                className="w-full flex items-center gap-3 min-h-[52px] px-4 text-left active:bg-muted/60"
              >
                <Plus className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-sm flex-1">{p}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* アクション */}
      <h3 className="px-4 pt-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        アクション
      </h3>
      <div className="mx-3 rounded-2xl bg-card overflow-hidden divide-y divide-border/40 mb-2">
        <button
          type="button"
          onClick={onRescan}
          disabled={isRescanning}
          className="w-full flex items-center gap-3 min-h-[56px] px-4 text-left active:bg-muted/60 disabled:opacity-60"
        >
          {isRescanning ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          ) : (
            <RefreshCw className="h-5 w-5 text-primary shrink-0" />
          )}
          <span className="text-base flex-1">
            {isRescanning ? "スキャン中（最大1分）..." : "今すぐ再スキャン"}
          </span>
        </button>
      </div>

      {/* 保存ボタン（変更時のみ） */}
      {isDirty && (
        <div className="mx-3 mt-3">
          <Button
            type="button"
            onClick={() => onSave(paths)}
            disabled={isSaving}
            className="w-full min-h-[48px] text-base"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            変更を保存
          </Button>
        </div>
      )}

      <p className="px-5 pt-3 text-[11px] text-muted-foreground leading-4">
        <code className="font-mono">~/</code> はホームディレクトリに展開されます。<code className="font-mono">node_modules</code>、<code className="font-mono">.next</code> 等は自動でスキップ。
      </p>
    </div>
  )
}

