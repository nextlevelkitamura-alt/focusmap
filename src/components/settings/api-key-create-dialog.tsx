"use client"

import { useState } from "react"
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
import { API_SCOPES, DEFAULT_SCOPES } from "@/lib/api-scopes"

interface ApiKeyCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string, scopes: string[]) => void
  isLoading: boolean
}

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  onCreated,
  isLoading,
}: ApiKeyCreateDialogProps) {
  const [name, setName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_SCOPES)

  const handleToggleScope = (scopeId: string) => {
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
  }

  // Group scopes by category
  const categories = [...new Set(API_SCOPES.map(s => s.category))]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新しいAPIキーを作成</DialogTitle>
          <DialogDescription>
            名前とアクセス権限を設定してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">キー名</Label>
            <Input
              id="key-name"
              placeholder="例: MCP連携用"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <Label>権限（スコープ）</Label>
            {categories.map(category => (
              <div key={category} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{category}</p>
                {API_SCOPES.filter(s => s.category === category).map(scope => (
                  <div key={scope.id} className="flex items-center justify-between rounded-lg border p-2.5">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{scope.label}</p>
                      <p className="text-[11px] text-muted-foreground">{scope.description}</p>
                    </div>
                    <Switch
                      checked={selectedScopes.includes(scope.id)}
                      onCheckedChange={() => handleToggleScope(scope.id)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || selectedScopes.length === 0}>
            {isLoading ? "作成中..." : "作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
