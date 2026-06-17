"use client"

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { API_SCOPES, API_SCOPE_PRESETS, DEFAULT_SCOPES } from "@/lib/api-scopes"
import { SettingsStatusChip } from "@/components/settings/settings-primitives"
import { cn } from "@/lib/utils"

interface ApiKeyCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string, scopes: string[]) => void
  isLoading: boolean
}

const riskLabel = {
  low: "read",
  medium: "write",
  high: "危険",
} as const

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  onCreated,
  isLoading,
}: ApiKeyCreateDialogProps) {
  const [name, setName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_SCOPES)
  const [selectedPreset, setSelectedPreset] = useState("ai_organize")

  const scopesByCategory = useMemo(() => {
    return API_SCOPES.reduce<Record<string, typeof API_SCOPES>>((acc, scope) => {
      acc[scope.category] = [...(acc[scope.category] ?? []), scope]
      return acc
    }, {})
  }, [])

  const handleSelectPreset = (presetId: string) => {
    const preset = API_SCOPE_PRESETS.find(item => item.id === presetId)
    if (!preset) return
    setSelectedPreset(presetId)
    setSelectedScopes(preset.scopes)
  }

  const handleToggleScope = (scopeId: string) => {
    setSelectedPreset("custom")
    setSelectedScopes(prev =>
      prev.includes(scopeId)
        ? prev.filter(s => s !== scopeId)
        : [...prev, scopeId]
    )
  }

  const handleSubmit = () => {
    onCreated(name.trim() || "Default", selectedScopes)
    setName("")
    setSelectedScopes(DEFAULT_SCOPES)
    setSelectedPreset("ai_organize")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新しいAPIキーを作成</DialogTitle>
          <DialogDescription>
            外部AIへ渡す用途ごとにキーを分け、必要なscopeだけを付与します。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">キー名</Label>
            <Input
              id="key-name"
              placeholder="例: Codex AI整理用"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>用途</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {API_SCOPE_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selectedPreset === preset.id
                      ? "border-white/35 bg-white/[0.08]"
                      : "border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.06]"
                  }`}
                  onClick={() => handleSelectPreset(preset.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{preset.label}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{preset.scopes.length} scopes</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>権限（スコープ）</Label>
            <div className="max-h-[300px] space-y-3 overflow-y-auto rounded-lg border p-3">
              {Object.entries(scopesByCategory).map(([category, scopes]) => (
                <div key={category} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{category}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {scopes.map(scope => (
                      <div
                        key={scope.id}
                        className={cn(
                          "flex min-h-[58px] items-center justify-between gap-3 rounded-lg border px-3 py-2",
                          selectedScopes.includes(scope.id)
                            ? "border-white/[0.20] bg-white/[0.06]"
                            : "border-white/[0.08]",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm">{scope.label}</p>
                            <SettingsStatusChip
                              tone={scope.risk === "high" ? "danger" : scope.risk === "medium" ? "neutral" : "muted"}
                              className="min-h-5 px-2 text-[10px]"
                            >
                              {riskLabel[scope.risk ?? "low"]}
                            </SettingsStatusChip>
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{scope.description}</p>
                        </div>
                        <Switch
                          checked={selectedScopes.includes(scope.id)}
                          onCheckedChange={() => handleToggleScope(scope.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || selectedScopes.length === 0}>
            {isLoading ? "作成中..." : "作成して一度だけ表示"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
