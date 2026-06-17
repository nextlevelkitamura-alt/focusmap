"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Clock3, KeyRound, Plus, Trash2 } from "lucide-react"
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
import {
  SettingsEmptyState,
  SettingsSection,
  SettingsStatusChip,
} from "@/components/settings/settings-primitives"
import { API_SCOPES } from "@/lib/api-scopes"
import { cn } from "@/lib/utils"
import type { ApiKey } from "@/types/api-key"

const scopeMeta = new Map(API_SCOPES.map(scope => [scope.id, scope]))

function hasHighRiskScope(key: ApiKey) {
  return key.scopes.some(scopeId => scopeMeta.get(scopeId)?.risk === "high")
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "未使用"
  return new Date(dateStr).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatCreatedDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function ScopeBadges({ scopes, compact = false }: { scopes: string[]; compact?: boolean }) {
  const visibleScopes = compact ? scopes.slice(0, 5) : scopes
  const remaining = scopes.length - visibleScopes.length

  if (scopes.length === 0) {
    return <span className="text-[12px] text-zinc-600">scopeなし</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleScopes.map(scopeId => {
        const scope = scopeMeta.get(scopeId)
        const risk = scope?.risk ?? "low"
        return (
          <span
            key={scopeId}
            className={cn(
              "inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] leading-none",
              risk === "high"
                ? "border-red-400/30 bg-red-500/10 text-red-100"
                : risk === "medium"
                  ? "border-white/[0.14] bg-white/[0.09] text-zinc-200"
                  : "border-white/[0.08] bg-white/[0.05] text-zinc-400",
            )}
            title={scope?.description ?? scopeId}
          >
            {scopeId}
          </span>
        )
      })}
      {remaining > 0 ? (
        <span className="inline-flex min-h-6 items-center rounded-full border border-white/[0.08] bg-white/[0.05] px-2 text-[11px] leading-none text-zinc-500">
          +{remaining}
        </span>
      ) : null}
    </div>
  )
}

function ApiKeyRow({
  apiKey,
  onDeactivate,
}: {
  apiKey: ApiKey
  onDeactivate: (key: ApiKey) => void
}) {
  const highRisk = hasHighRiskScope(apiKey)

  return (
    <div
      className={cn(
        "border-b border-white/[0.07] px-4 py-4 last:border-b-0",
        !apiKey.is_active && "opacity-55",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("text-[15px] font-medium leading-5 text-zinc-50", !apiKey.is_active && "line-through")}>
              {apiKey.name}
            </h3>
            <code className="rounded border border-white/[0.08] bg-black/25 px-1.5 py-0.5 text-[11px] text-zinc-400">
              {apiKey.key_prefix}
            </code>
            <SettingsStatusChip tone={apiKey.is_active ? "neutral" : "muted"} className="min-h-5 px-2 text-[10px]">
              {apiKey.is_active ? "active" : "revoked"}
            </SettingsStatusChip>
            {highRisk && apiKey.is_active ? (
              <SettingsStatusChip tone="danger" className="min-h-5 px-2 text-[10px]">
                危険scope
              </SettingsStatusChip>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-5 text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              last used {formatDate(apiKey.last_used_at)}
            </span>
            <span>created {formatCreatedDate(apiKey.created_at)}</span>
          </div>

          <ScopeBadges scopes={apiKey.scopes} compact />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="min-h-10 justify-start text-zinc-300 hover:bg-white/[0.07] hover:text-white sm:justify-center"
          onClick={() => onDeactivate(apiKey)}
          disabled={!apiKey.is_active}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {apiKey.is_active ? "無効化" : "無効化済み"}
        </Button>
      </div>
    </div>
  )
}

function ScopeSummary({ keys }: { keys: ApiKey[] }) {
  const activeKeys = keys.filter(key => key.is_active)
  const activeScopeIds = Array.from(new Set(activeKeys.flatMap(key => key.scopes)))
  const highRiskScopes = activeScopeIds.filter(scopeId => scopeMeta.get(scopeId)?.risk === "high")
  const writeScopes = activeScopeIds.filter(scopeId => scopeId.includes(":write") || scopeId.includes("drafts") || scopeId === "ai:actions")

  return (
    <SettingsSection
      title="Scope summary"
      description="アクティブなAPIキーに付与されている権限の要約"
    >
      {activeKeys.length === 0 ? (
        <SettingsEmptyState>アクティブなAPIキーはありません</SettingsEmptyState>
      ) : (
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">active keys</p>
              <p className="mt-1 text-[20px] font-semibold text-zinc-50">{activeKeys.length}</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">write scopes</p>
              <p className="mt-1 text-[20px] font-semibold text-zinc-50">{writeScopes.length}</p>
            </div>
            <div className="rounded-lg border border-red-400/20 bg-red-500/[0.04] p-3">
              <p className="text-[11px] text-red-100/60">high risk</p>
              <p className="mt-1 text-[20px] font-semibold text-red-100">{highRiskScopes.length}</p>
            </div>
          </div>
          <ScopeBadges scopes={activeScopeIds} />
        </div>
      )}
    </SettingsSection>
  )
}

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

  const activeKeys = keys.filter(k => k.is_active)
  const highRiskKeys = activeKeys.filter(hasHighRiskScope)

  return (
    <>
      <div className="space-y-5">
        <SettingsSection
          title="API keys"
          description="Codexなどの外部AIにFocusmapの読み取り・書き込み権限を渡す鍵です。使わないキーは無効化してください。"
          trailing={
            <Button
              className="min-h-10 shrink-0 bg-zinc-100 text-zinc-950 hover:bg-white"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">新しいAPIキーを作成</span>
              <span className="sm:hidden">作成</span>
            </Button>
          }
        >
          <div className="border-b border-white/[0.07] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-400">
                <KeyRound className="h-4 w-4" />
              </span>
              <SettingsStatusChip tone={activeKeys.length > 0 ? "neutral" : "muted"}>
                {activeKeys.length} active
              </SettingsStatusChip>
              {highRiskKeys.length > 0 ? (
                <SettingsStatusChip tone="danger">
                  {highRiskKeys.length} high-risk
                </SettingsStatusChip>
              ) : (
                <SettingsStatusChip tone="muted">high-riskなし</SettingsStatusChip>
              )}
            </div>
            <p className="mt-3 max-w-2xl text-[12px] leading-5 text-zinc-500">
              APIキーは作成直後に一度だけ表示されます。<code>calendar:write</code> や <code>mindmap:write</code> などのscopeは外部AIから予定・マップへ変更を入れられるため、用途ごとに分けて管理してください。
            </p>
          </div>

          {isLoading ? (
            <SettingsEmptyState>APIキーを読み込み中...</SettingsEmptyState>
          ) : keys.length === 0 ? (
            <SettingsEmptyState>APIキーがまだありません</SettingsEmptyState>
          ) : (
            keys.map(key => (
              <ApiKeyRow key={key.id} apiKey={key} onDeactivate={setDeleteTarget} />
            ))
          )}
        </SettingsSection>

        <ApiKeyMcpGuide />
        <ScopeSummary keys={keys} />
      </div>

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
              「{deleteTarget?.name}」を無効化します。このキーを使用している外部AIや連携はFocusmap APIを呼べなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-red-600 text-white hover:bg-red-500">
              無効化
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
