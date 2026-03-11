"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Key, Plus, Trash2, Clock } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ApiKeyCreateDialog } from "./api-key-create-dialog"
import { ApiKeyRevealDialog } from "./api-key-reveal-dialog"
import { ApiKeyMcpGuide } from "./api-key-mcp-guide"
import type { ApiKey } from "@/types/api-key"

export function ApiKeySettings() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showRevealDialog, setShowRevealDialog] = useState(false)
  const [revealedKey, setRevealedKey] = useState({ rawKey: "", name: "" })
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/api-keys")
      const json = await res.json()
      if (json.success) {
        setKeys(json.data)
      }
    } catch (err) {
      console.error("Failed to fetch API keys:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const handleCreate = async (name: string, scopes: string[]) => {
    setIsCreating(true)
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      })
      const json = await res.json()
      if (json.success) {
        setRevealedKey({ rawKey: json.data.raw_key, name: json.data.name })
        setShowCreateDialog(false)
        setShowRevealDialog(true)
        fetchKeys()
      }
    } catch (err) {
      console.error("Failed to create API key:", err)
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeactivate = async () => {
    if (!deleteTarget) return
    try {
      await fetch("/api/v1/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      fetchKeys()
    } catch (err) {
      console.error("Failed to deactivate API key:", err)
    } finally {
      setDeleteTarget(null)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "未使用"
    return new Date(dateStr).toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const activeKeys = keys.filter(k => k.is_active)
  const inactiveKeys = keys.filter(k => !k.is_active)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            APIキー
          </CardTitle>
          <CardDescription>
            外部アプリやMCPからShikimikaに接続するためのAPIキーを管理します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* MCP Guide */}
          <ApiKeyMcpGuide />

          {/* Create button */}
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            新しいAPIキーを作成
          </Button>

          {/* Active keys */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">読み込み中...</p>
          ) : activeKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              APIキーがまだありません
            </p>
          ) : (
            <div className="space-y-2">
              {activeKeys.map(key => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{key.name}</p>
                      <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                        {key.key_prefix}
                      </code>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[11px] text-muted-foreground">
                        最終使用: {formatDate(key.last_used_at)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => setDeleteTarget(key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Inactive keys */}
          {inactiveKeys.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">無効化済み</p>
              {inactiveKeys.map(key => (
                <div
                  key={key.id}
                  className="flex items-center rounded-lg border border-dashed p-2 opacity-50"
                >
                  <div>
                    <p className="text-sm line-through">{key.name}</p>
                    <code className="text-[10px] text-muted-foreground">
                      {key.key_prefix}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <ApiKeyCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreate}
        isLoading={isCreating}
      />

      <ApiKeyRevealDialog
        open={showRevealDialog}
        onOpenChange={setShowRevealDialog}
        rawKey={revealedKey.rawKey}
        keyName={revealedKey.name}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>APIキーを無効化しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.name}」を無効化します。このキーを使用している連携は動作しなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              無効化
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
