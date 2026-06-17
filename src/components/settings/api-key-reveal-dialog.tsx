"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Copy, Check, AlertTriangle } from "lucide-react"
import { SettingsStatusChip } from "@/components/settings/settings-primitives"

interface ApiKeyRevealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rawKey: string
  keyName: string
}

export function ApiKeyRevealDialog({
  open,
  onOpenChange,
  rawKey,
  keyName,
}: ApiKeyRevealDialogProps) {
  const [copied, setCopied] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const baseUrl = typeof window === "undefined" ? "https://focusmap-official.com" : window.location.origin
  const aiPrompt = `あなたはFocusmapを操作できます。Base URLは ${baseUrl} です。
Authorization: Bearer ${rawKey} を付けて /api/v1 を呼びます。

最初に GET /api/v1/bootstrap を呼び、スペース、プロジェクト、カレンダー、利用可能scopeを確認してください。
プロジェクト名が曖昧なら GET /api/v1/projects?q=... で候補を確認してください。

マインドマップを大きく整理するときは、本番tasksを直接変更せず、必ず POST /api/v1/mindmap/drafts でAI案を保存してください。
Focusmap側ではそのdraftがマインドマップ上に「AI案」として表示されます。
ユーザーが「確定して」と言ったときだけ POST /api/v1/mindmap/drafts/{draftId}/apply を呼びます。
単発の小さなノード追加・修正だけは POST/PATCH /api/v1/mindmap/nodes を使えます。

プロジェクト文脈は GET/PUT /api/v1/projects/{projectId}/context を使います。
メモ追加は POST /api/v1/memos を使い、title/bodyの両方を空にしないでください。
予定を動かす時は GET /api/v1/calendar/events で google_event_id と calendar_id を確認し、
PATCH /api/v1/calendar/events/{googleEventId} に start_time/end_time/calendar_id を渡してください。
複数操作をまとめたい時は POST /api/v1/ai/actions を使えます。
各書き込みリクエストには X-Focusmap-Idempotency-Key を付けてください。`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(aiPrompt)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>APIキーが作成されました</DialogTitle>
            <SettingsStatusChip tone="danger">一度だけ表示</SettingsStatusChip>
          </div>
          <DialogDescription>
            「{keyName}」のAPIキーです。閉じる前に安全な場所へ保存してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-500/[0.04] p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-200" />
            <p className="text-xs leading-5 text-red-100/75">
              このキーは後から再表示できません。紛失した場合は新しいキーを作成し、古いキーを無効化してください。
            </p>
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.045]">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2">
              <p className="text-sm font-medium text-zinc-100">Secret</p>
              <SettingsStatusChip tone="muted">sk_focusmap_...</SettingsStatusChip>
            </div>
            <div className="flex items-center gap-2 p-3">
              <code className="flex-1 break-all font-mono text-xs text-zinc-200">{rawKey}</code>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/[0.07] hover:text-white"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.045] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-100">Codexに渡すプロンプト</p>
                <p className="mt-0.5 text-xs text-zinc-500">権限の使い方とAI案保存のルールを含めています。</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyPrompt}
                className="min-h-10 shrink-0"
              >
                {copiedPrompt ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                コピー
              </Button>
            </div>
            <pre className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/30 p-3 text-xs leading-5 text-zinc-300">
              <code>{aiPrompt}</code>
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
