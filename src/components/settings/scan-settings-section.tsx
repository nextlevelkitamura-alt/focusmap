"use client"

import { useCallback, useEffect, useState } from "react"
import { FolderSearch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
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

  const fetchSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/scan-settings")
      if (res.ok) {
        const data = (await res.json()) as ScanSetting[]
        setSettings(data)
      }
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
    } finally {
      setRescanningHost(null)
    }
  }

  return (
    <div id="scan-settings" className="rounded-lg border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FolderSearch className="h-4 w-4" />
          リポジトリの自動スキャン設定
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Mac の task-runner がここで指定したパス配下を再帰探索し、見つかった git リポをプロジェクト設定で選択できるようにします。各 Mac ごとに設定。<code className="text-xs bg-muted px-1 rounded">~/</code> はホームディレクトリに展開されます。
        </p>
      </div>

      {isLoading ? (
        <div className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />読み込み中
        </div>
      ) : settings.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-xs text-muted-foreground space-y-2">
          <p className="font-medium">この Mac はまだ task-runner が一度も起動していません</p>
          <p>
            Mac でメモから Claude を1回起動するか、task-runner が走ると自動でデフォルト設定が作成されます。
            その後ここで編集できます。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {settings.map(s => (
            <HostSetting
              key={s.hostname}
              setting={s}
              isSaving={savingHost === s.hostname}
              isRescanning={rescanningHost === s.hostname}
              onSave={paths => updatePaths(s.hostname, paths)}
              onRescan={() => rescan(s.hostname)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HostSetting({
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

  const removePath = (p: string) => setPaths(paths.filter(x => x !== p))

  const addSuggested = (p: string) => {
    if (paths.includes(p)) return
    setPaths([...paths, p])
  }

  return (
    <div className="rounded-md border bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-mono text-sm font-medium">{setting.hostname}</div>
        <div className="text-[11px] text-muted-foreground">
          最終スキャン: {setting.last_scanned_at ? new Date(setting.last_scanned_at).toLocaleString("ja-JP") : "未実行"}
        </div>
      </div>

      <ul className="space-y-1">
        {paths.length === 0 && (
          <li className="text-xs text-muted-foreground py-1">スキャン対象パス未設定（下から追加してください）</li>
        )}
        {paths.map(p => (
          <li key={p} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 font-mono text-xs">
            <span className="flex-1 truncate">{p}</span>
            <button
              type="button"
              onClick={() => removePath(p)}
              className="text-muted-foreground hover:text-destructive p-1"
              aria-label="削除"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-1">
        <input
          type="text"
          value={newPath}
          onChange={e => setNewPath(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPath() } }}
          placeholder="~/my-code-folder"
          className="flex-1 min-h-[36px] rounded-md border bg-background px-2 text-xs font-mono outline-none focus:ring-1 focus:ring-primary"
          spellCheck={false}
        />
        <Button type="button" size="sm" variant="outline" onClick={addPath} disabled={!newPath.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 候補チップ */}
      <div className="flex flex-wrap gap-1">
        {SUGGESTED_PATHS.filter(p => !paths.includes(p)).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => addSuggested(p)}
            className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            + {p}
          </button>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRescan}
          disabled={isRescanning}
        >
          {isRescanning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          今すぐ再スキャン
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(paths)}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  )
}
