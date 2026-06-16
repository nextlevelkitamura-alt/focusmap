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
          <DialogTitle>APIキーが作成されました</DialogTitle>
          <DialogDescription>
            「{keyName}」のAPIキーです。このキーは一度だけ表示されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
            <code className="flex-1 text-xs break-all font-mono">{rawKey}</code>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              このキーを安全な場所に保存してください。ダイアログを閉じると二度と表示できません。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Codexに渡すプロンプト</p>
              <Button variant="outline" size="sm" onClick={handleCopyPrompt}>
                {copiedPrompt ? (
                  <Check className="mr-2 h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                コピー
              </Button>
            </div>
            <pre className="max-h-64 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
              <code>{aiPrompt}</code>
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
