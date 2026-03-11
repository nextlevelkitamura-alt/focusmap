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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
